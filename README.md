# TapMePlus1 自动通关脚本

一款强大的 Tampermonkey 用户脚本，用于自动化 TapMePlus1 游戏的通关过程。

## 功能特性

- 🎮 **全自动游戏**：自动判断最优点击策略
- ⚡ **智能决策**：基于价值函数评估每个点击的潜在收益
- 🔁 **连锁反应处理**：完整模拟连锁消除效果
- 🚀 **高效算法**：支持多点击连续操作策略
- 🛠 **破局模式**：在不利局面下寻找最佳突破点
- 📊 **实时监控**：后台监控游戏状态，自动重启游戏
- 🖥 **控制面板**：直观的GUI界面控制脚本运行

## 安装说明

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
2. 点击安装 [油猴脚本](https://github.com/baimengshi/tapmeplus1/raw/main/tapmeplus1-autoplay.user.js)
3. 访问 [TapMePlus1](https://tapmeplus1.com/) 开始游戏

## 配置选项

脚本包含以下可调整参数（在代码中修改）:

```javascript
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

    // ====== 阶段策略 ======
    function getCurrentPhase(score) {
        if (score >= 2000) return {
            maxClicks: 2,
            riskFactor: 0.2,
            label: '2000+',
            strategy: 'focusLargeGroups'
        };
        if (score >= 1800) return {
            maxClicks: 2,
            riskFactor: 0.3,
            label: '1800+',
            strategy: 'balanceEdgeAndCenter'
        };
        if (score >= 1500) return {
            maxClicks: 3,
            riskFactor: 0.4,
            label: '1500+',
            strategy: 'maximizeChainPotential'
        };
        if (score >= 1000) return {
            maxClicks: 2,
            riskFactor: 0.7,
            label: '1000+',
            strategy: 'conservativeGrowth'
        };
        return {
            maxClicks: 3,
            riskFactor: 1.0,
            label: '基础',
            strategy: 'default'
        };
    }
```

## 开源协议
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE) 
