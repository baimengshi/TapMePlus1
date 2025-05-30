# TapMePlus1 Auto-Clearing Script

A powerful Greasemonkey userscript for automating the process of clearing the TapMePlus1 game.

## Features

- 🎮 **Fully automatic game**: Automatically determine the optimal click strategy
- ⚡ **Intelligent decision**: Evaluate the potential benefits of each click based on the value function
- 🔁 **Chain reaction processing**: Completely simulate the chain elimination effect
- 🚀 **Efficient algorithm**: Support multi-click continuous operation strategy
- 🛠 **Breakthrough mode**: Find the best breakthrough point in an unfavorable situation
- 📊 **Real-time monitoring**: Monitor the game status in the background and automatically restart the game
- 🖥 **Control panel**: Intuitive GUI interface to control script operation

## Installation instructions

1. Install the [violentmonkey](https://violentmonkey.github.io/) browser extension
2. Click to install the [TapmePlus1 script](https://github.com/baimengshi/tapmeplus1/raw/main/TapMePlus1_auto-clear.user.js)
3. Visit [TapMePlus1](https://tapmeplus1.com/) Start the game

## Configuration options

The script contains the following adjustable parameters (modify in code):

```javascript
// ====== Basic parameters ======
const BOARD_SIZE = 5;
const MAX_CLICKS = 5;
const BEAM_WIDTH = 8;
const SEARCH_DEPTH = 4;
const MIN_CLICK_DELAY = 60;
const BASE_CLICK_DELAY = 100;
const evaluationCache = new Map(); // Evaluation cache
const MAX_CACHE_SIZE = 500; // Add cache size limit

// ====== Dynamic weight function ======
function getScoreWeight(score) {
    if (score < 800) return {
        score: 100,
        layout: 1
    };
    if (score < 1500) return {
        score: 85,
        layout: 0.8
    }; // Increase layout weight
    if (score < 2000) return {
        score: 70,
        layout: 0.6
    }; // Add 2000 points transition stage
    return {
        score: 60,
        layout: 0.4
    }; // 2000 points and above retain some layout weight
}

// ====== Phase strategy ======
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
        label: 'Basic',
        strategy: 'default'
    };
}
```

## Open Source Agreement
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
