// ==UserScript==
// @name         TapMePlus1 自动通关
// @namespace    http://tampermonkey.net/
// @version      3.5
// @description  修复的自动通关脚本，专注于连锁反应和高效得分
// @match        https://tapmeplus1.com/*
// @grant        none
// ==/UserScript==
(function() {
    'use strict';
    if (window.autoTapmePlus1Injected) {
        console.log('[AutoTapmePlus1] 脚本已注入，停止重复执行。');
        return;
    }
    window.autoTapmePlus1Injected = true;
    // 基本常量
    const BOARD_SIZE = 5;
    const MAX_CLICKS = 5;
    const RECENT_CLICK_CACHE_SIZE = 10;
    const BASE_CONTINUOUS_CLICK_DELAY = 150;
    const MIN_CONTINUOUS_CLICK_DELAY = 50;
    const ANIMATION_WAIT_INTERVAL = 50;
    const MAX_ANIMATION_WAIT_TIME = 8000;
    const MONITOR_INTERVAL = 2500;
    // 默认配置
    const defaultConfig = {
    minScoreThreshold: 5,
    clicksDiffWeight: 5000,         // 略微降低，给其他因素空间
    chainCountWeight: 500,          // 提高连锁价值
    maxNumberWeight: 80,            // 大幅提高最大数字的价值
    maxContinuousClicks: 4,         // 允许一次投入更多点击来构造大数字
    allowLowScoreClicks: true,      // 保持开启，但可以考虑下面的权重调整
    lowScoreThreshold: 10,          // 稍微降低低分阈值
    lowScoreClickValueWeight: 0.5,  // 大幅降低低分点击的价值权重
    breakthroughModeEnabled: true,
    breakthroughMinClicksDiff: 1,   // 破局时至少要能赚回1个点击
    breakthroughValueThreshold: -100, // 破局的操作不能太亏
    breakthroughRandomClickAttempts: 5,
    autoRestartAfterGameEnd: true
    };
    // 状态变量
    let config = {...defaultConfig};
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
    function deepCopyBoard(board) {
        if (!board) return null;
        return board.map(row => row.slice());
    }
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
    function boardToString(board) {
        if (!board) return 'null';
        return board.map(row => row.map(v => (v === null ? '.' : v)).join('')).join('|');
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
    // 动画检测设置
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
            if (window.gameState && typeof window.gameState.isAnimating !== 'undefined')
                return window.gameState.isAnimating;
            return document.querySelector('.cell.highlight, .cell-clone, .new-connected, .score-popup, .vanish') !== null;
        } catch {
            return document.querySelector('.cell.highlight, .cell-clone, .new-connected, .score-popup, .vanish') !== null;
        }
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
                    if (currentGroup.length >= 3) groups.push({ cells: currentGroup, value: val });
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
            // 填充空位
            while (emptyRow >= 0) {
                board[emptyRow][col] = Math.floor(Math.random() * 5) + 1; // 确保填充数字在1-5之间 (游戏规则)
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
        // 找出当前棋盘上的最大数字
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                if (simBoard[r][c] !== null && simBoard[r][c] > maxNumberInGame)
                    maxNumberInGame = simBoard[r][c];
            }
        }
        // 进行连锁消除模拟
        while (true) {
            const groups = findAllConnectedGroups(simBoard);
            if (groups.length === 0) break;
            chainCount++;
            for (const group of groups) {
                // 找到最下方或最左侧的单元格作为目标
                let target = group.cells[0];
                for (const cell of group.cells) {
                    if (cell.r > target.r || (cell.r === target.r && cell.c < target.c)) {
                        target = cell;
                    }
                }
                const baseValue = simBoard[target.r][target.c];
                const cellsToClear = group.cells.filter(c => !(c.r === target.r && c.c === target.c));
                totalScore += baseValue * cellsToClear.length;
                // 清除连通组中的单元格
                for (const c of cellsToClear)
                    simBoard[c.r][c.c] = null;
                // 目标单元格数字加一
                simBoard[target.r][target.c]++;
                if (simBoard[target.r][target.c] > maxNumberInGame)
                    maxNumberInGame = simBoard[target.r][target.c];
                // 更新行动点
                currentClicksLeft = Math.min(currentClicksLeft + 1, MAX_CLICKS);
            }
            // 应用重力并检查是否继续有连通组
            const appliedGravity = applyGravitySim(simBoard);
            if (!appliedGravity && findAllConnectedGroups(simBoard).length === 0)
                break;
        }
        // 返回模拟结果
        return {
            board: simBoard,
            totalScore,
            totalClicksLeft: currentClicksLeft,
            maxNumberInGame,
            chainCount
        };
    }
    // 预测点击
    function predictClick(row, col, clickTimes = 1) {
        const originalBoard = getBoardFromDOM();
        if (!originalBoard) return null;
        let initialClicksLeft = getClicksLeftFromDOM();
        if (originalBoard[row][col] === null) return null;
        if (clickTimes <= 0 || clickTimes > initialClicksLeft) return null;
        // 创建点击后的棋盘副本
        const boardAfterClick = deepCopyBoard(originalBoard);
        for (let k = 0; k < clickTimes; k++) {
            boardAfterClick[row][col]++;
        }
        // 检查点击后是否会直接形成连通组
        const hasDirectConnection = findAllConnectedGroups(boardAfterClick).length > 0;
        // 计算点击后剩余的行动点
        const clicksLeftAfterInitialCost = initialClicksLeft - clickTimes;
        // 模拟消除过程
        const result = simulateElimination(boardAfterClick, clicksLeftAfterInitialCost);
        // 计算行动点变化
        const clicksDiff = result.totalClicksLeft - initialClicksLeft;
        // 计算综合价值
        let value = result.totalScore +
                   (config.clicksDiffWeight * clicksDiff) +
                   (config.chainCountWeight * result.chainCount) +
                   (config.maxNumberWeight * Math.pow(result.maxNumberInGame, 1.5));
        // 对低分值情况特殊处理
        if (config.allowLowScoreClicks &&
            result.totalScore > 0 && result.totalScore <= config.lowScoreThreshold &&
            clicksDiff <= 0) {
            value = (result.totalScore * config.lowScoreClickValueWeight) +
                   (config.chainCountWeight * result.chainCount);
        }
        // 如果没有直接连通组但模拟消除有结果，说明有潜力
        if (!hasDirectConnection && result.totalScore > 0) {
            value += 100;  // 给予额外奖励
        }
        // 返回预测结果
        return {
            row, col, clickTimes,
            scoreGain: result.totalScore,
            clicksLeftAfter: result.totalClicksLeft,
            clicksDiff,
            maxNumberInGame: result.maxNumberInGame,
            boardAfter: result.board,
            chainCount: result.chainCount,
            value,
            hasDirectConnection
        };
    }
    // 动画等待
    async function waitForAnimationToFinish(timeout = MAX_ANIMATION_WAIT_TIME, interval = ANIMATION_WAIT_INTERVAL) {
        let start = Date.now();
        let lastKnownBoard = getBoardFromDOM();
        while (Date.now() - start < timeout) {
            if (!isGameAnimating()) {
                await sleep(interval * 2); // 动画停止后额外等待一下，确保DOM完全更新
                const currentBoard = getBoardFromDOM();
                if (boardsEqual(lastKnownBoard, currentBoard)) {
                    // log('[动画等待] 动画结束且棋盘稳定。');
                    return true;
                } else {
                    log('[动画等待] 棋盘状态变化，继续等待动画完成...');
                    lastKnownBoard = deepCopyBoard(currentBoard);
                    start = Date.now(); // 重置计时器，因为棋盘还在变化
                }
            }
            await sleep(interval);
            // 检查棋盘状态，即便 isGameAnimating 为 true，棋盘也可能已经更新
            const currentBoardCheck = getBoardFromDOM();
            if (currentBoardCheck && !boardsEqual(lastKnownBoard, currentBoardCheck)) {
                // log('[动画等待] 动画期间棋盘变化。');
                lastKnownBoard = deepCopyBoard(currentBoardCheck);
            }
        }
        log(`警告：等待动画完成超时 (${timeout}ms). 继续操作可能导致不同步.`);
        return false;
    }
    // 最近点击缓存管理
    function isInRecentClicks(row, col) {
        return recentClicks.some(c => c.row === row && c.col === col);
    }
    function addToRecentClicks(row, col) {
        recentClicks.push({ row, col, time: Date.now() });
        // 清理超过缓存大小的点击记录
        if (recentClicks.length > RECENT_CLICK_CACHE_SIZE) {
            recentClicks.shift();
        }
        // 清理超过10秒的点击记录 (避免在游戏暂停或长时间未操作后，旧记录依然生效)
        const now = Date.now();
        recentClicks = recentClicks.filter(click => now - click.time < 10000);
    }
    // 破局模式
    function findBreakthroughMove(allPossiblePredictions, currentBoard, clicksLeft) {
        log('标准点击未找到（评估价值 <= 0），尝试进入破局模式...');
        let breakthroughPrediction = null;
        // 首先尝试找增加行动点的格子
        const clicksGainPredictions = allPossiblePredictions.filter(
            p => p.clicksDiff >= config.breakthroughMinClicksDiff);
        if (clicksGainPredictions.length > 0) {
            breakthroughPrediction = clicksGainPredictions.reduce(
                (prev, current) => (prev.value > current.value) ? prev : current);
            log(`破局模式：找到能增加行动点的格子 (${breakthroughPrediction.row},${breakthroughPrediction.col})，价值: ${breakthroughPrediction.value.toFixed(2)}`);
            return breakthroughPrediction;
        }
        // 尝试找评估价值在阈值内的格子
        const validBreakthroughPredictions = allPossiblePredictions.filter(
            p => p.value >= config.breakthroughValueThreshold);
        if (validBreakthroughPredictions.length > 0) {
            breakthroughPrediction = validBreakthroughPredictions.reduce(
                (prev, current) => (prev.value > current.value) ? prev : current);
            log(`破局模式：找到评估价值在阈值内的格子 (${breakthroughPrediction.row},${breakthroughPrediction.col})，价值: ${breakthroughPrediction.value.toFixed(2)}`);
            return breakthroughPrediction;
        }
        // 前面的方法都失败了，尝试随机点击
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
                // 随机选择一个单元格
                const randomIndex = Math.floor(Math.random() * availableCells.length);
                const randomCell = availableCells[randomIndex];
                // 决定点击次数
                const maxTimesForRandom = Math.min(clicksLeft, config.maxContinuousClicks);
                if (maxTimesForRandom < 1) continue; // 没有行动点就不能随机点击
                const randomClickTimes = Math.floor(Math.random() * maxTimesForRandom) + 1;
                // 预测结果
                const prediction = predictClick(randomCell.r, randomCell.c, randomClickTimes);
                // 检查是否是可接受的突破
                if (prediction && prediction.value >= config.breakthroughValueThreshold) { // 使用与上面相同的阈值
                    log(`破局模式：随机点击 (${prediction.row},${prediction.col}) x${randomClickTimes} 尝试破局成功，价值: ${prediction.value.toFixed(2)}`);
                    return prediction;
                }
            }
        }
        log('破局模式：随机点击也未能找到合适的破局点。');
        return null;
    }
    // 寻找最佳点击
    function findBestClick(currentBoard, clicksLeft, score) {
        let bestPrediction = null;
        let bestValue = -Infinity;
        let allPredictions = [];
        // 为所有可能的点击生成预测
        for (let i = 0; i < BOARD_SIZE; i++) {
            for (let j = 0; j < BOARD_SIZE; j++) {
                if (currentBoard[i][j] !== null) {
                    // 决定最大点击次数
                    const maxClicks = Math.min(clicksLeft, config.maxContinuousClicks);
                    for (let times = 1; times <= maxClicks; times++) {
                        const prediction = predictClick(i, j, times);
                        if (!prediction) continue;
                        allPredictions.push(prediction);
                    }
                }
            }
        }
        // 随机打乱预测数组，避免总是选择固定位置（如果价值相同）
        shuffleArray(allPredictions);
        // 首先检查是否有直接形成连通组的点击
        const directConnectPredictions = allPredictions.filter(p => p.hasDirectConnection);
        if (directConnectPredictions.length > 0) {
            // 从可以直接形成连通组的点击中选择最佳的
            for (const prediction of directConnectPredictions) {
                // 如果这个单元格最近被点击过，且没有明显更好，跳过 (避免在同一位置反复低效点击)
                if (isInRecentClicks(prediction.row, prediction.col) && prediction.value <= bestValue * 1.1) { // 1.1倍表示“明显更好”
                    // log(`跳过最近点击 (${prediction.row},${prediction.col}) 因价值不够高 (现有 ${bestValue.toFixed(2)}, 新 ${prediction.value.toFixed(2)})`);
                    continue;
                }
                if (prediction.value > bestValue) {
                    bestValue = prediction.value;
                    bestPrediction = prediction;
                }
            }
            if (bestPrediction) {
                log(`找到直接形成连通组的点击 (${bestPrediction.row},${bestPrediction.col})`);
                return bestPrediction;
            }
        }
        // 如果没有直接连通组，则考虑所有预测 (包括非直接连通但有潜力的)
        for (const prediction of allPredictions) { // allPredictions 包含了 directConnectPredictions，但上面已处理过
            // 如果这个单元格最近被点击过，且没有明显更好，跳过
            if (isInRecentClicks(prediction.row, prediction.col) && prediction.value <= bestValue * 1.1) {
                // log(`跳过最近点击 (${prediction.row},${prediction.col}) 因价值不够高 (现有 ${bestValue.toFixed(2)}, 新 ${prediction.value.toFixed(2)})`);
                continue;
            }
            if (prediction.value > bestValue) {
                bestValue = prediction.value;
                bestPrediction = prediction;
            }
        }
        // 如果没有找到有价值的点击（value <= 0），尝试破局模式
        if ((!bestPrediction || bestValue <= 0) && config.breakthroughModeEnabled) {
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
        // 主循环
        while (running && !stopRequested) {
            if (paused) {
                await sleep(500);
                continue;
            }
            // 检查游戏结束弹框
            if (isGameEndModalVisible()) {
                if (handleGameEndModal()) {
                    log('游戏结束弹框已处理，等待游戏重启后由监控接管。');
                    running = false; // 停止当前循环，让监控重新启动
                    await sleep(3000); // 等待重启动画和初始化
                    continue;
                }
            }
            // 获取当前游戏状态
            const clicksLeft = getClicksLeftFromDOM();
            const scoreNow = getScoreFromDOM();
            const currentBoard = getBoardFromDOM();
            if (!currentBoard) {
                log('无法获取棋盘状态，等待...');
                await sleep(1000);
                continue;
            }
            // 行动点耗尽检查
            if (clicksLeft <= 0) {
                log('行动点用尽，等待连锁反应或游戏结束...');
                await waitForAnimationToFinish(MAX_ANIMATION_WAIT_TIME * 2); // 等待可能发生的连锁反应
                const newClicksLeft = getClicksLeftFromDOM();
                if (newClicksLeft <= 0) { // 再次检查
                    log('行动点仍为0，自动通关结束。');
                    if (config.autoRestartAfterGameEnd && !isGameEndModalVisible()){
                        // 如果游戏看起来卡住了但没有结束弹框，也尝试模拟结束和重启
                        log('未检测到结束弹框但行动点为0，尝试通过监控重启流程。');
                    }
                    running = false;
                    break;
                } else {
                    log(`行动点恢复到 ${newClicksLeft}，继续循环。`);
                }
                continue;
            }
            // 寻找最佳点击
            const bestPrediction = findBestClick(currentBoard, clicksLeft, scoreNow);
            if (!bestPrediction) {
                log('无可点击格子，自动通关暂停。');
                // 这里也可能意味着游戏结束或卡住，让监控处理
                running = false;
                break;
            }
            // 获取要点击的DOM元素
            const cell = document.querySelector(`.cell[data-row="${bestPrediction.row}"][data-col="${bestPrediction.col}"]`);
            if (!cell) {
                log(`错误：未找到DOM格子 (${bestPrediction.row},${bestPrediction.col})，停止运行。`);
                running = false;
                break;
            }
            // 记录点击前的棋盘状态
            const boardBefore = boardToString(currentBoard);
            log(`点击前棋盘快照: ${boardBefore}`);
            // 输出点击决策信息
            log(`点击格子 (${bestPrediction.row},${bestPrediction.col}) x${bestPrediction.clickTimes}, 得分: ${bestPrediction.scoreGain.toFixed(1)}, ΔClicks: ${bestPrediction.clicksDiff >= 0 ? '+' : ''}${bestPrediction.clicksDiff}, 链: ${bestPrediction.chainCount}, Val: ${bestPrediction.value.toFixed(2)}, 积分: ${scoreNow}, 行动点: ${clicksLeft}`);
            // 执行点击
            let delay = BASE_CONTINUOUS_CLICK_DELAY;
            if (clicksLeft <= 2) delay = MIN_CONTINUOUS_CLICK_DELAY;
            else if (clicksLeft <= 4) delay = BASE_CONTINUOUS_CLICK_DELAY / 2; // 对4点及以下调整
            for (let k = 0; k < bestPrediction.clickTimes; k++) {
                cell.click();
                await sleep(delay);
            }
            // 等待动画完成
            let waitSuccess = await waitForAnimationToFinish();
            if (!waitSuccess) {
                log('[异常重试] 动画等待超时，尝试重新检测棋盘状态...');
                const boardAfterRetry = getBoardFromDOM();
                if (boardsEqual(currentBoard, boardAfterRetry)) { // 要与点击前的原始棋盘比较
                    log('[异常重试] 棋盘状态无变化(与点击前相比)，这可能意味着点击未生效或游戏卡顿。');
                    // 可以在此处加入更复杂的错误处理，比如强制重新评估
                } else {
                    log('[异常重试] 棋盘状态变化，重新等待动画完成...');
                    await waitForAnimationToFinish(); // 再等一次
                }
            }
            // 记录点击后的棋盘状态
            const boardAfter = boardToString(getBoardFromDOM()); // 确保获取最新的
            log(`点击后棋盘快照: ${boardAfter}`);
            // 添加到最近点击缓存
            addToRecentClicks(bestPrediction.row, bestPrediction.col);
        }
        if (controlPanel) {
            pauseBtn.disabled = true;
            startBtn.disabled = false;
            updateStatus(stopRequested ? '已重置/停止' : '已停止，进入监控');
        }
        // 清理缓存 (仅在非停止请求时，因为停止可能需要保留信息)
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
            if (paused || running) { // 如果正在运行或暂停，监控器暂时不干预
                await sleep(2000);
                continue;
            }
            // ----- 运行状态重置和游戏结束处理 -----
            // 如果循环因某种原因停止 (running = false), 而不是用户暂停或重置
            if (isGameEndModalVisible()) {
                if (handleGameEndModal()) {
                    log('监控：游戏结束弹框已处理，等待游戏重启...');
                    await sleep(3000); // 给重启留足时间
                    continue; // 继续监控，等待新的可用操作
                }
            } else if (config.autoRestartAfterGameEnd && getClicksLeftFromDOM() <=0 && !running && !paused) {
                // 尝试更主动地检测游戏结束（比如卡住但没有弹框）
                // 前提是 autoRestartAfterGameEnd 为 true, 行动点为0, 当前没有运行且未暂停
                const restartButton = document.getElementById('modal-restart-btn') ||
                                      document.querySelector('.restart-button') || // 假设有其他重启按钮类名
                                      document.querySelector('button[onclick*="restart"]'); // 更通用的查找
                if (restartButton) {
                   log('监控：检测到可能的结束状态 (0行动点)，尝试点击重启按钮...');
                   restartButton.click();
                   await sleep(3000);
                   continue;
                }
            }
            // ----- 自动启动逻辑 -----
            const currentBoard = getBoardFromDOM();
            const clicksLeft = getClicksLeftFromDOM();
            if (currentBoard && clicksLeft > 0 && !running && !paused && !stopRequested) { // 确保不是用户停止的状态
                log('监控：检测到可用操作，自动启动自动点击。');
                running = true;
                paused = false; // 确保不是暂停状态
                // stopRequested = false; // 在循环开始时处理
                updateStatus('运行中');
                autoClickLoop(); // 启动新的自动点击循环
                // autoClickLoop 是 async 的，这里不需要 await，让它在后台运行
            }
            await sleep(MONITOR_INTERVAL);
        }
    }
    // UI和控制面板
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
        // 标题
        const title = document.createElement('div');
        title.textContent = 'TapMePlus1 自动通关修复版 (v3.5)';
        title.style.fontWeight = 'bold';
        title.style.marginBottom = '10px';
        title.style.fontSize = '16px';
        title.style.textAlign = 'center';
        controlPanel.appendChild(title);
        // 状态显示
        statusDiv = document.createElement('div');
        statusDiv.id = 'autoTapmeStatus';
        statusDiv.style.marginBottom = '10px';
        statusDiv.textContent = '状态：未运行';
        statusDiv.style.color = '#bbb';
        controlPanel.appendChild(statusDiv);
        // 按钮容器
        const btnContainer = document.createElement('div');
        btnContainer.style.marginBottom = '10px';
        btnContainer.style.textAlign = 'center';
        // 开始按钮
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
        // 暂停按钮
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
            if (!running && !paused) return; // 如果既没运行也没暂停（比如已重置），则不操作
            paused = !paused;
            pauseBtn.textContent = paused ? '继续' : '暂停';
            updateStatus(paused ? '已暂停' : (running ? '运行中' : '已停止')); // 状态更准确
            log(paused ? '已暂停' : '已继续');
        };
        btnContainer.appendChild(pauseBtn);
        // 重置按钮
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
            // 确保监控器也知道停止了
            if (monitoring) {
                //  不需要直接停止监控器循环，它会在下一次检查 stopRequested 时退出
            }
        };
        btnContainer.appendChild(resetBtn);
        // 导出按钮
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
        // 日志区域
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
                logArea.scrollTop = logArea.scrollHeight; // 展开时滚动到底部
            } else {
                logArea.style.display = 'none';
            }
        };
        document.body.appendChild(controlPanel);
    }
    // 更新状态
    function updateStatus(text) {
        if (statusDiv) statusDiv.textContent = '状态：' + text;
    }
    // 日志记录
    function log(msg) {
        if (!logArea) return;
        const time = new Date().toLocaleTimeString();
        logArea.textContent += `[${time}] ${msg}\n`;
        logArea.scrollTop = logArea.scrollHeight; // 自动滚动到底部
        console.log('[AutoTapmePlus1]', msg);
    }
    // 导出日志
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
    // 初始化
    function init() {
        createControlPanel();
        updateStatus('未运行 (监控中)');
        log('脚本加载完成，点击"开始"或等待自动检测。');
        setupAnimationObserver(); // 设置动画观察器
        monitorGameState();     // 启动后台监控
    }
    // 确保DOM加载完成后执行初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init(); // DOM已经加载
    }
})();
