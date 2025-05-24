// ==UserScript==
// @name         TapMePlus1 自动通关优化版（完整整合版）
// @namespace    http://tampermonkey.net/
// @version      3.3
// @description  完整版，包含预测、模拟消除、动画等待、自动点击等功能 https://tapmeplus1.com/zh
// @match        https://tapmeplus1.com/zh*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    if (window.autoTapmePlus1Injected) {
        console.log('[AutoTapmePlus1] 脚本已注入，停止重复执行。');
        return;
    }
    window.autoTapmePlus1Injected = true;

    const BOARD_SIZE = 5;
    const MAX_CLICKS = 5;
    const RECENT_CLICK_CACHE_SIZE = 10;
    const BASE_CONTINUOUS_CLICK_DELAY = 150;
    const MIN_CONTINUOUS_CLICK_DELAY = 50;
    const ANIMATION_WAIT_INTERVAL = 50;
    const MAX_ANIMATION_WAIT_TIME = 8000;
    const MONITOR_INTERVAL = 2500;

    const defaultConfig = {
        minScoreThreshold: 1,
        clicksDiffWeight: 6000,
        chainCountWeight: 200,
        maxContinuousClicks: 3,
        allowLowScoreClicks: true,
        lowScoreThreshold: 15,
        lowScoreClickValueWeight: 0.8,
        breakthroughModeEnabled: true,
        breakthroughMinClicksDiff: 1,
        breakthroughValueThreshold: -500,
        breakthroughRandomClickAttempts: 5,
        autoRestartAfterGameEnd: true,
        dynamicBreakthroughThreshold: true
    };

    let config = defaultConfig;

    let running = false;
    let paused = false;
    let stopRequested = false;
    let recentClicks = [];
    let monitoring = false;

    let controlPanel, statusDiv, logArea, startBtn, pauseBtn, resetBtn, exportBtn;

    let animationObserver = null;
    let animationActive = false;

    // 工具函数
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    function deepCopyBoard(board) { return board.map(row => row.slice()); }
    function boardsEqual(b1, b2) {
        if (!b1 || !b2 || b1.length !== BOARD_SIZE || b2.length !== BOARD_SIZE) return false;
        for (let i = 0; i < BOARD_SIZE; i++) {
            if (b1[i].length !== BOARD_SIZE || b2[i].length !== BOARD_SIZE) return false;
            for (let j = 0; j < BOARD_SIZE; j++) {
                if (b1[i][j] !== b2[i][j]) return false;
            }
        }
        return true;
    }
    function shuffleArray(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
    }

    // DOM读取
    function getBoardFromDOM() {
        const board = Array(BOARD_SIZE).fill(0).map(() => Array(BOARD_SIZE).fill(null));
        const cells = document.querySelectorAll('#game-board .cell');
        if (cells.length !== BOARD_SIZE * BOARD_SIZE) return null;
        for (const cell of cells) {
            if (cell.dataset && typeof cell.dataset.row !== 'undefined' && typeof cell.dataset.col !== 'undefined') {
                const row = parseInt(cell.dataset.row);
                const col = parseInt(cell.dataset.col);
                const valStr = cell.getAttribute('data-value');
                board[row][col] = valStr !== null ? parseInt(valStr) : null;
            }
        }
        return board;
    }
    function getClicksLeftFromDOM() {
        const el = document.getElementById('clicks-left');
        if (!el) return 0;
        const val = parseInt(el.textContent);
        return isNaN(val) ? 0 : val;
    }
    function getScoreFromDOM() {
        const scoreEl = document.querySelector('.score-display');
        if (!scoreEl) return 0;
        const text = scoreEl.textContent || '';
        const match = text.match(/(\d+)/);
        return match ? parseInt(match[1]) : 0;
    }

    // 动画检测
    function setupAnimationObserver() {
        if (animationObserver) return;
        animationObserver = new MutationObserver(() => {
            const animElements = document.querySelectorAll('.cell.highlight, .cell-clone, .new-connected, .score-popup, .vanish');
            animationActive = animElements.length > 0;
        });
        animationObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    }
    function isGameAnimating() {
        if (animationActive) return true;
        try {
            if (window.gameState && typeof window.gameState.isAnimating !== 'undefined') return window.gameState.isAnimating;
            return document.querySelector('.cell.highlight, .cell-clone, .new-connected, .score-popup, .vanish') !== null;
        } catch { return document.querySelector('.cell.highlight, .cell-clone, .new-connected, .score-popup, .vanish') !== null; }
    }

    // 游戏结束弹框
    function isGameEndModalVisible() {
        const modal = document.getElementById('game-end-modal');
        return modal && modal.classList.contains('show');
    }
    function handleGameEndModal() {
        const restartButton = document.getElementById('modal-restart-btn');
        if (restartButton) {
            log('检测到游戏结束弹框，自动点击重启按钮...');
            restartButton.click();
            return true;
        }
        return false;
    }

    // 连通组查找
    function findAllConnectedGroups(board) {
        const size = board.length;
        const visited = Array(size).fill(0).map(() => Array(size).fill(false));
        const groups = [];
        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                if (!visited[i][j] && board[i][j] !== null) {
                    const val = board[i][j];
                    const queue = [{ r: i, c: j }];
                    visited[i][j] = true;
                    const currentGroup = [];
                    while (queue.length) {
                        const { r, c } = queue.shift();
                        currentGroup.push({ r, c });
                        const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
                        for (const [dr, dc] of directions) {
                            const nr = r + dr, nc = c + dc;
                            if (nr >= 0 && nr < size && nc >= 0 && nc < size &&
                                !visited[nr][nc] && board[nr][nc] === val) {
                                visited[nr][nc] = true;
                                queue.push({ r: nr, c: nc });
                            }
                        }
                    }
                    if (currentGroup.length >= 3) groups.push(currentGroup);
                }
            }
        }
        return groups;
    }

    // 重力模拟
    function applyGravitySim(board) {
        const size = board.length;
        let hasMovedOrFilled = false;
        for (let col = 0; col < size; col++) {
            let emptyRow = size - 1;
            for (let row = size - 1; row >= 0; row--) {
                if (board[row][col] !== null) {
                    if (row !== emptyRow) {
                        board[emptyRow][col] = board[row][col];
                        board[row][col] = null;
                        hasMovedOrFilled = true;
                    }
                    emptyRow--;
                }
            }
            while (emptyRow >= 0) {
                board[emptyRow][col] = Math.floor(Math.random() * 5) + 1;
                hasMovedOrFilled = true;
                emptyRow--;
            }
        }
        return hasMovedOrFilled;
    }

    // 模拟消除
    function simulateElimination(board, initialClicksLeft) {
        let totalScore = 0;
        let currentClicksLeft = initialClicksLeft;
        let maxNumberInGame = 0;
        let chainCount = 0;
        const simBoard = deepCopyBoard(board);

        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                if (simBoard[r][c] > maxNumberInGame) maxNumberInGame = simBoard[r][c];
            }
        }

        while (true) {
            const groups = findAllConnectedGroups(simBoard);
            if (groups.length === 0) break;
            chainCount++;

            for (const group of groups) {
                let target = group[0];
                for (const cell of group) {
                    if (cell.r > target.r || (cell.r === target.r && cell.c < target.c)) {
                        target = cell;
                    }
                }

                const baseValue = simBoard[target.r][target.c];
                const cellsToClear = group.filter(c => !(c.r === target.r && c.c === target.c));

                totalScore += baseValue * cellsToClear.length;
                for (const c of cellsToClear) simBoard[c.r][c.c] = null;

                simBoard[target.r][target.c]++;
                if (simBoard[target.r][target.c] > maxNumberInGame) maxNumberInGame = simBoard[target.r][target.c];
                currentClicksLeft = Math.min(currentClicksLeft + 1, MAX_CLICKS);
            }

            const appliedGravity = applyGravitySim(simBoard);
            if (!appliedGravity && findAllConnectedGroups(simBoard).length === 0) break;
        }
        return { board: simBoard, totalScore, totalClicksLeft: currentClicksLeft, maxNumberInGame, chainCount };
    }

    // 预测点击
    function predictClick(row, col, clickTimes = 1) {
        const originalBoard = getBoardFromDOM();
        if (!originalBoard) return null;
        let initialClicksLeft = getClicksLeftFromDOM();
        if (originalBoard[row][col] === null) return null;
        if (clickTimes <= 0 || clickTimes > initialClicksLeft) return null;

        const boardAfterClick = deepCopyBoard(originalBoard);
        for (let k = 0; k < clickTimes; k++) {
            boardAfterClick[row][col]++;
        }

        const clicksLeftAfterInitialCost = initialClicksLeft - clickTimes;
        const result = simulateElimination(boardAfterClick, clicksLeftAfterInitialCost);

        const clicksDiff = result.totalClicksLeft - initialClicksLeft;

        let value = result.totalScore +
            (config.clicksDiffWeight * clicksDiff) +
            (config.chainCountWeight * result.chainCount);

        if (config.allowLowScoreClicks &&
            result.totalScore > 0 && result.totalScore <= config.lowScoreThreshold &&
            clicksDiff <= 0) {
            value = (result.totalScore * config.lowScoreClickValueWeight) +
                (config.chainCountWeight * result.chainCount);
        }

        return {
            row, col, clickTimes,
            scoreGain: result.totalScore,
            clicksLeftAfter: result.totalClicksLeft,
            clicksDiff,
            maxNumberInGame: result.maxNumberInGame,
            boardAfter: result.board,
            chainCount: result.chainCount,
            value
        };
    }

    // 格式化棋盘为字符串
    function boardToString(board) {
        if (!board) return 'null';
        return board.map(row => row.map(v => (v === null ? '.' : v)).join('')).join('|');
    }

    // 动画等待
    async function waitForAnimationToFinish(timeout = MAX_ANIMATION_WAIT_TIME, interval = ANIMATION_WAIT_INTERVAL) {
        let start = Date.now();
        let lastKnownBoard = getBoardFromDOM();

        while (Date.now() - start < timeout) {
            if (!isGameAnimating()) {
                await sleep(interval * 2);
                const currentBoard = getBoardFromDOM();
                if (boardsEqual(lastKnownBoard, currentBoard)) {
                    return true;
                } else {
                    log('[动画等待] 棋盘状态变化，继续等待动画完成...');
                    lastKnownBoard = deepCopyBoard(currentBoard);
                    start = Date.now();
                }
            }
            await sleep(interval);
            const currentBoardCheck = getBoardFromDOM();
            if (currentBoardCheck && !boardsEqual(lastKnownBoard, currentBoardCheck)) {
                lastKnownBoard = deepCopyBoard(currentBoardCheck);
            }
        }
        log(`警告：等待动画完成超时 (${timeout}ms). 继续操作可能导致不同步.`);
        return false;
    }

    // 最近点击缓存
    function isInRecentClicks(row, col) {
        return recentClicks.some(c => c.row === row && c.col === col);
    }
    function addToRecentClicks(row, col) {
        recentClicks.push({ row, col });
        if (recentClicks.length > RECENT_CLICK_CACHE_SIZE) recentClicks.shift();
    }

    // 破局模式
    function findBreakthroughMove(allPossiblePredictions, currentBoard, clicksLeft) {
        log('标准点击未找到（评估价值 <= 0），尝试进入破局模式...');
        let breakthroughPrediction = null;

        const clicksGainPredictions = allPossiblePredictions.filter(p => p.clicksDiff >= config.breakthroughMinClicksDiff);
        if (clicksGainPredictions.length > 0) {
            breakthroughPrediction = clicksGainPredictions.reduce((prev, current) => (prev.value > current.value) ? prev : current);
            log(`破局模式：找到能增加行动点的格子 (${breakthroughPrediction.row},${breakthroughPrediction.col})，价值: ${breakthroughPrediction.value.toFixed(2)}`);
            return breakthroughPrediction;
        }

        const validBreakthroughPredictions = allPossiblePredictions.filter(p => p.value >= config.breakthroughValueThreshold);
        if (validBreakthroughPredictions.length > 0) {
            breakthroughPrediction = validBreakthroughPredictions.reduce((prev, current) => (prev.value > current.value) ? prev : current);
            log(`破局模式：找到评估价值在阈值内的格子 (${breakthroughPrediction.row},${breakthroughPrediction.col})，价值: ${breakthroughPrediction.value.toFixed(2)}`);
            return breakthroughPrediction;
        }

        log('破局模式：未找到有价值或增益行动点的格子，尝试随机点击...');
        const availableCells = [];
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                if (currentBoard[r][c] !== null) {
                    availableCells.push({ r, c });
                }
            }
        }

        if (availableCells.length > 0) {
            for (let attempt = 0; attempt < config.breakthroughRandomClickAttempts; attempt++) {
                const randomCell = availableCells[Math.floor(Math.random() * availableCells.length)];
                const maxTimesForRandom = Math.min(clicksLeft, config.maxContinuousClicks);
                if (maxTimesForRandom < 1) continue;
                const randomClickTimes = Math.floor(Math.random() * maxTimesForRandom) + 1;

                const prediction = predictClick(randomCell.r, randomCell.c, randomClickTimes);
                if (prediction && prediction.value >= config.breakthroughValueThreshold) {
                    log(`破局模式：随机点击 (${prediction.row},${prediction.col}) x${randomClickTimes} 尝试破局成功，价值: ${prediction.value.toFixed(2)}`);
                    return prediction;
                }
            }
        }
        log('破局模式：随机点击也未能找到合适的破局点。');
        return null;
    }

    // 寻找最佳点击
    function findBestClick(currentBoard, clicksLeft) {
        let bestPrediction = null;
        let bestValue = -Infinity;
        let allPredictions = [];

        for (let i = 0; i < BOARD_SIZE; i++) {
            for (let j = 0; j < BOARD_SIZE; j++) {
                if (currentBoard[i][j] !== null) {
                    for (let times = 1; times <= Math.min(clicksLeft, config.maxContinuousClicks); times++) {
                        const prediction = predictClick(i, j, times);
                        if (!prediction) continue;
                        allPredictions.push(prediction);
                    }
                }
            }
        }

        shuffleArray(allPredictions);

        for (const prediction of allPredictions) {
            if (isInRecentClicks(prediction.row, prediction.col) && prediction.value <= bestValue * 1.1) {
                continue;
            }
            if (prediction.value > bestValue) {
                bestValue = prediction.value;
                bestPrediction = prediction;
            }
        }

        if (!bestPrediction && config.breakthroughModeEnabled) {
            bestPrediction = findBreakthroughMove(allPredictions, currentBoard, clicksLeft);
        }

        return bestPrediction;
    }

    // 自动点击循环
    async function autoClickLoop() {
        if (controlPanel) {
            pauseBtn.disabled = false;
            startBtn.disabled = true;
        }

        while (running && !stopRequested) {
            if (paused) {
                await sleep(500);
                continue;
            }

            if (isGameEndModalVisible()) {
                if (handleGameEndModal()) {
                    log('游戏结束弹框已处理，等待游戏重启后由监控接管。');
                    running = false;
                    await sleep(3000);
                    continue;
                }
            }

            const clicksLeft = getClicksLeftFromDOM();
            const scoreNow = getScoreFromDOM();
            const currentBoard = getBoardFromDOM();

            if (!currentBoard) {
                log('无法获取棋盘状态，等待...');
                await sleep(1000);
                continue;
            }

            if (clicksLeft <= 0) {
                log('行动点用尽，等待连锁反应或游戏结束...');
                await waitForAnimationToFinish(MAX_ANIMATION_WAIT_TIME * 2);
                const newClicksLeft = getClicksLeftFromDOM();
                if (newClicksLeft <= 0) {
                    log('行动点仍为0，自动通关结束。');
                    running = false;
                    break;
                } else {
                    log(`行动点恢复到 ${newClicksLeft}，继续循环。`);
                }
                continue;
            }

            const bestPrediction = findBestClick(currentBoard, clicksLeft);

            if (!bestPrediction) {
                log('无可点击格子，自动通关暂停。');
                running = false;
                break;
            }

            const cell = document.querySelector(`.cell[data-row="${bestPrediction.row}"][data-col="${bestPrediction.col}"]`);
            if (!cell) {
                log(`错误：未找到DOM格子 (${bestPrediction.row},${bestPrediction.col})，停止运行。`);
                running = false;
                break;
            }

            const boardBefore = boardToString(currentBoard);
            log(`点击前棋盘快照: ${boardBefore}`);

            log(`点击格子 (${bestPrediction.row},${bestPrediction.col}) x${bestPrediction.clickTimes}, 得分: ${bestPrediction.scoreGain.toFixed(1)}, ΔClicks: ${bestPrediction.clicksDiff >= 0 ? '+' : ''}${bestPrediction.clicksDiff}, 链: ${bestPrediction.chainCount}, Val: ${bestPrediction.value.toFixed(2)}, 积分: ${scoreNow}, 行动点: ${clicksLeft}`);

            let delay = BASE_CONTINUOUS_CLICK_DELAY;
            if (clicksLeft <= 2) delay = MIN_CONTINUOUS_CLICK_DELAY;
            else if (clicksLeft <= 4) delay = BASE_CONTINUOUS_CLICK_DELAY / 2;

            for (let k = 0; k < bestPrediction.clickTimes; k++) {
                cell.click();
                await sleep(delay);
            }

            let waitSuccess = await waitForAnimationToFinish();
            if (!waitSuccess) {
                log('[异常重试] 动画等待超时，尝试重新检测棋盘状态...');
                const boardAfterRetry = getBoardFromDOM();
                if (boardsEqual(currentBoard, boardAfterRetry)) {
                    log('[异常重试] 棋盘状态无变化，继续执行。');
                } else {
                    log('[异常重试] 棋盘状态变化，重新等待动画完成...');
                    await waitForAnimationToFinish();
                }
            }

            const boardAfter = boardToString(getBoardFromDOM());
            log(`点击后棋盘快照: ${boardAfter}`);

            addToRecentClicks(bestPrediction.row, bestPrediction.col);
        }

        if (controlPanel) {
            pauseBtn.disabled = true;
            startBtn.disabled = false;
            updateStatus(stopRequested ? '已重置/停止' : '已停止，进入监控');
        }
        if (!stopRequested) {
            recentClicks = [];
        }
        log('自动点击循环结束。');
    }

    // 监控游戏状态
    async function monitorGameState() {
        if (monitoring) return;
        monitoring = true;
        log('进入后台监控状态，等待可用操作或游戏开始...');

        while (true) {
            if (stopRequested) {
                monitoring = false;
                log("监控已停止 (用户重置).");
                updateStatus('已重置/停止.');
                return;
            }
            if (paused || running) {
                await sleep(2000);
                continue;
            }

            if (isGameEndModalVisible()) {
                if (handleGameEndModal()) {
                    log('监控：游戏结束弹框已处理，等待游戏重启...');
                    await sleep(3000);
                    continue;
                }
            }

            const currentBoard = getBoardFromDOM();
            const clicksLeft = getClicksLeftFromDOM();

            if (currentBoard && clicksLeft > 0) {
                log('监控：检测到可用操作，自动启动自动点击。');
                running = true;
                paused = false;
                stopRequested = false;
                updateStatus('运行中');
                autoClickLoop();
            }
            await sleep(MONITOR_INTERVAL);
        }
    }

    // UI和初始化
    function createControlPanel() {
        if (document.getElementById('autoTapmeControlPanel')) return;
        controlPanel = document.createElement('div');
        controlPanel.id = 'autoTapmeControlPanel';
        Object.assign(controlPanel.style, {
            position: 'fixed', top: '10px', right: '10px', width: '420px', maxHeight: '520px',
            overflowY: 'auto', backgroundColor: 'rgba(0,0,0,0.9)', color: '#eee', fontSize: '14px',
            fontFamily: 'monospace', padding: '12px', borderRadius: '8px', zIndex: '99999',
            boxShadow: '0 0 15px rgba(0,0,0,0.5)', userSelect: 'none', transition: 'opacity 0.3s ease-in-out'
        });

        const title = document.createElement('div');
        title.textContent = 'TapMePlus1 自动通关控制面板 (v3.3)';
        title.style.fontWeight = 'bold';
        title.style.marginBottom = '10px';
        title.style.fontSize = '16px';
        title.style.textAlign = 'center';
        controlPanel.appendChild(title);

        statusDiv = document.createElement('div');
        statusDiv.id = 'autoTapmeStatus';
        statusDiv.style.marginBottom = '10px';
        statusDiv.textContent = '状态：未运行';
        statusDiv.style.color = '#bbb';
        controlPanel.appendChild(statusDiv);

        const btnContainer = document.createElement('div');
        btnContainer.style.marginBottom = '10px';
        btnContainer.style.textAlign = 'center';

        startBtn = document.createElement('button');
        startBtn.textContent = '开始';
        Object.assign(startBtn.style, {
            marginRight: '10px', padding: '6px 12px', cursor: 'pointer',
            backgroundColor: '#4CAF50', color: 'white', border: 'none', borderRadius: '4px',
            transition: 'background-color 0.2s ease'
        });
        startBtn.onmouseover = () => startBtn.style.backgroundColor = '#45a049';
        startBtn.onmouseout = () => startBtn.style.backgroundColor = '#4CAF50';
        startBtn.onclick = () => {
            if (!running) {
                running = true; paused = false; stopRequested = false;
                updateStatus('运行中');
                log('开始自动通关');
                autoClickLoop();
                pauseBtn.disabled = false; startBtn.disabled = true;
            }
        };
        btnContainer.appendChild(startBtn);

        pauseBtn = document.createElement('button');
        pauseBtn.textContent = '暂停';
        Object.assign(pauseBtn.style, {
            marginRight: '10px', padding: '6px 12px', cursor: 'pointer',
            backgroundColor: '#ff9800', color: 'white', border: 'none', borderRadius: '4px',
            transition: 'background-color 0.2s ease'
        });
        pauseBtn.onmouseover = () => pauseBtn.style.backgroundColor = '#f57c00';
        pauseBtn.onmouseout = () => pauseBtn.style.backgroundColor = '#ff9800';
        pauseBtn.disabled = true;
        pauseBtn.onclick = () => {
            if (!running && !paused) return;
            paused = !paused;
            pauseBtn.textContent = paused ? '继续' : '暂停';
            updateStatus(paused ? '已暂停' : '运行中');
            log(paused ? '已暂停' : '已继续');
        };
        btnContainer.appendChild(pauseBtn);

        resetBtn = document.createElement('button');
        resetBtn.textContent = '重置';
        Object.assign(resetBtn.style, {
            marginRight: '10px', padding: '6px 12px', cursor: 'pointer',
            backgroundColor: '#f44336', color: 'white', border: 'none', borderRadius: '4px',
            transition: 'background-color 0.2s ease'
        });
        resetBtn.onmouseover = () => resetBtn.style.backgroundColor = '#d32f2f';
        resetBtn.onmouseout = () => resetBtn.style.backgroundColor = '#f44336';
        resetBtn.onclick = () => {
            running = false; paused = false; stopRequested = true; recentClicks = [];
            updateStatus('已重置/停止');
            log('已重置，停止自动通关');
            pauseBtn.textContent = '暂停'; pauseBtn.disabled = true; startBtn.disabled = false;
        };
        btnContainer.appendChild(resetBtn);

        exportBtn = document.createElement('button');
        exportBtn.textContent = '导出日志';
        Object.assign(exportBtn.style, {
            padding: '6px 12px', cursor: 'pointer',
            backgroundColor: '#2196F3', color: 'white', border: 'none', borderRadius: '4px',
            transition: 'background-color 0.2s ease'
        });
        exportBtn.onmouseover = () => exportBtn.style.backgroundColor = '#1976D2';
        exportBtn.onmouseout = () => exportBtn.style.backgroundColor = '#2196F3';
        exportBtn.onclick = exportLog;
        btnContainer.appendChild(exportBtn);

        controlPanel.appendChild(btnContainer);

        const logHeader = document.createElement('div');
        logHeader.textContent = '日志区 (点击折叠/展开)';
        logHeader.style.cursor = 'pointer';
        logHeader.style.userSelect = 'none';
        logHeader.style.marginBottom = '4px';
        logHeader.style.fontWeight = 'bold';
        controlPanel.appendChild(logHeader);

        logArea = document.createElement('div');
        logArea.id = 'autoTapmeLogArea';
        Object.assign(logArea.style, {
            backgroundColor: '#1c1c1c', border: '1px solid #444', height: '300px', overflowY: 'auto',
            padding: '8px', whiteSpace: 'pre-wrap', userSelect: 'text', fontSize: '13px',
            lineHeight: '1.4em', borderRadius: '4px'
        });
        controlPanel.appendChild(logArea);

        logHeader.onclick = () => {
            if (logArea.style.display === 'none') {
                logArea.style.display = 'block';
            } else {
                logArea.style.display = 'none';
            }
        };

        document.body.appendChild(controlPanel);
    }

    function updateStatus(text) {
        if (statusDiv) statusDiv.textContent = '状态：' + text;
    }

    function log(msg) {
        if (!logArea) return;
        const time = new Date().toLocaleTimeString();
        logArea.textContent += `[${time}] ${msg}\n`;
        logArea.scrollTop = logArea.scrollHeight;
        console.log('[AutoTapmePlus1]', msg);
    }

    function exportLog() {
        if (!logArea) return;
        const blob = new Blob([logArea.textContent], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `TapMePlus1_自动通关日志_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        log('日志已导出');
    }

    async function autoClickLoop() {
        if (controlPanel) {
            pauseBtn.disabled = false;
            startBtn.disabled = true;
        }

        while (running && !stopRequested) {
            if (paused) {
                await sleep(500);
                continue;
            }

            if (isGameEndModalVisible()) {
                if (handleGameEndModal()) {
                    log('游戏结束弹框已处理，等待游戏重启后由监控接管。');
                    running = false;
                    await sleep(3000);
                    continue;
                }
            }

            const clicksLeft = getClicksLeftFromDOM();
            const scoreNow = getScoreFromDOM();
            const currentBoard = getBoardFromDOM();

            if (!currentBoard) {
                log('无法获取棋盘状态，等待...');
                await sleep(1000);
                continue;
            }

            if (clicksLeft <= 0) {
                log('行动点用尽，等待连锁反应或游戏结束...');
                await waitForAnimationToFinish(MAX_ANIMATION_WAIT_TIME * 2);
                const newClicksLeft = getClicksLeftFromDOM();
                if (newClicksLeft <= 0) {
                    log('行动点仍为0，自动通关结束。');
                    running = false;
                    break;
                } else {
                    log(`行动点恢复到 ${newClicksLeft}，继续循环。`);
                }
                continue;
            }

            const bestPrediction = findBestClick(currentBoard, clicksLeft);

            if (!bestPrediction) {
                log('无可点击格子，自动通关暂停。');
                running = false;
                break;
            }

            const cell = document.querySelector(`.cell[data-row="${bestPrediction.row}"][data-col="${bestPrediction.col}"]`);
            if (!cell) {
                log(`错误：未找到DOM格子 (${bestPrediction.row},${bestPrediction.col})，停止运行。`);
                running = false;
                break;
            }

            const boardBefore = boardToString(currentBoard);
            log(`点击前棋盘快照: ${boardBefore}`);

            log(`点击格子 (${bestPrediction.row},${bestPrediction.col}) x${bestPrediction.clickTimes}, 得分: ${bestPrediction.scoreGain.toFixed(1)}, ΔClicks: ${bestPrediction.clicksDiff >= 0 ? '+' : ''}${bestPrediction.clicksDiff}, 链: ${bestPrediction.chainCount}, Val: ${bestPrediction.value.toFixed(2)}, 积分: ${scoreNow}, 行动点: ${clicksLeft}`);

            let delay = BASE_CONTINUOUS_CLICK_DELAY;
            if (clicksLeft <= 2) delay = MIN_CONTINUOUS_CLICK_DELAY;
            else if (clicksLeft <= 4) delay = BASE_CONTINUOUS_CLICK_DELAY / 2;

            for (let k = 0; k < bestPrediction.clickTimes; k++) {
                cell.click();
                await sleep(delay);
            }

            let waitSuccess = await waitForAnimationToFinish();
            if (!waitSuccess) {
                log('[异常重试] 动画等待超时，尝试重新检测棋盘状态...');
                const boardAfterRetry = getBoardFromDOM();
                if (boardsEqual(currentBoard, boardAfterRetry)) {
                    log('[异常重试] 棋盘状态无变化，继续执行。');
                } else {
                    log('[异常重试] 棋盘状态变化，重新等待动画完成...');
                    await waitForAnimationToFinish();
                }
            }

            const boardAfter = boardToString(getBoardFromDOM());
            log(`点击后棋盘快照: ${boardAfter}`);

            addToRecentClicks(bestPrediction.row, bestPrediction.col);
        }

        if (controlPanel) {
            pauseBtn.disabled = true;
            startBtn.disabled = false;
            updateStatus(stopRequested ? '已重置/停止' : '已停止，进入监控');
        }
        if (!stopRequested) {
            recentClicks = [];
        }
        log('自动点击循环结束。');
    }

    async function monitorGameState() {
        if (monitoring) return;
        monitoring = true;
        log('进入后台监控状态，等待可用操作或游戏开始...');

        while (true) {
            if (stopRequested) {
                monitoring = false;
                log("监控已停止 (用户重置).");
                updateStatus('已重置/停止.');
                return;
            }
            if (paused || running) {
                await sleep(2000);
                continue;
            }

            if (isGameEndModalVisible()) {
                if (handleGameEndModal()) {
                    log('监控：游戏结束弹框已处理，等待游戏重启...');
                    await sleep(3000);
                    continue;
                }
            }

            const currentBoard = getBoardFromDOM();
            const clicksLeft = getClicksLeftFromDOM();

            if (currentBoard && clicksLeft > 0) {
                log('监控：检测到可用操作，自动启动自动点击。');
                running = true;
                paused = false;
                stopRequested = false;
                updateStatus('运行中');
                autoClickLoop();
            }
            await sleep(MONITOR_INTERVAL);
        }
    }

    function createControlPanel() {
        if (document.getElementById('autoTapmeControlPanel')) return;
        controlPanel = document.createElement('div');
        controlPanel.id = 'autoTapmeControlPanel';
        Object.assign(controlPanel.style, {
            position: 'fixed', top: '10px', right: '10px', width: '420px', maxHeight: '520px',
            overflowY: 'auto', backgroundColor: 'rgba(0,0,0,0.9)', color: '#eee', fontSize: '14px',
            fontFamily: 'monospace', padding: '12px', borderRadius: '8px', zIndex: '99999',
            boxShadow: '0 0 15px rgba(0,0,0,0.5)', userSelect: 'none', transition: 'opacity 0.3s ease-in-out'
        });

        const title = document.createElement('div');
        title.textContent = 'TapMePlus1 自动通关控制面板 (v3.3)';
        title.style.fontWeight = 'bold';
        title.style.marginBottom = '10px';
        title.style.fontSize = '16px';
        title.style.textAlign = 'center';
        controlPanel.appendChild(title);

        statusDiv = document.createElement('div');
        statusDiv.id = 'autoTapmeStatus';
        statusDiv.style.marginBottom = '10px';
        statusDiv.textContent = '状态：未运行';
        statusDiv.style.color = '#bbb';
        controlPanel.appendChild(statusDiv);

        const btnContainer = document.createElement('div');
        btnContainer.style.marginBottom = '10px';
        btnContainer.style.textAlign = 'center';

        startBtn = document.createElement('button');
        startBtn.textContent = '开始';
        Object.assign(startBtn.style, {
            marginRight: '10px', padding: '6px 12px', cursor: 'pointer',
            backgroundColor: '#4CAF50', color: 'white', border: 'none', borderRadius: '4px',
            transition: 'background-color 0.2s ease'
        });
        startBtn.onmouseover = () => startBtn.style.backgroundColor = '#45a049';
        startBtn.onmouseout = () => startBtn.style.backgroundColor = '#4CAF50';
        startBtn.onclick = () => {
            if (!running) {
                running = true; paused = false; stopRequested = false;
                updateStatus('运行中');
                log('开始自动通关');
                autoClickLoop();
                pauseBtn.disabled = false; startBtn.disabled = true;
            }
        };
        btnContainer.appendChild(startBtn);

        pauseBtn = document.createElement('button');
        pauseBtn.textContent = '暂停';
        Object.assign(pauseBtn.style, {
            marginRight: '10px', padding: '6px 12px', cursor: 'pointer',
            backgroundColor: '#ff9800', color: 'white', border: 'none', borderRadius: '4px',
            transition: 'background-color 0.2s ease'
        });
        pauseBtn.onmouseover = () => pauseBtn.style.backgroundColor = '#f57c00';
        pauseBtn.onmouseout = () => pauseBtn.style.backgroundColor = '#ff9800';
        pauseBtn.disabled = true;
        pauseBtn.onclick = () => {
            if (!running && !paused) return;
            paused = !paused;
            pauseBtn.textContent = paused ? '继续' : '暂停';
            updateStatus(paused ? '已暂停' : '运行中');
            log(paused ? '已暂停' : '已继续');
        };
        btnContainer.appendChild(pauseBtn);

        resetBtn = document.createElement('button');
        resetBtn.textContent = '重置';
        Object.assign(resetBtn.style, {
            marginRight: '10px', padding: '6px 12px', cursor: 'pointer',
            backgroundColor: '#f44336', color: 'white', border: 'none', borderRadius: '4px',
            transition: 'background-color 0.2s ease'
        });
        resetBtn.onmouseover = () => resetBtn.style.backgroundColor = '#d32f2f';
        resetBtn.onmouseout = () => resetBtn.style.backgroundColor = '#f44336';
        resetBtn.onclick = () => {
            running = false; paused = false; stopRequested = true; recentClicks = [];
            updateStatus('已重置/停止');
            log('已重置，停止自动通关');
            pauseBtn.textContent = '暂停'; pauseBtn.disabled = true; startBtn.disabled = false;
        };
        btnContainer.appendChild(resetBtn);

        exportBtn = document.createElement('button');
        exportBtn.textContent = '导出日志';
        Object.assign(exportBtn.style, {
            padding: '6px 12px', cursor: 'pointer',
            backgroundColor: '#2196F3', color: 'white', border: 'none', borderRadius: '4px',
            transition: 'background-color 0.2s ease'
        });
        exportBtn.onmouseover = () => exportBtn.style.backgroundColor = '#1976D2';
        exportBtn.onmouseout = () => exportBtn.style.backgroundColor = '#2196F3';
        exportBtn.onclick = exportLog;
        btnContainer.appendChild(exportBtn);

        controlPanel.appendChild(btnContainer);

        const logHeader = document.createElement('div');
        logHeader.textContent = '日志区 (点击折叠/展开)';
        logHeader.style.cursor = 'pointer';
        logHeader.style.userSelect = 'none';
        logHeader.style.marginBottom = '4px';
        logHeader.style.fontWeight = 'bold';
        controlPanel.appendChild(logHeader);

        logArea = document.createElement('div');
        logArea.id = 'autoTapmeLogArea';
        Object.assign(logArea.style, {
            backgroundColor: '#1c1c1c', border: '1px solid #444', height: '300px', overflowY: 'auto',
            padding: '8px', whiteSpace: 'pre-wrap', userSelect: 'text', fontSize: '13px',
            lineHeight: '1.4em', borderRadius: '4px'
        });
        controlPanel.appendChild(logArea);

        logHeader.onclick = () => {
            if (logArea.style.display === 'none') {
                logArea.style.display = 'block';
            } else {
                logArea.style.display = 'none';
            }
        };

        document.body.appendChild(controlPanel);
    }

    function updateStatus(text) {
        if (statusDiv) statusDiv.textContent = '状态：' + text;
    }

    function log(msg) {
        if (!logArea) return;
        const time = new Date().toLocaleTimeString();
        logArea.textContent += `[${time}] ${msg}\n`;
        logArea.scrollTop = logArea.scrollHeight;
        console.log('[AutoTapmePlus1]', msg);
    }

    function exportLog() {
        if (!logArea) return;
        const blob = new Blob([logArea.textContent], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `TapMePlus1_自动通关日志_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        log('日志已导出');
    }

    function init() {
        createControlPanel();
        updateStatus('未运行 (监控中)');
        log('脚本加载完成，点击“开始”或等待自动检测。');
        setupAnimationObserver();
        monitorGameState();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
