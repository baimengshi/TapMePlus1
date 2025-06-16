<a name="readme-top"></a>

# TapMePlus1 Auto-Clearing Script

A powerful Greasemonkey userscript for automating the process of clearing the TapMePlus1 game.

## Language
[English](https://openaitx.github.io/view.html?user=baimengshi&project=TapMePlus1&lang=en) | [简体中文](https://openaitx.github.io/view.html?user=baimengshi&project=TapMePlus1&lang=zh-CN) | [繁體中文](https://openaitx.github.io/view.html?user=baimengshi&project=TapMePlus1&lang=zh-TW) | [日本語](https://openaitx.github.io/view.html?user=baimengshi&project=TapMePlus1&lang=ja) | [한국어](https://openaitx.github.io/view.html?user=baimengshi&project=TapMePlus1&lang=ko) | [हिन्दी](https://openaitx.github.io/view.html?user=baimengshi&project=TapMePlus1&lang=hi) | [ไทย](https://openaitx.github.io/view.html?user=baimengshi&project=TapMePlus1&lang=th) | [Français](https://openaitx.github.io/view.html?user=baimengshi&project=TapMePlus1&lang=fr) | [Deutsch](https://openaitx.github.io/view.html?user=baimengshi&project=TapMePlus1&lang=de) | [Español](https://openaitx.github.io/view.html?user=baimengshi&project=TapMePlus1&lang=es) | [Italiano](https://openaitx.github.io/view.html?user=baimengshi&project=TapMePlus1&lang=it) | [Русский](https://openaitx.github.io/view.html?user=baimengshi&project=TapMePlus1&lang=ru) | [Português](https://openaitx.github.io/view.html?user=baimengshi&project=TapMePlus1&lang=pt) | [Nederlands](https://openaitx.github.io/view.html?user=baimengshi&project=TapMePlus1&lang=nl) | [Polski](https://openaitx.github.io/view.html?user=baimengshi&project=TapMePlus1&lang=pl) | [العربية](https://openaitx.github.io/view.html?user=baimengshi&project=TapMePlus1&lang=ar) | [فارسی](https://openaitx.github.io/view.html?user=baimengshi&project=TapMePlus1&lang=fa) | [Türkçe](https://openaitx.github.io/view.html?user=baimengshi&project=TapMePlus1&lang=tr) | [Tiếng Việt](https://openaitx.github.io/view.html?user=baimengshi&project=TapMePlus1&lang=vi) | [Bahasa Indonesia](https://openaitx.github.io/view.html?user=baimengshi&project=TapMePlus1&lang=id)

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
    const MAX_CACHE_SIZE = 500;
    const evaluationCache = new Map();

// ====== Dynamic weight function ======
    const getScoreWeight = score => {
        if (score < 800) return { score: 100, layout: 1 };
        if (score < 1500) return { score: 85, layout: 0.8 };
        if (score < 2000) return { score: 70, layout: 0.6 };
        return { score: 60, layout: 0.4 };
    };

// ====== Phase strategy ======
    const getCurrentPhase = score => {
        if (score >= 4000) return { maxClicks: 1, riskFactor: 0.2, label: '4000+', strategy: 'focusLargeGroups' };
        if (score >= 3000) return { maxClicks: 2, riskFactor: 0.3, label: '3000+', strategy: 'balanceEdgeAndCenter' };
        if (score >= 2000) return { maxClicks: 2, riskFactor: 0.4, label: '2000+', strategy: 'maximizeChainPotential' };
        if (score >= 1000) return { maxClicks: 2, riskFactor: 0.7, label: '1000+', strategy: 'conservativeGrowth' };
        return { maxClicks: 2, riskFactor: 1.0, label: '基础', strategy: 'default' };
    };
```

## License

The GPL-3.0 License.

<p align="right" style="font-size: 14px; color: #555; margin-top: 20px;">
    <a href="#readme-top" style="text-decoration: none; color: #007bff; font-weight: bold;">
        ↑ Back to Top ↑
    </a>
</p>
