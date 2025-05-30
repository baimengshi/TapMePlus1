// ==UserScript==
// @name         TapMePlus1 自动通关
// @namespace    http://tampermonkey.net/
// @version      7.4
// @description  自动通关脚本，动态权重布局评分，目标突破3000分（包含错误处理、性能优化和算法增强）
// @author       baimengshi
// @match        https://tapmeplus1.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';
    if (window.autoTapmePlus1Injected) return;
    window.autoTapmePlus1Injected = true;

    // ====== 基本参数 ======
    const BOARD_SIZE = 5;
    const MAX_CLICKS = 5;
    const BEAM_WIDTH = 8;
    const SEARCH_DEPTH = 4;
    const MIN_CLICK_DELAY = 60;
    const BASE_CLICK_DELAY = 100;
    const evaluationCache = new Map(); // 评估缓存
    const MAX_CACHE_SIZE = 500; // 添加缓存大小限制

    // ====== 动态权重函数 ======
    function getScoreWeight(score) {
        if (score < 800) return { score: 100, layout: 1 };
        if (score < 1500) return { score: 85, layout: 0.8 };
        if (score < 2000) return { score: 70, layout: 0.6 };
        return { score: 60, layout: 0.4 };
    }

    // ====== 工具函数 ======
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    function deepCopyBoard(board) {
        if (!board) return null;
        return board.map(row => row.slice());
    }

    // ====== 棋盘状态获取（增强版） ======
    function getBoardFromDOM() {
        try {
            const board = Array(BOARD_SIZE).fill(0).map(() => Array(BOARD_SIZE).fill(null));
            const cells = document.querySelectorAll('#game-board .cell:not(.empty)');

            if (cells.length === 0) {
                // Allow this state if game might be resetting
                // throw new Error('未找到有效的游戏格子'); 
                log('未找到有效的游戏格子 (可能在重置中)', 'debug');
                return null; // Return null instead of throwing if it's a transient state
            }

            let validCells = 0;
            cells.forEach(cell => {
                const row = parseInt(cell.dataset.row);
                const col = parseInt(cell.dataset.col);
                const val = parseInt(cell.textContent.trim());

                if (isNaN(row) || isNaN(col) || isNaN(val)) {
                    log(`无效的格子数据: row=${cell.dataset.row}, col=${cell.dataset.col}, val=${cell.textContent}`, 'warn');
                    return;
                }

                if (row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE) {
                    board[row][col] = val;
                    validCells++;
                }
            });

            if (validCells === 0 && cells.length > 0) { // Only throw if cells were found but all were invalid
                throw new Error('所有格子数据无效');
            }
            if (validCells === 0 && cells.length === 0) { // If no cells at all, return null
                return null;
            }

            return board;
        } catch (error) {
            log(`获取棋盘状态失败: ${error.message}`, 'error');
            return null;
        }
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

    // ====== 连通组查找 ======
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

                    if (currentGroup.length >= 3) {
                        groups.push({ cells: currentGroup, value: val });
                    }
                }
            }
        }

        return groups;
    }

    // ====== 重力模拟 ======
    function applyGravitySim(board) {
        const size = board.length;
        let hasMovedOrFilled = false;
        let emptyCellsCreated = 0;

        for (let col = 0; col < size; col++) {
            let writeIndex = size - 1;

            // 第一次循环：移动现有块
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

            // 第二次循环：填充空位
            while (writeIndex >= 0) {
                board[writeIndex][col] = (Math.random() * 5 | 0) + 1;
                hasMovedOrFilled = true;
                emptyCellsCreated++;
                writeIndex--;
            }
        }

        return { hasMovedOrFilled, emptyCellsCreated };
    }

    // ====== 模拟消除 ======
    function simulateElimination(board, initialClicksLeft) {
        let totalScore = 0;
        let currentClicksLeft = initialClicksLeft;
        let maxNumberInGame = 0;
        let chainCount = 0;
        let totalEmptyCellsCreated = 0;
        const simBoard = deepCopyBoard(board);

        if (!simBoard) { // Guard against null board
            log('simulateElimination received null board', 'error');
            return { board: null, totalScore: 0, totalClicksLeft: initialClicksLeft, maxNumberInGame: 0, chainCount: 0, emptyCellsCreated: 0 };
        }

        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                if (simBoard[r][c] !== null && simBoard[r][c] > maxNumberInGame) {
                    maxNumberInGame = simBoard[r][c];
                }
            }
        }

        while (true) {
            const groups = findAllConnectedGroups(simBoard);
            if (groups.length === 0) break;
            chainCount++;

            for (const group of groups) {
                let target = group.cells[0];
                for (const cell of group.cells) {
                    if (cell.r > target.r || (cell.r === target.r && cell.c < target.c)) {
                        target = cell;
                    }
                }

                if (target.r < 0 || target.r >= BOARD_SIZE || target.c < 0 || target.c >= BOARD_SIZE || simBoard[target.r]?.[target.c] === null) {
                    console.error('无效的目标格子或值为空:', target, simBoard[target.r]?.[target.c]);
                    continue;
                }

                const baseValue = simBoard[target.r][target.c];
                const cellsToClear = group.cells.filter(c => !(c.r === target.r && c.c === target.c));

                totalScore += baseValue * cellsToClear.length;

                for (const c of cellsToClear) {
                    if (c.r >= 0 && c.r < BOARD_SIZE && c.c >= 0 && c.c < BOARD_SIZE) {
                        simBoard[c.r][c.c] = null;
                    }
                }

                simBoard[target.r][target.c] = baseValue + 1;
                if (simBoard[target.r][target.c] > maxNumberInGame) {
                    maxNumberInGame = simBoard[target.r][target.c];
                }

                currentClicksLeft = Math.min(currentClicksLeft + 1, MAX_CLICKS);
            }

            const gravityResult = applyGravitySim(simBoard);
            totalEmptyCellsCreated += gravityResult.emptyCellsCreated;

            if (!gravityResult.hasMovedOrFilled && findAllConnectedGroups(simBoard).length === 0) {
                break;
            }
        }

        return {
            board: simBoard,
            totalScore,
            totalClicksLeft: currentClicksLeft,
            maxNumberInGame,
            chainCount,
            emptyCellsCreated: totalEmptyCellsCreated
        };
    }

    // ====== 布局评分（带缓存） ======
    // MODIFICATION: Removed unused lastClick parameter
    function evaluateBoardConservative(board, currentScore) {
        const cacheKey = JSON.stringify(board) + currentScore;

        if (evaluationCache.has(cacheKey)) {
            return evaluationCache.get(cacheKey);
        }
        if (!board) { // Guard against null board
            log('evaluateBoardConservative received null board', 'error');
            return 0;
        }

        const groups = findAllConnectedGroups(board);
        let maxGroupSize = 0, groupCount = 0;
        let bigGroupCount = 0;

        for (const g of groups) {
            if (!g.cells || g.cells.length === 0) continue;
            groupCount++;
            if (g.cells.length > maxGroupSize) maxGroupSize = g.cells.length;
            if (g.cells.length >= 5) bigGroupCount++;
        }

        let potentialChainCount = 0;
        let edgeGroupSize = 0;
        let isolated = 0;
        const colorCounts = {};
        let expandableGroupBonus = 0;
        let sum = 0;
        let count = 0;

        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                const val = board[r][c];
                if (val === null) continue;

                colorCounts[val] = (colorCounts[val] || 0) + 1;
                sum += val;
                count++;

                let hasSameValueNeighbor = false;
                for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                    const nr = r + dr, nc = c + dc;
                    if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE) {
                        if (board[nr][nc] === val) {
                            hasSameValueNeighbor = true;
                        }
                        else if (board[nr][nc] === null) {
                            expandableGroupBonus += 2;
                        }
                    }
                }

                if (hasSameValueNeighbor) {
                    potentialChainCount++;
                    if (r === 0 || r === BOARD_SIZE - 1 || c === 0 || c === BOARD_SIZE - 1) {
                        edgeGroupSize++;
                    }
                } else {
                    isolated++;
                }
            }
        }

        let chainPotential = 0;
        for (const color in colorCounts) {
            const numCount = colorCounts[color]; // Renamed to avoid conflict with outer 'count'
            if (numCount >= 4) chainPotential += 20;
            if (numCount >= 6) chainPotential += 40;
        }

        const avg = count ? sum / count : 3;
        let variance = 0;
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                const val = board[r][c];
                if (val !== null) {
                    variance += Math.pow(val - avg, 2);
                }
            }
        }
        variance = count ? variance / count : 0;

        const empty = BOARD_SIZE * BOARD_SIZE - count;
        let conservativeScoreVal = // Renamed to avoid conflict
            groupCount * 2 +
            maxGroupSize * 8 +
            bigGroupCount * 10 +
            edgeGroupSize * 2 +
            potentialChainCount * 2 +
            expandableGroupBonus * 1 +
            empty * 1 +
            chainPotential * 0.8 +
            -isolated * 2 +
            -variance * 0.2;

        evaluationCache.set(cacheKey, conservativeScoreVal);
        if (evaluationCache.size > MAX_CACHE_SIZE) {
            const keys = Array.from(evaluationCache.keys()).slice(0, 100);
            keys.forEach(key => evaluationCache.delete(key));
        }

        return conservativeScoreVal;
    }

    // ====== 阶段策略 ======
    // MODIFICATION: Removed unused riskFactor
    function getCurrentPhase(score) {
        if (score >= 2000) return {
            maxClicks: 2,
            label: '2000+',
            strategy: 'focusLargeGroups'
        };
        if (score >= 1800) return {
            maxClicks: 2,
            label: '1800+',
            strategy: 'balanceEdgeAndCenter'
        };
        if (score >= 1500) return { // This was duplicated, I'll fix it
            maxClicks: 2,
            label: '1500+',
            strategy: 'maximizeChainPotential'
        };
        // Corrected continuation:
        if (score >= 1000) return {
            maxClicks: 2,
            label: '1000+',
            strategy: 'conservativeGrowth'
        };
        return { // Base case
            maxClicks: 2, // Default max clicks for a move
            label: '基础',
            strategy: 'default'
        };
    }

    // ====== 光束搜索（优化版） ======
    function conservativeBeamSearch(board, clicksLeft, scoreNow) {
        if (!board) {
            log('conservativeBeamSearch received null board at start', 'error');
            return { row: 0, col: 0, times: 1, value: 0, scoreGain: 0, conservativeScore: 0 }; // Fallback
        }
        const phase = getCurrentPhase(scoreNow);
        const weights = getScoreWeight(scoreNow);

        let strategyWeights = { score: weights.score, layout: weights.layout };

        switch (phase.strategy) {
            case 'focusLargeGroups':
                strategyWeights.layout *= 1.5;
                break;
            case 'balanceEdgeAndCenter':
                strategyWeights.score *= 1.2;
                break;
            case 'maximizeChainPotential':
                strategyWeights.score *= 1.5;
                break;
            case 'conservativeGrowth':
                strategyWeights.layout *= 1.2;
                break;
        }

        if (clicksLeft <= 2) {
            let bestEmergencyMove = null;
            let maxEmergencyScore = -Infinity;

            for (let i = 0; i < BOARD_SIZE; i++) {
                for (let j = 0; j < BOARD_SIZE; j++) {
                    if (board[i][j] !== null) {
                        const tempBoard = deepCopyBoard(board);
                        if (!tempBoard) continue; // Should not happen if board is valid
                        tempBoard[i][j]++;
                        const sim = simulateElimination(tempBoard, clicksLeft - 1);

                        if (sim.totalScore > maxEmergencyScore) {
                            maxEmergencyScore = sim.totalScore;
                            bestEmergencyMove = { row: i, col: j, times: 1 };
                        }
                    }
                }
            }

            if (bestEmergencyMove && maxEmergencyScore >= 0) { // Allow 0 score moves if nothing better
                log(`终局策略: 选择直接得分最高的移动 (${bestEmergencyMove.row},${bestEmergencyMove.col})`, 'info');
                return { // MODIFICATION: Augmented return object
                    row: bestEmergencyMove.row,
                    col: bestEmergencyMove.col,
                    times: bestEmergencyMove.times,
                    scoreGain: maxEmergencyScore,
                    conservativeScore: 0, // Not calculated in emergency
                    value: maxEmergencyScore * strategyWeights.score // Approximate
                };
            }
        }

        let root = {
            board: deepCopyBoard(board),
            clicksLeft: clicksLeft,
            score: scoreNow,
            moveSeq: [],
            value: 0,
            scoreGain: 0,
            conservativeScore: 0
        };
        if (!root.board) { // Guard
            log('conservativeBeamSearch: root board is null', 'error');
            return { row: 0, col: 0, times: 1, value: 0, scoreGain: 0, conservativeScore: 0 };
        }

        let beam = [root];
        let bestLeaf = root; // Initialize bestLeaf with root in case no better moves are found

        for (let depth = 0; depth < SEARCH_DEPTH; depth++) {
            let nextBeam = [];
            for (const currentNode of beam) {
                if (!currentNode.board) { // Guard
                    log(`conservativeBeamSearch: currentNode.board is null at depth ${depth}`, 'warn');
                    continue;
                }
                for (let i = 0; i < BOARD_SIZE; i++) {
                    for (let j = 0; j < BOARD_SIZE; j++) {
                        if (currentNode.board[i][j] !== null) {
                            const maxClicksForPhase = Math.min(currentNode.clicksLeft, phase.maxClicks);
                            for (let times = 1; times <= maxClicksForPhase; times++) {
                                if (isNaN(currentNode.board[i][j])) {
                                    log(`发现无效的棋盘值 at (${i},${j}): ${currentNode.board[i][j]}`, 'warn');
                                    continue;
                                }

                                let boardAfter = deepCopyBoard(currentNode.board);
                                if (!boardAfter) continue;
                                for (let k = 0; k < times; k++) boardAfter[i][j]++;

                                let clicksLeftAfter = currentNode.clicksLeft - times;
                                let sim = simulateElimination(boardAfter, clicksLeftAfter);
                                if (!sim.board) { // Guard
                                    log(`Simulation returned null board for move (${i},${j})x${times}`, 'warn');
                                    continue;
                                }


                                let scoreGain = isNaN(sim.totalScore) ? 0 : sim.totalScore;
                                // MODIFICATION: Call evaluateBoardConservative without lastClick
                                let conservativeScoreVal = evaluateBoardConservative(sim.board, currentNode.score + scoreGain);

                                if (isNaN(conservativeScoreVal)) {
                                    log(`计算布局评分失败 at (${i},${j})`, 'warn');
                                    conservativeScoreVal = 0;
                                }

                                let value = scoreGain * strategyWeights.score + conservativeScoreVal * strategyWeights.layout;

                                if (isNaN(value)) {
                                    log(`计算综合评分失败 at (${i},${j})`, 'warn');
                                    value = 0;
                                }

                                let newNode = {
                                    board: deepCopyBoard(sim.board),
                                    clicksLeft: sim.totalClicksLeft,
                                    score: currentNode.score + scoreGain,
                                    moveSeq: currentNode.moveSeq.concat([{ row: i, col: j, times }]),
                                    value: currentNode.value + value, // Accumulate value for deeper search
                                    scoreGain: scoreGain, // Store score gain of this specific step for logging
                                    conservativeScore: conservativeScoreVal // Store layout score of this specific step
                                };
                                if (!newNode.board) { // Guard
                                    log(`newNode created with null board for move (${i},${j})x${times}`, 'warn');
                                    continue;
                                }
                                nextBeam.push(newNode);
                            }
                        }
                    }
                }
            }

            if (nextBeam.length === 0) {
                // If beam is empty, use the best from the previous depth or root
                bestLeaf = beam.length > 0 ? beam[0] : (bestLeaf || root);
                break;
            }

            nextBeam.sort((a, b) => b.value - a.value);
            beam = nextBeam.slice(0, BEAM_WIDTH);
            if (beam.length > 0 && beam[0].value > (bestLeaf ? bestLeaf.value : -Infinity)) {
                bestLeaf = beam[0];
            }
        }

        // If bestLeaf is still root and has no moveSeq, or if no moves were found
        if (!bestLeaf || !bestLeaf.moveSeq || bestLeaf.moveSeq.length === 0) {
            log('光束搜索未找到有效移动序列，尝试备用策略。', 'warn');
            let fallbackAction = null;
            let maxFallbackValue = -Infinity;

            for (let r = 0; r < BOARD_SIZE; r++) {
                for (let c = 0; c < BOARD_SIZE; c++) {
                    if (board[r][c] !== null) {
                        // Simple heuristic: value of the cell itself
                        const cellValue = board[r][c];
                        // Prioritize edges slightly
                        const isEdge = r === 0 || r === BOARD_SIZE - 1 || c === 0 || c === BOARD_SIZE - 1;
                        const currentFallbackValue = cellValue + (isEdge ? 2 : 0);

                        if (currentFallbackValue > maxFallbackValue) {
                            maxFallbackValue = currentFallbackValue;
                            fallbackAction = { row: r, col: c, times: 1 };
                        }
                    }
                }
            }
            if (fallbackAction) {
                log(`备用策略: 选择 (${fallbackAction.row},${fallbackAction.col})`, 'info');
                return { ...fallbackAction, value: 0, scoreGain: 0, conservativeScore: 0 }; // Add default fields
            }
            // Absolute fallback if even the above fails
            log('备用策略也失败，选择 (0,0)x1 作为绝对备用。', 'error');
            return { row: 0, col: 0, times: 1, value: 0, scoreGain: 0, conservativeScore: 0 };
        }


        const firstMoveInSeq = bestLeaf.moveSeq[0];
        // Find the node in the first level of the beam that corresponds to this first move
        // This is to get the immediate scoreGain and conservativeScore for the *first* move.
        let firstStepNode = beam.find(node => node.moveSeq.length > 0 &&
            node.moveSeq[0].row === firstMoveInSeq.row &&
            node.moveSeq[0].col === firstMoveInSeq.col &&
            node.moveSeq[0].times === firstMoveInSeq.times);
        if (!firstStepNode) { // If not found (e.g. beam was cut short), use bestLeaf's overall scoreGain
            firstStepNode = { scoreGain: bestLeaf.scoreGain / (bestLeaf.moveSeq.length || 1), conservativeScore: bestLeaf.conservativeScore };
        }


        return {
            row: firstMoveInSeq.row,
            col: firstMoveInSeq.col,
            times: firstMoveInSeq.times,
            value: bestLeaf.value, // Overall value of the sequence
            scoreGain: firstStepNode.scoreGain, // Score gain of the first move
            conservativeScore: firstStepNode.conservativeScore // Layout score after the first move
        };
    }

    // ====== 动画等待 ======
    async function waitForAnimationToFinish(timeout = 15000, interval = 100) {
        const start = Date.now();
        let lastAnimatingCount = -1;
        let stableCount = 0; // Counts consecutive checks with no animations

        while (Date.now() - start < timeout) {
            const animatingElements = document.querySelectorAll('.cell.highlight, .cell-clone, .vanish');
            const currentCount = animatingElements.length;

            if (currentCount === 0) {
                if (lastAnimatingCount === 0) { // Check if it was also 0 in the previous iteration
                    stableCount++;
                    if (stableCount >= 3) { // Require 3 stable checks (e.g. 300ms of no animation)
                        return true;
                    }
                } else {
                    stableCount = 1; // Reset if it just became 0
                }
            } else {
                stableCount = 0; // Reset if animations are active
            }

            lastAnimatingCount = currentCount;
            await sleep(interval);
        }

        log('动画等待超时，强制继续', 'warn');
        return false; // Indicate timeout
    }


    // ====== 游戏结束检测 ======
    function isGameEndModalVisible() {
        const modal = document.getElementById('game-end-modal');
        return modal && modal.classList.contains('show');
    }

    function handleGameEndModal() {
        const restartButton = document.getElementById('modal-restart-btn');
        if (restartButton) {
            log('检测到游戏结束弹框，自动点击重启按钮...');
            try {
                restartButton.click();
            } catch (e) {
                log(`重启按钮点击时发生错误 (可能是游戏内部错误): ${e.message}`, 'warn');
            }
            return true;
        }
        return false;
    }

    // ====== 自动点击主循环 ======
    let running = false, paused = false, stopRequested = false;
    let controlPanel, statusDiv, logArea, startBtn, pauseBtn, resetBtn, exportBtn;

    async function autoClickLoop() {
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
            updateStatusIndicator('running'); // Ensure it's green if running and not paused

            if (isGameEndModalVisible()) {
                if (handleGameEndModal()) {
                    log('游戏结束弹框已处理，等待游戏重启...');
                    running = false; // Stop current loop, monitor will pick it up
                    await sleep(3000); // Give time for game to reset
                    continue; // Will exit loop due to running = false
                }
            }

            const clicksLeft = getClicksLeftFromDOM();
            const scoreNow = getScoreFromDOM();
            const currentBoard = getBoardFromDOM();

            if (!currentBoard) {
                log('无法获取棋盘状态，等待1秒...', 'warn');
                await sleep(1000);
                continue;
            }

            if (clicksLeft <= 0) {
                log('行动点用尽，等待连锁反应或游戏结束 (等待5秒)...');
                await waitForAnimationToFinish(5000); // Wait a bit longer for chains
                const newClicksLeft = getClicksLeftFromDOM();
                if (newClicksLeft <= 0 && !isGameEndModalVisible()) { // Check again if modal appeared
                    log('行动点仍为0且无结束弹窗，可能游戏卡住或结束。停止自动通关。');
                    running = false; // Stop if still no clicks and no end modal
                    break;
                } else if (newClicksLeft > 0) {
                    log(`连锁反应增加了点击次数，行动点恢复到 ${newClicksLeft}，继续循环。`, 'success');
                }
                // If modal appeared, the next loop iteration will handle it.
                continue;
            }

            const bestMove = conservativeBeamSearch(currentBoard, clicksLeft, scoreNow);
            if (!bestMove || (bestMove.row === undefined || bestMove.col === undefined)) { // Check for valid move object
                log('无可点击格子或所有动作预计得分为负/无效，自动通关暂停。', 'error');
                running = false; // Pause if no good move found
                break;
            }

            const phase = getCurrentPhase(scoreNow);
            log(`[阶段${phase.label}] 点击格子 (${bestMove.row},${bestMove.col}) x${bestMove.times}, ` +
                `预计实际得分: ${bestMove.scoreGain !== undefined ? bestMove.scoreGain.toFixed(1) : 'N/A'}, ` +
                `布局评分: ${bestMove.conservativeScore !== undefined ? bestMove.conservativeScore.toFixed(1) : 'N/A'}, ` +
                `综合评分: ${(bestMove.value ?? 0).toFixed(1)}, ` +
                `当前积分: ${scoreNow}, 行动点: ${clicksLeft}`);

            const cell = document.querySelector(`.cell[data-row="${bestMove.row}"][data-col="${bestMove.col}"]`);
            if (!cell) {
                log(`错误：未找到DOM格子 (${bestMove.row},${bestMove.col})，停止运行。`, 'error');
                running = false;
                break;
            }

            let delay = BASE_CLICK_DELAY;
            if (scoreNow >= 1500) delay = MIN_CLICK_DELAY + 40;
            else if (scoreNow >= 1000) delay = MIN_CLICK_DELAY + 20;
            else if (clicksLeft <= 2) delay = MIN_CLICK_DELAY; // Faster for endgame

            for (let k = 0; k < bestMove.times; k++) {
                cell.click();
                // Optional: visual feedback for script click
                // cell.style.outline = '2px solid red';
                // setTimeout(() => cell.style.outline = '', 100);
                await sleep(delay); // Apply full delay after each click in a multi-click move
            }
            await waitForAnimationToFinish(); // Wait for animations after all clicks for the move are done
        }

        if (controlPanel) {
            pauseBtn.disabled = true;
            startBtn.disabled = false;
            updateStatus(stopRequested ? '已重置/停止' : (running ? '运行中 (错误停止)' : '已停止'));
            updateStatusIndicator(stopRequested ? 'stopped' : 'stopped');
        }
        log('自动点击循环结束。');
    }

    // ====== 监控游戏状态 ======
    let monitoring = false;

    async function monitorGameState() {
        if (monitoring) return;
        monitoring = true;
        log('进入后台监控状态，等待可用操作或游戏开始...');

        while (true) { // Keep monitoring indefinitely unless stopRequested
            if (stopRequested) {
                monitoring = false;
                log("监控已停止 (用户重置).");
                updateStatus('已重置/停止.');
                updateStatusIndicator('stopped');
                return;
            }

            if (paused || running) { // If actively running or paused by user, don't auto-start
                await sleep(2000);
                continue;
            }

            // If not running, not paused, and not stopRequested, check if we can start
            if (isGameEndModalVisible()) {
                if (handleGameEndModal()) {
                    log('监控：游戏结束弹框已处理，等待游戏重启...');
                    await sleep(3000); // Give time for game to reset
                    continue;
                }
            }

            const currentBoard = getBoardFromDOM();
            const clicksLeft = getClicksLeftFromDOM();
            const score = getScoreFromDOM();

            // Auto-start condition: board is valid, clicks are available, and not already running/paused
            if (currentBoard && clicksLeft > 0 && !running && !paused && !stopRequested) {
                log(`监控：检测到可用操作 (分数: ${score}, 点击: ${clicksLeft})，自动启动。`);
                running = true;
                paused = false; // Ensure not paused
                stopRequested = false; // Ensure not stopped
                updateStatus('运行中');
                updateStatusIndicator('running');
                autoClickLoop(); // This will run until it stops itself or is stopped
            }

            await sleep(2500); // Check interval
        }
    }

    // ====== UI和控制面板 ======
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
        title.textContent = 'TapMePlus1 自动通关 v7.4'; // Updated version
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

        const statusIndicator = document.createElement('div');
        statusIndicator.id = 'statusIndicator';
        statusIndicator.style.height = '5px';
        statusIndicator.style.borderRadius = '5px';
        statusIndicator.style.margin = '5px 0';
        statusIndicator.style.transition = 'background-color 0.3s';
        statusIndicator.style.backgroundColor = '#9E9E9E'; // Default grey
        controlPanel.appendChild(statusIndicator);

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
                running = true;
                paused = false;
                stopRequested = false;
                updateStatus('运行中');
                log('开始自动通关');
                autoClickLoop(); // autoClickLoop will manage button states internally now
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
            if (!running && !paused) return; // Do nothing if not started
            paused = !paused;
            pauseBtn.textContent = paused ? '继续' : '暂停';
            updateStatus(paused ? '已暂停' : (running ? '运行中' : '已停止'));
            updateStatusIndicator(paused ? 'paused' : (running ? 'running' : 'stopped'));
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
            running = false;
            paused = false;
            stopRequested = true; // This will stop both autoClickLoop and monitorGameState
            updateStatus('已重置/停止');
            log('已重置，停止自动通关');
            pauseBtn.textContent = '暂停';
            pauseBtn.disabled = true;
            startBtn.disabled = false;
            updateStatusIndicator('stopped');
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
        logHeader.style.marginTop = '10px';
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
                logArea.scrollTop = logArea.scrollHeight;
            } else {
                logArea.style.display = 'none';
            }
        };

        document.body.appendChild(controlPanel);
    }

    // ====== 状态指示器更新 ======
    function updateStatusIndicator(statusKey) { // Renamed parameter for clarity
        const indicator = document.getElementById('statusIndicator');
        if (!indicator) return;

        const colors = {
            running: '#4CAF50', // Green
            paused: '#FFC107',  // Amber
            stopped: '#F44336', // Red
            error: '#9C27B0',   // Purple (for critical errors if needed)
            default: '#9E9E9E'  // Grey
        };

        indicator.style.backgroundColor = colors[statusKey] || colors.default;
    }

    // ====== 日志与状态 ======
    function updateStatus(text) {
        if (statusDiv) statusDiv.textContent = '状态：' + text;
    }

    function log(msg, level = 'info') {
        if (!logArea) {
            console.log(`[AutoTapmePlus1 Log Buffer] ${msg}`); // Buffer if logArea not ready
            return;
        }

        const time = new Date().toLocaleTimeString();
        const colors = {
            error: '#ff6b6b', warn: '#ffd166', info: '#a9d6e5',
            success: '#06d6a0', debug: '#adb5bd'
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
            navigator.clipboard.writeText(msg).then(() => {
                logEntry.style.backgroundColor = 'rgba(0, 123, 255, 0.2)'; // Blue flash for copy
                setTimeout(() => {
                    logEntry.style.backgroundColor = level === 'error' ? 'rgba(255, 107, 107, 0.1)' :
                        level === 'warn' ? 'rgba(255, 209, 102, 0.1)' : 'transparent';
                }, 500);
            }).catch(err => console.error('Failed to copy log: ', err));
        };

        logArea.appendChild(logEntry);
        if (logArea.style.display !== 'none') { // Only scroll if visible
            logArea.scrollTop = logArea.scrollHeight;
        }
        console.log(`[AutoTapmePlus1] ${msg}`); // Also log to browser console
    }

    function exportLog() {
        if (!logArea) return;
        let logText = '';
        for (const child of logArea.children) {
            logText += child.textContent + '\n';
        }
        const blob = new Blob([logText], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `TapMePlus1_自动通关日志_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        log('日志已导出', 'success');
    }

    // ====== 初始化 ======
    function init() {
        createControlPanel();
        updateStatus('未运行 (监控中)');
        updateStatusIndicator('default'); // Start with default grey
        log('TapMePlus1 自动通关脚本(v7.4)加载完成！', 'success');
        monitorGameState(); // Start monitoring
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
