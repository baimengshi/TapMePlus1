# TapMePlus1 自动通关脚本

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)  
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
2. 点击[此处](https://github.com/baimengshi/TapMePlus1/blob/main/TapMePlus1.js)安装脚本
3. 访问 [TapMePlus1](https://tapmeplus1.com/) 开始游戏

## 控制面板功能

- **开始/停止**：手动控制脚本运行
- **暂停/继续**：临时中断脚本运行
- **日志导出**：保存运行记录用于分析
- **状态监控**：实时显示脚本状态

## 配置选项

脚本包含以下可调整参数（在代码中修改）:

```javascript
const defaultConfig = {
    minScoreThreshold: 5,              // 最低得分阈值
    clicksDiffWeight: 5000,           // 行动点差值权重
    chainCountWeight: 500,            // 连锁次数权重
    maxNumberWeight: 80,              // 最大数字权重
    maxContinuousClicks: 4,           // 最大连续点击次数
    breakthroughModeEnabled: true,    // 启用破局模式
    autoRestartAfterGameEnd: true     // 游戏结束自动重启
};
```
## 工作原理
棋盘分析：实时读取游戏棋盘状态
模拟预测：预测每个可能的点击结果
价值评估：综合考虑得分、行动点和连锁效果
最优选择：执行价值最高的点击操作
动画同步：智能等待游戏动画完成

## 常见问题
Q: 脚本运行后游戏没有反应？
A: 确保游戏页面完全加载，检查控制台是否有错误信息。

Q: 如何调整点击策略？
A: 修改脚本中的权重参数，数值越大表示该因素越重要。

Q: 游戏更新后脚本失效？
A: 请提交issue报告问题，我会尽快适配新版本。

## 贡献指南
欢迎提交Pull Request改进脚本！主要开发方向：
- 更好的决策算法
- 更稳定的DOM检测
- 性能优化

## 开源协议
MIT License - 自由使用和修改，需保留原作者信息。
