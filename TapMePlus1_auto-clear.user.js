// ==UserScript==
// @name         TapMePlus1 自动通关
// @namespace    https://violentmonkey.github.io
// @version      7.5
// @description  自动通关脚本，目标突破3000分
// @author       baimengshi
// @match        https://tapmeplus1.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';
    if (window.autoTapmePlus1Injected) return;
    window.autoTapmePlus1Injected = true;

    // 全局控件变量声明
    let controlPanel, statusDiv, logArea;
    let startBtn, pauseBtn, resetBtn, exportBtn;

    // ====== 基本参数 ======
    const BOARD_SIZE = 5;
    const MAX_CLICKS = 5;
    const BEAM_WIDTH = 8;
    const SEARCH_DEPTH = 4;
    const MIN_CLICK_DELAY = 60;
    const BASE_CLICK_DELAY = 100;
    const MAX_CACHE_SIZE = 500;

    const evaluationCache = new Map();

    // ====== 动态权重 ======
    const getScoreWeight = score => {
        if (score < 800) return { score: 100, layout: 1 };
        if (score < 1500) return { score: 85, layout: 0.8 };
        if (score < 2000) return { score: 70, layout: 0.6 };
        return { score: 60, layout: 0.4 };
    };

    // ====== 工具函数 ======
    const sleep = ms => new Promise(res => setTimeout(res, ms));

    const deepCopyBoard = board => board?.map(row => [...row]) ?? null;


    // ====== 获取棋盘状态 ======
    const getBoardFromDOM = () => {
        try {
            const board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
            const cells = document.querySelectorAll('#game-board .cell:not(.empty)');
            if (cells.length === 0) throw new Error('未找到有效的游戏格子');

            let validCells = 0;
            cells.forEach(cell => {
                const row = +cell.dataset.row, col = +cell.dataset.col;
                const val = +cell.textContent.trim();
                if ([row, col, val].some(n => isNaN(n))) {
                    log(`无效的格子数据: row=${cell.dataset.row}, col=${cell.dataset.col}, val=${cell.textContent}`, 'warn');
                    return;
                }
                if (row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE) {
                    board[row][col] = val;
                    validCells++;
                }
            });
            if (validCells === 0) throw new Error('所有格子数据无效');
            return board;
        } catch (e) {
            log(`获取棋盘状态失败: ${e.message}`, 'error');
            return null;
        }
    };

    // ====== 获取行动点 ======
    const getClicksLeftFromDOM = () => {
        const val = +document.getElementById('clicks-left')?.textContent || 0;
        return isNaN(val) ? 0 : val;
    };

    // ====== 获取当前分数 ======
    const getScoreFromDOM = () => {
        const text = document.querySelector('.score-display')?.textContent || '';
        const match = text.match(/\d+/);
        return match ? +match[0] : 0;
    };


    // ====== 查找所有连通组 ======
    const findAllConnectedGroups = board => {
        const size = board.length;
        const visited = Array(size).fill(null).map(() => Array(size).fill(false));
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
                        [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(([dr, dc]) => {
                            const nr = r + dr, nc = c + dc;
                            if (nr >= 0 && nr < size && nc >= 0 && nc < size &&
                                !visited[nr][nc] && board[nr][nc] === val) {
                                visited[nr][nc] = true;
                                queue.push({ r: nr, c: nc });
                            }
                        });
                    }
                    if (currentGroup.length >= 3) groups.push({ cells: currentGroup, value: val });
                }
            }
        }
        return groups;
    };


    // ====== 模拟重力下落 ======
    const applyGravitySim = board => {
        const size = board.length;
        let hasMovedOrFilled = false;
        let emptyCellsCreated = 0;

        for (let col = 0; col < size; col++) {
            let writeIndex = size - 1;

            // 移动已有方块到底部
            for (let readIndex = size - 1; readIndex >= 0; readIndex--) {
                if (board[readIndex][col] !== null) {
                    if (readIndex !== writeIndex) {
                        board[writeIndex][col] = board[readIndex][col];
                        board[readIndex][col] = null;
                        hasMovedOrFilled = true;
                    }
                    writeIndex--;
                }
            }

            // 填充新方块
            while (writeIndex >= 0) {
                board[writeIndex][col] = (Math.floor(Math.random() * 5) + 1);
                hasMovedOrFilled = true;
                emptyCellsCreated++;
                writeIndex--;
            }
        }

        return { hasMovedOrFilled, emptyCellsCreated };
    };


    // ====== 模拟消除 ======
    const simulateElimination = (board, initialClicksLeft) => {
        const simBoard = deepCopyBoard(board);
        let totalScore = 0;
        let clicksLeft = initialClicksLeft;
        let maxNumberInGame = 0;
        let chainCount = 0;
        let totalEmptyCellsCreated = 0;

        // 找出当前最大数字
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                const v = simBoard[r][c];
                if (v !== null && v > maxNumberInGame) maxNumberInGame = v;
            }
        }

        while (true) {
            const groups = findAllConnectedGroups(simBoard);
            if (!groups.length) break;
            chainCount++;

            for (const group of groups) {
                // 选取 group内 行最大，列最小的目标格子
                let target = group.cells.reduce((t, cell) =>
                    (cell.r > t.r || (cell.r === t.r && cell.c < t.c)) ? cell : t, group.cells[0]);

                const baseVal = simBoard[target.r][target.c];
                // 除目标外清空同组格子
                const cellsToClear = group.cells.filter(c => c.r !== target.r || c.c !== target.c);

                totalScore += baseVal * cellsToClear.length;

                for (const c of cellsToClear) simBoard[c.r][c.c] = null;
                simBoard[target.r][target.c] = baseVal + 1;

                maxNumberInGame = Math.max(maxNumberInGame, simBoard[target.r][target.c]);
                clicksLeft = Math.min(clicksLeft + 1, MAX_CLICKS);
            }

            const gravity = applyGravitySim(simBoard);
            totalEmptyCellsCreated += gravity.emptyCellsCreated;

            if (!gravity.hasMovedOrFilled && findAllConnectedGroups(simBoard).length === 0) break;
        }

        return {
            board: simBoard,
            totalScore,
            totalClicksLeft: clicksLeft,
            maxNumberInGame,
            chainCount,
            emptyCellsCreated: totalEmptyCellsCreated
        };
    };

    // ====== 布局评分（带缓存） ======
    const evaluateBoardConservative = (board, currentScore, lastClick) => {
        const cacheKey = JSON.stringify(board) + currentScore + (lastClick ? `${lastClick.row},${lastClick.col}` : '');
        if (evaluationCache.has(cacheKey)) return evaluationCache.get(cacheKey);

        const groups = findAllConnectedGroups(board);
        let maxGroupSize = 0, groupCount = 0, bigGroupCount = 0;

        for (const g of groups) {
            if (g.cells?.length) {
                groupCount++;
                maxGroupSize = Math.max(maxGroupSize, g.cells.length);
                if (g.cells.length >= 5) bigGroupCount++;
            }
        }

        let potentialChainCount = 0, edgeGroupSize = 0, isolated = 0, expandableGroupBonus = 0;
        let sum = 0, count = 0;
        const colorCounts = {};

        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                const val = board[r][c];
                if (val === null) continue;

                colorCounts[val] = (colorCounts[val] || 0) + 1;
                sum += val;
                count++;

                const neighbors = [[-1, 0], [1, 0], [0, -1], [0, 1]];
                let hasSameNeighbor = false;
                for (const [dr, dc] of neighbors) {
                    const nr = r + dr, nc = c + dc;
                    if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE) {
                        if (board[nr][nc] === val) hasSameNeighbor = true;
                        else if (board[nr][nc] === null) expandableGroupBonus += 2;
                    }
                }

                if (hasSameNeighbor) {
                    potentialChainCount++;
                    if (r === 0 || r === BOARD_SIZE - 1 || c === 0 || c === BOARD_SIZE - 1) edgeGroupSize++;
                } else {
                    isolated++;
                }
            }
        }

        let chainPotential = 0;
        for (const color in colorCounts) {
            const cnt = colorCounts[color];
            if (cnt >= 4) chainPotential += 20;
            if (cnt >= 6) chainPotential += 40;
        }

        const avg = count ? sum / count : 3;
        let variance = 0;
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                const val = board[r][c];
                if (val !== null) variance += (val - avg) ** 2;
            }
        }
        variance = count ? variance / count : 0;

        const empty = BOARD_SIZE * BOARD_SIZE - count;

        let conservativeScore = groupCount * 2 +
            maxGroupSize * 8 +
            bigGroupCount * 10 +
            edgeGroupSize * 2 +
            potentialChainCount * 2 +
            expandableGroupBonus +
            empty +
            chainPotential * 0.8 -
            isolated * 2 -
            variance * 0.2;

        evaluationCache.set(cacheKey, conservativeScore);

        if (evaluationCache.size > MAX_CACHE_SIZE) {
            const keys = [...evaluationCache.keys()].slice(0, 100);
            keys.forEach(k => evaluationCache.delete(k));
        }

        return conservativeScore;
    };


    // ====== 阶段策略 ======
    const getCurrentPhase = score => {
        if (score >= 4000) return { maxClicks: 1, riskFactor: 0.2, label: '4000+', strategy: 'focusLargeGroups' };
        if (score >= 3000) return { maxClicks: 2, riskFactor: 0.3, label: '3000+', strategy: 'balanceEdgeAndCenter' };
        if (score >= 2000) return { maxClicks: 2, riskFactor: 0.4, label: '2000+', strategy: 'maximizeChainPotential' };
        if (score >= 1000) return { maxClicks: 2, riskFactor: 0.7, label: '1000+', strategy: 'conservativeGrowth' };
        return { maxClicks: 2, riskFactor: 1.0, label: '基础', strategy: 'default' };
    };


    // ====== 光束搜索 ======
    const conservativeBeamSearch = (board, clicksLeft, scoreNow) => {
        const phase = getCurrentPhase(scoreNow);
        const weights = getScoreWeight(scoreNow);

        let strategyWeights = { score: weights.score, layout: weights.layout };
        switch (phase.strategy) {
            case 'focusLargeGroups': strategyWeights.layout *= 1.5; break;
            case 'balanceEdgeAndCenter': strategyWeights.score *= 1.2; break;
            case 'maximizeChainPotential': strategyWeights.score *= 1.5; break;
            case 'conservativeGrowth': strategyWeights.layout *= 1.2; break;
        }

        if (clicksLeft <= 2) {
            let bestMove = null, maxScore = -Infinity;
            for (let i = 0; i < BOARD_SIZE; i++) {
                for (let j = 0; j < BOARD_SIZE; j++) {
                    if (board[i][j] !== null) {
                        const tempBoard = deepCopyBoard(board);
                        tempBoard[i][j]++;
                        const sim = simulateElimination(tempBoard, clicksLeft - 1);
                        if (sim.totalScore > maxScore) {
                            maxScore = sim.totalScore;
                            bestMove = { row: i, col: j, times: 1 };
                        }
                    }
                }
            }
            if (bestMove && maxScore > 0) {
                log(`终局策略: 选择得分最高移动 (${bestMove.row},${bestMove.col})`, 'info');
                return bestMove;
            }
        }

        let beam = [{
            board: deepCopyBoard(board),
            clicksLeft,
            score: scoreNow,
            moveSeq: [],
            value: 0,
            scoreGain: 0
        }];
        for (let depth = 0; depth < SEARCH_DEPTH; depth++) {
            let nextBeam = [];

            for (const node of beam) {
                for (let i = 0; i < BOARD_SIZE; i++) {
                    for (let j = 0; j < BOARD_SIZE; j++) {
                        if (node.board[i][j] !== null) {
                            const maxClicksPhase = Math.min(node.clicksLeft, phase.maxClicks);
                            for (let times = 1; times <= maxClicksPhase; times++) {
                                if (isNaN(node.board[i][j])) {
                                    log(`无效棋盘值 (${i},${j}): ${node.board[i][j]}`, 'warn');
                                    continue;
                                }
                                let boardAfter = deepCopyBoard(node.board);
                                for (let k = 0; k < times; k++) boardAfter[i][j]++;
                                let clicksLeftAfter = node.clicksLeft - times;
                                const sim = simulateElimination(boardAfter, clicksLeftAfter);
                                const scoreGain = isNaN(sim.totalScore) ? 0 : sim.totalScore;
                                let conservativeScore = evaluateBoardConservative(sim.board, node.score + scoreGain, { row: i, col: j });
                                if (isNaN(conservativeScore)) conservativeScore = 0;

                                let value = scoreGain * strategyWeights.score + conservativeScore * strategyWeights.layout;
                                if (isNaN(value)) value = 0;

                                nextBeam.push({
                                    board: deepCopyBoard(sim.board),
                                    clicksLeft: sim.totalClicksLeft,
                                    score: node.score + scoreGain,
                                    moveSeq: node.moveSeq.concat([{ row: i, col: j, times }]),
                                    value: node.value + value,
                                    scoreGain: node.scoreGain + scoreGain,
                                    conservativeScore
                                });
                            }
                        }
                    }
                }
            }

            if (!nextBeam.length) {
                // 死局处理：选择最小损失动作
                let minLossAction = null, minLoss = Infinity;
                for (let i = 0; i < BOARD_SIZE; i++) {
                    for (let j = 0; j < BOARD_SIZE; j++) {
                        if (beam[0].board[i][j] !== null) {
                            const times = 1;
                            const expectedLoss = times - (beam[0].board[i][j] / 100);
                            if (expectedLoss < minLoss) {
                                minLoss = expectedLoss;
                                minLossAction = { row: i, col: j, times };
                            }
                        }
                    }
                }
                if (minLossAction) return minLossAction;
                break;
            }

            nextBeam.sort((a, b) => b.value - a.value);
            beam = nextBeam.slice(0, BEAM_WIDTH);
        }

        const bestLeaf = beam[0];
        if (!bestLeaf?.moveSeq?.length) {
            let bestAction = null;
            let maxVal = -Infinity;
            for (let r = 0; r < BOARD_SIZE; r++) {
                for (let c = 0; c < BOARD_SIZE; c++) {
                    if (board[r][c] !== null && board[r][c] > maxVal) {
                        if (r === 0 || r === BOARD_SIZE - 1 || c === 0 || c === BOARD_SIZE - 1) {
                            maxVal = board[r][c];
                            bestAction = { row: r, col: c, times: 1 };
                        }
                    }
                }
            }
            return bestAction || { row: 0, col: 0, times: 1 };
        }
        const firstMove = bestLeaf.moveSeq[0];
        return { ...firstMove, value: bestLeaf.value, scoreGain: bestLeaf.scoreGain, conservativeScore: bestLeaf.conservativeScore };
    };

    // ====== 动画等待 ======
    const waitForAnimationToFinish = async (timeout = 15000, interval = 100) => {
        const start = Date.now();
        let lastCount = -1, stableCount = 0;

        while (Date.now() - start < timeout) {
            const animating = document.querySelectorAll('.cell.highlight, .cell-clone, .vanish').length;
            if (animating === 0 && lastCount === 0) {
                stableCount++;
                if (stableCount >= 3) return true;
            } else {
                stableCount = 0;
            }
            lastCount = animating;
            await sleep(interval);
        }
        log('动画等待超时，强制继续', 'warn');
        return false;
    };

    // ====== 游戏结束检测 ======
    const isGameEndModalVisible = () => document.getElementById('game-end-modal')?.classList.contains('show') ?? false;

    const handleGameEndModal = () => {
        const btn = document.getElementById('modal-restart-btn');
        if (btn) {
            log('检测到游戏结束弹框，自动点击重启按钮...');
            btn.click();
            return true;
        }
        return false;
    };

    // ====== 自动点击主循环 ======
    let running = false, paused = false, stopRequested = false;

    const autoClickLoop = async () => {
        if (controlPanel) {
            pauseBtn.disabled = false;
            startBtn.disabled = true;
            updateStatusIndicator('running');
        }

        while (running && !stopRequested) {
            if (paused) {
                updateStatusIndicator('paused');
                await sleep(500);
                continue;
            }

            if (isGameEndModalVisible() && handleGameEndModal()) {
                log('游戏结束弹框已处理，等待游戏重启...');
                running = false;
                await sleep(3000);
                continue;
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
                await waitForAnimationToFinish(20000);
                if (getClicksLeftFromDOM() <= 0) {
                    log('行动点仍为0，自动通关结束。');
                    running = false;
                    break;
                } else {
                    log(`行动点恢复，继续循环。`);
                }
                continue;
            }

            const bestMove = conservativeBeamSearch(currentBoard, clicksLeft, scoreNow);
            if (!bestMove) {
                log('无可点击格子或得分为负，自动通关暂停。');
                running = false;
                break;
            }

            const phase = getCurrentPhase(scoreNow);
            log(`[阶段${phase.label}] 点击 (${bestMove.row},${bestMove.col}) x${bestMove.times}, 预计得分: ${bestMove.scoreGain}, ` +
                `布局评分: ${bestMove.conservativeScore}, 综合评分: ${(bestMove.value ?? 0).toFixed(1)}, 当前积分: ${scoreNow}, 行动点: ${clicksLeft}`);

            const cell = document.querySelector(`.cell[data-row="${bestMove.row}"][data-col="${bestMove.col}"]`);
            if (!cell) {
                log(`错误：未找到DOM格子 (${bestMove.row},${bestMove.col})，停止运行。`, 'error');
                running = false;
                break;
            }

            let delay = BASE_CLICK_DELAY;
            if (scoreNow >= 1500) delay = MIN_CLICK_DELAY + 40;
            else if (scoreNow >= 1000) delay = MIN_CLICK_DELAY + 20;
            else if (clicksLeft <= 2) delay = MIN_CLICK_DELAY;

            for (let k = 0; k < bestMove.times; k++) {
                cell.click();
                cell.style.transform = 'scale(1)';
                await sleep(delay - 30);
            }

            await waitForAnimationToFinish();
        }

        if (controlPanel) {
            pauseBtn.disabled = true;
            startBtn.disabled = false;
            updateStatus(stopRequested ? '已重置/停止' : '已停止');
            updateStatusIndicator('stopped');
        }
        log('自动点击循环结束。');
    };

    // ====== 监控游戏状态 ======
    let monitoring = false;

    const monitorGameState = async () => {
        if (monitoring) return;
        monitoring = true;
        log('进入后台监控状态，等待可用操作或游戏开始...');

        while (true) {
            if (stopRequested) {
                monitoring = false;
                log("监控已停止 (用户重置).");
                updateStatus('已重置/停止.');
                updateStatusIndicator('stopped');
                return;
            }

            if (paused || running) {
                await sleep(2000);
                continue;
            }

            if (isGameEndModalVisible() && handleGameEndModal()) {
                log('监控：游戏结束弹框已处理，等待重启...');
                await sleep(3000);
                continue;
            }

            const currentBoard = getBoardFromDOM();
            const clicksLeft = getClicksLeftFromDOM();
            const score = getScoreFromDOM();

            if (currentBoard && clicksLeft > 0 && !running && !paused && !stopRequested) {
                log(`监控：检测到可用操作 (分数: ${score})，自动启动保守策略。`);
                running = true;
                paused = false;
                updateStatus('运行中');
                updateStatusIndicator('running');
                autoClickLoop();
            }

            await sleep(2500);
        }
    };

    // ====== UI和控制面板 ======
    const createControlPanel = () => {
        if (document.getElementById('autoTapmeControlPanel')) return;

        const cp = document.createElement('div');
        cp.id = 'autoTapmeControlPanel';
        Object.assign(cp.style, {
            position: 'fixed', top: '10px', right: '10px', width: '420px', maxHeight: '520px',
            overflowY: 'auto', backgroundColor: 'rgba(0,0,0,0.9)', color: '#eee', fontSize: '14px',
            fontFamily: 'monospace', padding: '12px', borderRadius: '8px', zIndex: '99999',
            boxShadow: '0 0 15px rgba(0,0,0,0.5)', userSelect: 'none', transition: 'opacity 0.3s'
        });

        const createButton = (text, bgColor, hoverColor, onClick) => {
            const btn = document.createElement('button');
            btn.textContent = text;
            Object.assign(btn.style, {
                padding: '6px 12px', marginRight: '10px', cursor: 'pointer',
                backgroundColor: bgColor, color: 'white', border: 'none', borderRadius: '4px',
                transition: 'background-color 0.2s ease'
            });
            btn.onmouseover = () => btn.style.backgroundColor = hoverColor;
            btn.onmouseout = () => btn.style.backgroundColor = bgColor;
            btn.onclick = onClick;
            return btn;
        };

        const title = document.createElement('div');
        title.textContent = 'TapMePlus1 自动通关 v7.5';
        Object.assign(title.style, { fontWeight: 'bold', fontSize: '16px', textAlign: 'center', marginBottom: '10px' });

        const statusDiv = document.createElement('div');
        statusDiv.id = 'autoTapmeStatus';
        statusDiv.textContent = '状态：未运行';
        Object.assign(statusDiv.style, { marginBottom: '10px', color: '#bbb' });

        const statusIndicator = document.createElement('div');
        statusIndicator.id = 'statusIndicator';
        Object.assign(statusIndicator.style, {
            height: '5px', borderRadius: '5px', margin: '5px 0',
            transition: 'background-color 0.3s', backgroundColor: '#9E9E9E'
        });

        const btnContainer = document.createElement('div');
        btnContainer.style.marginBottom = '10px';
        btnContainer.style.textAlign = 'center';

        startBtn = createButton('开始', '#4CAF50', '#45a049', () => {
            if (!running) {
                running = true;
                paused = false;
                stopRequested = false;
                updateStatus('运行中');
                updateStatusIndicator('running');
                log('开始自动通关');
                autoClickLoop();
                pauseBtn.disabled = false;
                startBtn.disabled = true;
            }
        });

        pauseBtn = createButton('暂停', '#ff9800', '#f57c00', () => {
            if (!running && !paused) return;
            paused = !paused;
            pauseBtn.textContent = paused ? '继续' : '暂停';
            updateStatus(paused ? '已暂停' : (running ? '运行中' : '已停止'));
            updateStatusIndicator(paused ? 'paused' : (running ? 'running' : 'stopped'));
            log(paused ? '已暂停' : '已继续');
        });
        pauseBtn.disabled = true;

        resetBtn = createButton('重置', '#f44336', '#d32f2f', () => {
            running = false;
            paused = false;
            stopRequested = true;
            updateStatus('已重置/停止');
            updateStatusIndicator('stopped');
            log('已重置，停止自动通关');
            pauseBtn.textContent = '暂停';
            pauseBtn.disabled = true;
            startBtn.disabled = false;
        });

        exportBtn = createButton('导出日志', '#2196F3', '#1976D2', exportLog);

        [startBtn, pauseBtn, resetBtn, exportBtn].forEach(btn => btnContainer.appendChild(btn));

        const logHeader = document.createElement('div');
        logHeader.textContent = '日志区 (点击折叠/展开)';
        Object.assign(logHeader.style, {
            cursor: 'pointer', userSelect: 'none', marginBottom: '4px', fontWeight: 'bold', marginTop: '10px'
        });

        logArea = document.createElement('div');
        logArea.id = 'autoTapmeLogArea';
        Object.assign(logArea.style, {
            backgroundColor: '#1c1c1c', border: '1px solid #444', height: '300px', overflowY: 'auto',
            padding: '8px', whiteSpace: 'pre-wrap', userSelect: 'text', fontSize: '13px',
            lineHeight: '1.4em', borderRadius: '4px'
        });

        logHeader.onclick = () => {
            logArea.style.display = (logArea.style.display === 'none') ? 'block' : 'none';
            if (logArea.style.display === 'block') logArea.scrollTop = logArea.scrollHeight;
        };

        [title, statusDiv, statusIndicator, btnContainer, logHeader, logArea].forEach(el => cp.appendChild(el));
        document.body.appendChild(cp);

        // 替换全局变量
        window.statusDiv = statusDiv;
    };

    // ====== 状态指示器更新 ======
    const updateStatusIndicator = status => {
        const indicator = document.getElementById('statusIndicator');
        if (!indicator) return;

        const colors = {
            running: '#4CAF50',
            paused: '#FFC107',
            stopped: '#F44336',
            error: '#9C27B0',
        };
        indicator.style.backgroundColor = colors[status] || '#9E9E9E';
    };

    // ====== 状态更新 ======
    const updateStatus = text => {
        if (window.statusDiv) window.statusDiv.textContent = '状态：' + text;
    };

    // ====== 日志输出 ======
    const log = (msg, level = 'info') => {
        if (!logArea) return;

        const time = new Date().toLocaleTimeString();
        const colors = {
            error: '#ff6b6b',
            warn: '#ffd166',
            info: '#a9d6e5',
            success: '#06d6a0',
            debug: '#adb5bd',
        };

        const logEntry = document.createElement('div');
        logEntry.textContent = `[${time}] ${msg}`;
        logEntry.style.color = colors[level] || '#f8f9fa';
        logEntry.style.margin = '2px 0';
        logEntry.style.padding = '2px 5px';

        if (level === 'error') logEntry.style.backgroundColor = 'rgba(255, 107, 107, 0.1)';
        else if (level === 'warn') logEntry.style.backgroundColor = 'rgba(255, 209, 102, 0.1)';

        logEntry.style.cursor = 'pointer';
        logEntry.onclick = () => {
            navigator.clipboard.writeText(msg);
            logEntry.style.backgroundColor = 'rgba(0, 123, 255, 0.2)';
            setTimeout(() => {
                logEntry.style.backgroundColor =
                    level === 'error'
                        ? 'rgba(255, 107, 107, 0.1)'
                        : level === 'warn'
                            ? 'rgba(255, 209, 102, 0.1)'
                            : 'transparent';
            }, 500);
        };

        logArea.appendChild(logEntry);
        logArea.scrollTop = logArea.scrollHeight;
        console.log(`[AutoTapmePlus1] ${msg}`);
    };

    // ====== 导出日志 ======
    const exportLog = () => {
        if (!logArea) return;

        let logText = '';
        for (const child of logArea.children) logText += child.textContent + '\n';

        const blob = new Blob([logText], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `TapMePlus1_自动通关日志_${new Date()
            .toISOString()
            .slice(0, 19)
            .replace(/:/g, '-')}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        log('日志已导出', 'success');
    };

    // ====== 初始化 ======
    const init = () => {
        createControlPanel();
        updateStatus('未运行 (监控中)');
        updateStatusIndicator('stopped');
        log('TapMePlus1 自动通关脚本加载完成，目标突破3000分！', 'success');
        monitorGameState();
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
