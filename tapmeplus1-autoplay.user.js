// ==UserScript==
// @name         TapMePlus1 自动通关（高分保守优化）v7.1
// @namespace    http://tampermonkey.net/
// @version      7.1
// @description  自动通关脚本，动态权重布局评分，目标突破2000分
// @author       泡小胡呢
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

    // ====== 动态权重函数 ======
    function getScoreWeight(score) {
        if (score < 800) return { score: 100, layout: 1 };
        if (score < 1500) return { score: 85, layout: 0.8 }; // 提高布局权重
        if (score < 2000) return { score: 70, layout: 0.6 }; // 新增2000分过渡阶段
        return { score: 60, layout: 0.4 }; // 2000分以上保留部分布局权重
    }

    // ====== 工具函数 ======
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    function deepCopyBoard(board) {
        if (!board) return null;
        return board.map(row => row.slice());
    }

    // ====== DOM读取 ======
    function getBoardFromDOM() {
        const board = Array(BOARD_SIZE).fill(0).map(() => Array(BOARD_SIZE).fill(null));
        const cells = document.querySelectorAll('#game-board .cell:not(.empty)'); // 排除空单元格

        cells.forEach(cell => {
            const row = parseInt(cell.dataset.row);
            const col = parseInt(cell.dataset.col);
            const val = parseInt(cell.textContent.trim()); // 使用textContent替代data-value

            if (!isNaN(val) && row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE) {
                board[row][col] = val;
            }
        });
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
                    if (currentGroup.length >= 3) groups.push({ cells: currentGroup, value: val });
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
            let emptyRow = size - 1;

            // 从底部向上移动格子
            for (let row = size - 1; row >= 0; row--) {
                if (board[row][col] !== null) {
                    // 确保位置有效
                    if (row !== emptyRow &&
                        emptyRow >= 0 && emptyRow < size) {
                        board[emptyRow][col] = board[row][col];
                        board[row][col] = null;
                        hasMovedOrFilled = true;
                    }

                    // 确保 emptyRow 不会越界
                    if (emptyRow > 0) {
                        emptyRow--;
                    }
                }
            }

            // 填充空白格子
            while (emptyRow >= 0) {
                // 确保位置有效
                if (emptyRow >= 0 && emptyRow < size) {
                    board[emptyRow][col] = Math.floor(Math.random() * 5) + 1;
                    hasMovedOrFilled = true;
                    emptyCellsCreated++;
                }
                emptyRow--;
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

        // 初始化最大数值
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

            // 修复：确保在访问前初始化 baseValue
            for (const group of groups) {
                // 1. 找到目标格子（保留的格子）
                let target = group.cells[0];
                for (const cell of group.cells) {
                    if (cell.r > target.r || (cell.r === target.r && cell.c < target.c)) {
                        target = cell;
                    }
                }

                // 2. 确保目标格子有效
                if (target.r < 0 || target.r >= BOARD_SIZE ||
                    target.c < 0 || target.c >= BOARD_SIZE) {
                    console.error('无效的目标格子:', target);
                    continue;
                }

                // 3. 获取基础值（确保在访问前初始化）
                const baseValue = simBoard[target.r][target.c];

                // 4. 确定要清除的格子（除目标外的所有格子）
                const cellsToClear = group.cells.filter(c =>
                    !(c.r === target.r && c.c === target.c)
                );

                // 5. 计算得分
                totalScore += baseValue * cellsToClear.length;

                // 6. 清除格子
                for (const c of cellsToClear) {
                    if (c.r >= 0 && c.r < BOARD_SIZE &&
                        c.c >= 0 && c.c < BOARD_SIZE) {
                        simBoard[c.r][c.c] = null;
                    }
                }

                // 7. 增加目标格子的值
                simBoard[target.r][target.c] = baseValue + 1;

                // 8. 更新最大数值
                if (simBoard[target.r][target.c] > maxNumberInGame) {
                    maxNumberInGame = simBoard[target.r][target.c];
                }

                // 9. 恢复点击次数
                currentClicksLeft = Math.min(currentClicksLeft + 1, MAX_CLICKS);
            }

            // 应用重力效果
            const gravityResult = applyGravitySim(simBoard);
            totalEmptyCellsCreated += gravityResult.emptyCellsCreated;

            // 检查是否结束
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


    // ====== 布局评分优化 ======
    function evaluateBoardConservative(board, currentScore, lastClick) {
        // 1. 最大团奖励
        const groups = findAllConnectedGroups(board);
        let maxGroupSize = 0, groupCount = 0;
        let bigGroupCount = 0;
        for (const g of groups) {
            if (!g.cells || g.cells.length === 0) continue;
            groupCount++;
            if (g.cells.length > maxGroupSize) maxGroupSize = g.cells.length;
            if (g.cells.length >= 5) bigGroupCount++;
        }

        // 2. 潜在连锁奖励
        let potentialChainCount = 0;
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                if (board[r][c] !== null) {
                    let same = 0;
                    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                        const nr = r + dr, nc = c + dc;
                        if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE && board[nr][nc] === board[r][c]) same++;
                    }
                    if (same >= 1) potentialChainCount++;
                }
            }
        }

        // 3. 可扩展团奖励
        let expandableGroupBonus = 0;
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                if (board[r][c] !== null) {
                    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                        const nr = r + dr, nc = c + dc;
                        if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE && board[nr][nc] === null) {
                            const tempBoard = deepCopyBoard(board);
                            tempBoard[nr][nc] = board[r][c];
                            const newGroups = findAllConnectedGroups(tempBoard);
                            for (const g of newGroups) {
                                if (g.cells && g.cells.some(cell => cell.r === r && cell.c === c)) {
                                    expandableGroupBonus += 2;
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }

        // 4. 边缘大团奖励
        let edgeGroupSize = 0;
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                if (board[r][c] !== null && (r === 0 || r === BOARD_SIZE - 1 || c === 0 || c === BOARD_SIZE - 1)) {
                    let same = 0;
                    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                        const nr = r + dr, nc = c + dc;
                        if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE && board[nr][nc] === board[r][c]) same++;
                    }
                    if (same >= 1) edgeGroupSize++;
                }
            }
        }

        // 5. 孤立/死角惩罚
        let isolated = 0;
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                if (board[r][c] !== null) {
                    let hasSameValueNeighbor = false;
                    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                        const nr = r + dr, nc = c + dc;
                        if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE) {
                            if (board[nr][nc] === board[r][c]) {
                                hasSameValueNeighbor = true;
                                break;
                            }
                        }
                    }
                    if (!hasSameValueNeighbor) isolated++;
                }
            }
        }

        // 6. 分布均匀性
        let vals = board.flat().filter(v => v !== null);
        let avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 3;
        let variance = vals.length ? vals.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / vals.length : 0;

        // 7. 空格奖励
        let empty = board.flat().filter(v => v === null).length;

        // 8. 优先消边角奖励
        let edgeClickBonus = 0;
        if (lastClick) {
            const { row, col } = lastClick;
            if ((row === 0 || row === BOARD_SIZE - 1) && (col === 0 || col === BOARD_SIZE - 1)) {
                edgeClickBonus += 40;
            }
            else if (row === 0 || row === BOARD_SIZE - 1 || col === 0 || col === BOARD_SIZE - 1) {
                edgeClickBonus += 20;
            }
        }

        // 9. 优先合大团奖励
        let mergeBigGroupBonus = 0;
        if (lastClick) {
            for (const g of groups) {
                if (!g.cells || g.cells.length === 0) continue;
                if (g.cells.length >= 5 && g.cells.some(cell => cell.r === lastClick.row && cell.c === lastClick.col)) {
                    mergeBigGroupBonus += 50 + (g.cells.length - 5) * 10;
                }
            }
        }

        // 10. 潜在连锁价值
        let chainPotential = 0;
        // 直接实现颜色分组统计
        const colorCounts = {};
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                const val = board[r][c];
                if (val !== null) {
                    colorCounts[val] = (colorCounts[val] || 0) + 1;
                }
            }
        }

        // 分析颜色分布
        for (const color in colorCounts) {
            const count = colorCounts[color];
            if (count >= 4) chainPotential += 20; // 4个以上同色块
            if (count >= 6) chainPotential += 40; // 6个以上额外奖励
        }

        // ====== 权重再降 ======
        let conservativeScore =
            groupCount * 2 +
            maxGroupSize * 8 +
            bigGroupCount * 10 +
            edgeGroupSize * 2 +
            potentialChainCount * 2 +
            expandableGroupBonus * 1 +
            empty * 1 +
            edgeClickBonus +
            mergeBigGroupBonus +
            chainPotential * 0.8 + // 添加连锁潜力
            -isolated * 2 +
            -variance * 0.2;

        return conservativeScore;
    }


    // ====== 动态权重beamSearch ======
    function conservativeBeamSearch(board, clicksLeft, scoreNow) {
        const phase = getCurrentPhase(scoreNow);
        const weights = getScoreWeight(scoreNow);

        let root = {
            board: deepCopyBoard(board),
            clicksLeft: clicksLeft,
            score: scoreNow,
            moveSeq: [],
            value: 0,
            scoreGain: 0
        };
        let beam = [root];
        let bestLeaf = null;

        for (let depth = 0; depth < SEARCH_DEPTH; depth++) {
            let nextBeam = [];
            for (const currentNode of beam) {
                for (let i = 0; i < BOARD_SIZE; i++) {
                    for (let j = 0; j < BOARD_SIZE; j++) {
                        if (currentNode.board[i][j] !== null) {
                            const maxClicksForPhase = Math.min(currentNode.clicksLeft, phase.maxClicks);
                            for (let times = 1; times <= maxClicksForPhase; times++) {
                                let boardAfter = deepCopyBoard(currentNode.board);
                                for (let k = 0; k < times; k++) boardAfter[i][j]++;
                                let clicksLeftAfter = currentNode.clicksLeft - times;
                                let sim = simulateElimination(boardAfter, clicksLeftAfter);

                                let scoreGain = sim.totalScore;
                                let conservativeScore = evaluateBoardConservative(sim.board, currentNode.score + scoreGain, { row: i, col: j });

                                // 1500分以上，只要scoreGain>0就允许点击
                                if (scoreNow >= 1500) {
                                    if (scoreGain <= 0) continue;
                                } else {
                                    // 低分段允许scoreGain=0但布局分极高的动作
                                    if (scoreGain <= 0 && conservativeScore < 1000) continue;
                                }

                                let value = scoreGain * weights.score + conservativeScore * weights.layout;

                                let newNode = {
                                    board: deepCopyBoard(sim.board),
                                    clicksLeft: sim.totalClicksLeft,
                                    score: currentNode.score + scoreGain,
                                    moveSeq: currentNode.moveSeq.concat([{ row: i, col: j, times }]),
                                    value: currentNode.value + value,
                                    scoreGain: currentNode.scoreGain + scoreGain,
                                    conservativeScore: conservativeScore
                                };
                                nextBeam.push(newNode);
                            }
                        }
                    }
                }
            }

            if (nextBeam.length === 0) {
                // 死局处理：选择最小损失的操作
                let minLossAction = null;
                let minLoss = Infinity;

                // 使用根节点状态进行死局处理
                for (let i = 0; i < BOARD_SIZE; i++) {
                    for (let j = 0; j < BOARD_SIZE; j++) {
                        if (root.board[i][j] !== null) {
                            // 只考虑1次点击
                            const times = 1;

                            // 计算预期损失 = 消耗点击次数 - 预计得分/100
                            const expectedLoss = times - (root.board[i][j] / 100);

                            if (expectedLoss < minLoss) {
                                minLoss = expectedLoss;
                                minLossAction = { row: i, col: j, times: 1 };
                            }
                        }
                    }
                }

                if (minLossAction) {
                    return minLossAction;
                }
                break;
            }

            nextBeam.sort((a, b) => b.value - a.value);
            beam = nextBeam.slice(0, BEAM_WIDTH);
        }

        bestLeaf = beam[0];
        if (!bestLeaf || !bestLeaf.moveSeq.length) {
            // 优先选择边缘大数字格子
            let bestAction = null;
            let maxValue = -Infinity;

            for (let r = 0; r < BOARD_SIZE; r++) {
                for (let c = 0; c < BOARD_SIZE; c++) {
                    if (board[r][c] > maxValue && board[r][c] !== null) {
                        // 优先选择边缘位置
                        const isEdge = r === 0 || r === BOARD_SIZE - 1 || c === 0 || c === BOARD_SIZE - 1;
                        if (isEdge) {
                            maxValue = board[r][c];
                            bestAction = { row: r, col: c, times: 1 };
                        }
                    }
                }
            }
            return bestAction || { row: 0, col: 0, times: 1 }; // 保底选择
        }

        const firstMove = bestLeaf.moveSeq[0];
        return {
            row: firstMove.row,
            col: firstMove.col,
            times: firstMove.times,
            value: bestLeaf.value,
            scoreGain: bestLeaf.scoreGain,
            conservativeScore: bestLeaf.conservativeScore
        };

    }


    // ====== 其它辅助函数 ======
    function getCurrentPhase(score) {
        // 给每个阶段添加label标识
        if (score >= 2000) return { maxClicks: 2, riskFactor: 0.2, label: '2000+' };
        if (score >= 1800) return { maxClicks: 2, riskFactor: 0.3, label: '1800+' };
        if (score >= 1500) return { maxClicks: 3, riskFactor: 0.4, label: '1500+' };
        if (score >= 1000) return { maxClicks: 2, riskFactor: 0.7, label: '1000+' };
        return { maxClicks: 3, riskFactor: 1.0, label: '基础' };
    }

    // ====== 动画等待 ======
    async function waitForAnimationToFinish(timeout = 20000, interval = 50) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const animatingElements = document.querySelectorAll('.cell.highlight, .cell-clone, .vanish');
            if (animatingElements.length === 0) return true;

            // 检查游戏是否意外结束
            if (isGameEndModalVisible()) {
                handleGameEndModal();
                return false;
            }
            await sleep(interval);
        }
        log('警告：动画等待超时，强制继续');
        return false; // 超时后继续流程
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
            restartButton.click();
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
        }
        while (running && !stopRequested) {
            if (paused) {
                await sleep(500);
                continue;
            }
            if (isGameEndModalVisible()) {
                if (handleGameEndModal()) {
                    log('游戏结束弹框已处理，等待游戏重启...');
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
                await waitForAnimationToFinish(20000);
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

            // ====== 保守型决策 ======
            const bestMove = conservativeBeamSearch(currentBoard, clicksLeft, scoreNow);
            if (!bestMove) {
                log('无可点击格子或所有动作预计得分为负，自动通关暂停。');
                running = false;
                break;
            }
            const phase = getCurrentPhase(scoreNow);
            log(`[阶段${phase.label}] 点击格子 (${bestMove.row},${bestMove.col}) x${bestMove.times}, ` +
                `预计实际得分: ${bestMove.scoreGain}, ` +
                `布局评分: ${bestMove.conservativeScore}, ` +
                `综合评分: ${(bestMove.value ?? 0).toFixed(1)}, ` +
                `当前积分: ${scoreNow}, 行动点: ${clicksLeft}`);

            const cell = document.querySelector(`.cell[data-row="${bestMove.row}"][data-col="${bestMove.col}"]`);
            if (!cell) {
                log(`错误：未找到DOM格子 (${bestMove.row},${bestMove.col})，停止运行。`);
                running = false;
                break;
            }
            let delay = BASE_CLICK_DELAY;
            if (scoreNow >= 1500) delay = MIN_CLICK_DELAY + 40;
            else if (scoreNow >= 1000) delay = MIN_CLICK_DELAY + 20;
            else if (clicksLeft <= 2) delay = MIN_CLICK_DELAY;
            for (let k = 0; k < bestMove.times; k++) {
                cell.click();
                await sleep(delay);
            }
            await waitForAnimationToFinish();
        }
        if (controlPanel) {
            pauseBtn.disabled = true;
            startBtn.disabled = false;
            updateStatus(stopRequested ? '已重置/停止' : '已停止');
        }
        log('自动点击循环结束。');
    }

    // ====== 监控游戏状态 ======
    let monitoring = false;
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
            const score = getScoreFromDOM();
            if (currentBoard && clicksLeft > 0 && !running && !paused && !stopRequested) {
                log(`监控：检测到可用操作 (分数: ${score})，自动启动保守策略。`);
                running = true;
                paused = false;
                updateStatus('运行中');
                autoClickLoop();
            }
            await sleep(2500);
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
        title.textContent = 'TapMePlus1 自动通关（高分保守优化）v7.1';
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
            updateStatus(paused ? '已暂停' : (running ? '运行中' : '已停止'));
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
            running = false; paused = false; stopRequested = true;
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

    // ====== 日志与状态 ======
    function updateStatus(text) {
        if (statusDiv) statusDiv.textContent = '状态：' + text;
    }

    function log(msg, level = 'info') {
        if (!logArea) return;

        // 修复：添加时间变量定义
        const time = new Date().toLocaleTimeString();

        // 添加日志级别颜色
        const colors = {
            error: '#ff6b6b',
            warn: '#ffd166',
            info: '#a9d6e5',
            success: '#06d6a0'
        };

        // 创建带样式的日志条目
        const logEntry = document.createElement('div');
        logEntry.textContent = `[${time}] ${msg}`;
        logEntry.style.color = colors[level] || '#f8f9fa';
        logEntry.style.margin = '2px 0';

        logArea.appendChild(logEntry);
        logArea.scrollTop = logArea.scrollHeight;

        // 控制台日志保持不变
        console.log(`[AutoTapmePlus1] ${msg}`);
    }

    function exportLog() {
        if (!logArea) return;

        // 收集所有日志文本
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
        // 在代码中使用不同日志级别
        log('保守型脚本加载完成，目标突破3000分！', 'success');
        log('警告：等待动画完成超时', 'warn');
        log('错误：未找到DOM格子', 'error');
        log('常规信息消息', 'info'); // 默认级别
        monitorGameState();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
