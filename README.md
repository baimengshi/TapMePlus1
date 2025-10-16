<a name="readme-top"></a>

# TapMePlus1 Auto-Clearing Script

[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-%23FE5196?logo=conventionalcommits&logoColor=white)](https://conventionalcommits.org)

A powerful Greasemonkey userscript for automating the process of clearing the TapMePlus1 game.

## Language
<!-- Keep these links. Translations will automatically update with the README. -->
[Deutsch](https://www.readme-i18n.com/baimengshi/TapMePlus1?lang=de) | 
[Español](https://www.readme-i18n.com/baimengshi/TapMePlus1?lang=es) | 
[français](https://www.readme-i18n.com/baimengshi/TapMePlus1?lang=fr) | 
[日本語](https://www.readme-i18n.com/baimengshi/TapMePlus1?lang=ja) | 
[한국어](https://www.readme-i18n.com/baimengshi/TapMePlus1?lang=ko) | 
[Português](https://www.readme-i18n.com/baimengshi/TapMePlus1?lang=pt) | 
[Русский](https://www.readme-i18n.com/baimengshi/TapMePlus1?lang=ru) | 
[中文](https://www.readme-i18n.com/baimengshi/TapMePlus1?lang=zh)

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
2. Click to install the [TapmePlus1 script](https://github.com/baimengshi/tapmeplus1/raw/main/TapMePlus1-AI-Solver.user.js)
3. Visit [TapMePlus1](https://tapmeplus1.com/) Start the game

## Configuration options

The script contains the following adjustable parameters (modify in code):

```javascript
// ====== Basic parameters ======
    const BOARD_SIZE = 5;
    const MAX_CLICKS = 5;
    const BEAM_WIDTH = 10;
    const SEARCH_DEPTH = 4;
    const MIN_CLICK_DELAY = 50;
    const BASE_CLICK_DELAY = 80;
    const MAX_CACHE_SIZE = 1000;

// ====== Optimized Positional Weights Matrix ======
    const POSITIONAL_WEIGHTS = [
        [1, 2, 3, 2, 1],
        [2, 4, 6, 4, 2],
        [3, 6, 8, 6, 3],
        [2, 4, 6, 4, 2],
        [1, 2, 3, 2, 1]
    ];

// ====== Dynamic weight  ======
    const getScoreWeight = score => {
    if (score >= 2500) return { score: 130, layout: 0.4 }; // 冲刺阶段：重得分轻布局
    if (score >= 1000) return { score: 90, layout: 1.3 };  // 中期：平衡发展
    return { score: 80, layout: 1.5 };                     // 前期：重布局
};

// ====== Phase strategy  ======
    const getCurrentPhase = score => {
    if (score >= 2500) return { 
        maxClicks: 1, 
        label: '2500+ 冲刺',
        searchDepth: 2,    // 冲刺阶段降低搜索深度
        beamWidth: 15      // 增加搜索宽度
    };
    if (score >= 1000) return { 
        maxClicks: 2, 
        label: '1000+ 中期',
        searchDepth: 3,
        beamWidth: 10
    };
    return { 
        maxClicks: 2, 
        label: '基础 前期',
        searchDepth: 2,
        beamWidth: 8
    };
};

```

## License

The AGPL-3.0 license.

<p align="right" style="font-size: 14px; color: #555; margin-top: 20px;">
    <a href="#readme-top" style="text-decoration: none; color: #007bff; font-weight: bold;">
        ⬆️Back to Top⬆️
    </a>
</p>
