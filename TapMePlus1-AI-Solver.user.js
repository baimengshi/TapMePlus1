// ==UserScript==
// @name         TapMePlus1 自动通关 (高分优化版)
// @namespace    https://violentmonkey.github.io
// @version      8.0
// @description  修复核心BUG，重构启发式函数，引入价值梯度，目标突破3000分！
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
    const BEAM_WIDTH = 10;
    const SEARCH_DEPTH = 4;
    const MIN_CLICK_DELAY = 50;
    const BASE_CLICK_DELAY = 80;
    const MAX_CACHE_SIZE = 1000;
    const evaluationCache = new Map();

    // ====== 位置权重矩阵 ======
    const POSITIONAL_WEIGHTS = [
        [1, 2, 3, 2, 1],
        [2, 4, 6, 4, 2],
        [3, 6, 8, 6, 3],
        [2, 4, 6, 4, 2],
        [1, 2, 3, 2, 1]
    ];

    // ====== 动态权重  ======
    const getScoreWeight = score => {
        if (score < 1000) return { score: 100, layout: 1.0 }; // 前期，布局和得分并重
        if (score < 2500) return { score: 85, layout: 1.2 };  // 中期，更注重构建有潜力的布局
        return { score: 110, layout: 0.8 }; // 后期/冲刺，优先将优势转化为得分
    };

    // ====== 工具函数 ======
    const sleep = ms => new Promise(res => setTimeout(res, ms));
    const deepCopyBoard = board => board?.map(row => [...row]) ?? null;

    // ====== 获取棋盘/行动点/分数  ======
    const getBoardFromDOM = () => {
        try {
            const board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
            const cells = document.querySelectorAll('#game-board .cell:not(.empty)');
            if (cells.length === 0) return null; // 游戏未开始或结束
            cells.forEach(cell => {
                const row = +cell.dataset.row, col = +cell.dataset.col;
                const val = +cell.textContent.trim();
                if (row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE) {
                    board[row][col] = val;
                }
            });
            return board;
        } catch (e) {
            log(`获取棋盘状态失败: ${e.message}`, 'error');
            return null;
        }
    };
    const getClicksLeftFromDOM = () => +document.getElementById('clicks-left')?.textContent || 0;
    const getScoreFromDOM = () => {
        const text = document.querySelector('.score-display')?.textContent || '';
        const match = text.match(/\d+/);
        return match ? +match[0] : 0;
    };

    // ====== 查找连通组/模拟重力/模拟消除  ======
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
                            if (nr >= 0 && nr < size && nc >= 0 && nc < size && !visited[nr][nc] && board[nr][nc] === val) {
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
    const applyGravitySim = board => {
        const size = board.length;
        let hasMovedOrFilled = false;
        for (let col = 0; col < size; col++) {
            let writeIndex = size - 1;
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
            while (writeIndex >= 0) {
                board[writeIndex][col] = (Math.floor(Math.random() * 5) + 1);
                hasMovedOrFilled = true;
                writeIndex--;
            }
        }
        return { hasMovedOrFilled };
    };
    const simulateElimination = (board, initialClicksLeft) => {
        const simBoard = deepCopyBoard(board);
        let totalScore = 0;
        let clicksLeft = initialClicksLeft;
        while (true) {
            const groups = findAllConnectedGroups(simBoard);
            if (!groups.length) break;
            for (const group of groups) {
                let target = group.cells.reduce((t, cell) => (cell.r > t.r || (cell.r === t.r && cell.c < t.c)) ? cell : t, group.cells[0]);
                const baseVal = simBoard[target.r][target.c];
                const cellsToClear = group.cells.filter(c => c.r !== target.r || c.c !== target.c);
                totalScore += baseVal * cellsToClear.length;
                for (const c of cellsToClear) simBoard[c.r][c.c] = null;
                simBoard[target.r][target.c] = baseVal + 1;
                clicksLeft = Math.min(clicksLeft + 1, MAX_CLICKS);
            }
            const gravity = applyGravitySim(simBoard);
            if (!gravity.hasMovedOrFilled && findAllConnectedGroups(simBoard).length === 0) break;
        }
        return { board: simBoard, totalScore, totalClicksLeft: clicksLeft };
    };

    // ======  布局评估函数 ======
    const evaluateBoardPotential = (board) => {
        const cacheKey = JSON.stringify(board);
        if (evaluationCache.has(cacheKey)) return evaluationCache.get(cacheKey);

        let layoutScore = 0;
        const colorCounts = {};

        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                const val = board[r][c];
                if (val === null) continue;

                colorCounts[val] = (colorCounts[val] || 0) + 1;

                // 1. 位置和价值奖励
                layoutScore += POSITIONAL_WEIGHTS[r][c] * val * 0.5;

                // 2. 连接性与价值梯度奖励
                let sameNeighbors = 0;
                let smoothnessBonus = 0;
                const neighbors = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]; // 包含斜向
                neighbors.forEach(([dr, dc], index) => {
                    const nr = r + dr, nc = c + dc;
                    if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE && board[nr][nc] !== null) {
                        const neighborVal = board[nr][nc];
                        if (neighborVal === val) {
                            sameNeighbors++;
                        }
                        // 核心：奖励价值梯度平滑的方块
                        if (neighborVal === val + 1) {
                            smoothnessBonus += 25; // 大力奖励可升级的路径
                        } else if (neighborVal === val - 1) {
                            smoothnessBonus += 10;
                        }
                    }
                });

                layoutScore += smoothnessBonus;
                if (sameNeighbors > 0) {
                    layoutScore += sameNeighbors * 10;
                } else {
                    layoutScore -= 25; // 惩罚孤立方块
                }

                // 3. 惩罚悬空方块
                if (r < BOARD_SIZE - 1 && board[r + 1][c] === null) {
                    layoutScore -= 15;
                }
            }
        }

        // 4. 颜色聚集奖励 (权重降低)
        for (const color in colorCounts) {
            layoutScore += colorCounts[color] * 5;
        }

        if (evaluationCache.size > MAX_CACHE_SIZE) {
            evaluationCache.delete(evaluationCache.keys().next().value);
        }
        evaluationCache.set(cacheKey, layoutScore);
        return layoutScore;
    };

    // ====== 阶段策略  ======
    const getCurrentPhase = score => {
        if (score >= 2500) return { maxClicks: 1, label: '2500+ 冲刺' };
        if (score >= 1000) return { maxClicks: 2, label: '1000+ 中期' };
        return { maxClicks: 2, label: '基础 前期' };
    };

    // ====== 混合贪心策略 (用于终局) ======
    const findBestGreedyMove = (board, clicksLeft) => {
        let bestMove = null, maxValue = -Infinity;
        const weights = getScoreWeight(getScoreFromDOM()); // 使用当前分数的权重

        for (let i = 0; i < BOARD_SIZE; i++) {
            for (let j = 0; j < BOARD_SIZE; j++) {
                if (board[i][j] !== null) {
                    const tempBoard = deepCopyBoard(board);
                    tempBoard[i][j]++;
                    const sim = simulateElimination(tempBoard, clicksLeft - 1);
                    const value = sim.totalScore * weights.score + evaluateBoardPotential(sim.board) * weights.layout * 0.2; // 终局时布局权重降低
                    if (value > maxValue) {
                        maxValue = value;
                        bestMove = { row: i, col: j, times: 1, scoreGain: sim.totalScore, layoutScore: evaluateBoardPotential(sim.board), value };
                    }
                }
            }
        }
        return bestMove;
    };

    // ======  光束搜索 ======
    const beamSearch = (board, clicksLeft, scoreNow) => {
        const phase = getCurrentPhase(scoreNow);
        const weights = getScoreWeight(scoreNow);

        if (clicksLeft <= 2) {
            const move = findBestGreedyMove(board, clicksLeft);
            if (move) {
                log(`终局策略: 点击(${move.row},${move.col})`, 'info');
                return move;
            }
        }

        let beam = [{ moveSeq: [], board: deepCopyBoard(board), clicksLeft: clicksLeft }];

        for (let depth = 0; depth < SEARCH_DEPTH; depth++) {
            let nextBeam = [];
            for (const node of beam) {
                if (node.clicksLeft === 0) { // 如果路径已经用完步数，直接加入下一轮
                    nextBeam.push(node);
                    continue;
                }
                for (let i = 0; i < BOARD_SIZE; i++) {
                    for (let j = 0; j < BOARD_SIZE; j++) {
                        if (node.board[i][j] === null) continue;

                        const maxClicksForMove = Math.min(node.clicksLeft, phase.maxClicks);
                        for (let times = 1; times <= maxClicksForMove; times++) {
                            let boardAfter = deepCopyBoard(node.board);
                            boardAfter[i][j] += times;
                            const sim = simulateElimination(boardAfter, node.clicksLeft - times);
                            nextBeam.push({
                                moveSeq: node.moveSeq.concat([{ row: i, col: j, times }]),
                                board: sim.board,
                                clicksLeft: sim.totalClicksLeft,
                                scoreGain: (node.scoreGain || 0) + sim.totalScore,
                            });
                        }
                    }
                }
            }

            if (!nextBeam.length) break;

            // 评估并排序
            nextBeam.forEach(node => {
                node.layoutScore = evaluateBoardPotential(node.board);
                // [BUG修复] 这里的value不再累加，而是基于当前序列的最终结果进行评估
                node.value = node.scoreGain * weights.score + node.layoutScore * weights.layout;
            });

            nextBeam.sort((a, b) => b.value - a.value);
            beam = nextBeam.slice(0, BEAM_WIDTH);
        }

        if (!beam[0]?.moveSeq?.length) {
            log('警告: 搜索未能找到有效移动，执行备用策略。', 'warn');
            return findBestGreedyMove(board, clicksLeft) || { row: 0, col: 0, times: 1, scoreGain: 0, layoutScore: 0, value: 0 };
        }

        const bestLeaf = beam[0];
        const firstMove = bestLeaf.moveSeq[0];

        // 为了日志清晰，重新计算第一步的直接收益
        const firstMoveBoard = deepCopyBoard(board);
        firstMoveBoard[firstMove.row][firstMove.col] += firstMove.times;
        const firstSim = simulateElimination(firstMoveBoard, clicksLeft - firstMove.times);

        return {
            ...firstMove,
            value: bestLeaf.value,
            scoreGain: firstSim.totalScore,
            layoutScore: evaluateBoardPotential(firstSim.board)
        };
    };

    // ====== 动画等待/游戏结束检测 ======
    const waitForAnimationToFinish = async (timeout = 15000, interval = 100) => {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const animating = document.querySelectorAll('.cell.highlight, .cell-clone, .vanish').length;
            if (animating === 0) {
                await sleep(interval * 2);
                if (document.querySelectorAll('.cell.highlight, .cell-clone, .vanish').length === 0) return true;
            }
            await sleep(interval);
        }
        log('动画等待超时，强制继续', 'warn');
        return false;
    };
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
                    break; // 退出循环
                } else {
                    log(`行动点恢复，继续循环。`);
                }
                continue;
            }

            const bestMove = beamSearch(currentBoard, clicksLeft, scoreNow);
            if (!bestMove) {
                log('无可点击格子或搜索失败，自动通关暂停。', 'error');
                running = false;
                break;
            }

            const phase = getCurrentPhase(scoreNow);
            log(`[${phase.label}] 点击(${bestMove.row},${bestMove.col})x${bestMove.times}. ` +
                `预估分: ${bestMove.scoreGain}, 布局分: ${bestMove.layoutScore.toFixed(1)}, ` +
                `总值: ${bestMove.value.toFixed(1)}. 当前: ${scoreNow}, 行动点: ${clicksLeft}`, 'info');

            const cell = document.querySelector(`.cell[data-row="${bestMove.row}"][data-col="${bestMove.col}"]`);
            if (!cell) {
                log(`错误：未找到DOM格子 (${bestMove.row},${bestMove.col})，停止运行。`, 'error');
                running = false;
                break;
            }

            let delay = BASE_CLICK_DELAY;
            if (scoreNow >= 2000) delay = MIN_CLICK_DELAY + 20;
            else if (scoreNow >= 1000) delay = MIN_CLICK_DELAY + 30;

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
            updateStatusIndicator('stopped');
        }
        log('自动点击循环结束。');
    };

    // ====== 监控游戏状态 ======
    let monitoring = false;
    const monitorGameState = async () => {
        if (monitoring) return;
        monitoring = true;
        log('进入后台监控状态，等待游戏开始...');

        while (true) {
            if (stopRequested) {
                monitoring = false;
                log("监控已停止 (用户重置).");
                updateStatus('已重置/停止.');
                updateStatusIndicator('stopped');
                return;
            }

            if (running || paused) {
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
                log(`监控：检测到可玩状态 (分数: ${score})，自动启动策略。`, 'success');
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
        title.textContent = 'TapMePlus1 自动通关 v8.0';
        Object.assign(title.style, { fontWeight: 'bold', fontSize: '16px', textAlign: 'center', marginBottom: '10px' });

        statusDiv = document.createElement('div');
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
                log('手动开始自动通关');
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
            log('已重置，停止所有操作');
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
    };

    // ====== 状态指示器/状态更新/日志/导出 ======
    const updateStatusIndicator = status => {
        const indicator = document.getElementById('statusIndicator');
        if (!indicator) return;
        const colors = { running: '#4CAF50', paused: '#FFC107', stopped: '#F44336', error: '#9C27B0' };
        indicator.style.backgroundColor = colors[status] || '#9E9E9E';
    };
    const updateStatus = text => {
        if (statusDiv) statusDiv.textContent = '状态：' + text;
    };
    const log = (msg, level = 'info') => {
        if (!logArea) return;
        const time = new Date().toLocaleTimeString();
        const colors = { error: '#ff6b6b', warn: '#ffd166', info: '#a9d6e5', success: '#06d6a0', debug: '#adb5bd' };
        const logEntry = document.createElement('div');
        logEntry.textContent = `[${time}] ${msg}`;
        logEntry.style.color = colors[level] || '#f8f9fa';
        logEntry.style.margin = '2px 0';
        logEntry.style.padding = '2px 5px';
        if (level === 'error') logEntry.style.backgroundColor = 'rgba(255, 107, 107, 0.1)';
        else if (level === 'warn') logEntry.style.backgroundColor = 'rgba(255, 209, 102, 0.1)';
        logArea.appendChild(logEntry);
        logArea.scrollTop = logArea.scrollHeight;
        console.log(`[AutoTapmePlus1] ${msg}`);
    };
    const exportLog = () => {
        if (!logArea) return;
        let logText = '';
        for (const child of logArea.children) logText += child.textContent + '\n';
        const blob = new Blob([logText], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `TapMePlus1_v8.0_Log_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
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
        log('TapMePlus1 自动通关脚本 v8.0 加载完成，祝您游戏愉快！', 'success');
        monitorGameState();
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
