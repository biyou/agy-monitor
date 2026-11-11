# Antigravity Task Monitor (`agy-monitor`)

> Google Antigravity (AGY) 桌面实时任务进度悬浮监控与自动唤醒看门狗（Watchdog）。

[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![Electron](https://img.shields.io/badge/Electron-39+-blue.svg)](https://www.electronjs.org/)
[![License](https://img.shields.io/badge/License-GPLv3-yellow.svg)](./LICENSE)

---

## 📖 简介

在日常使用 Google Antigravity (AGY) 开发长任务、多轮工具调用或后台批处理时，开发者常面临以下痛点：
1. **黑盒执行**：窗口切换后无法直观掌握当前执行步骤、耗时与上下文窗口占用。
2. **偶发静默卡顿**：子进程命令挂起或交互无响应，需频繁人工切回检查。
3. **细碎操作刷屏**：连续读写同一文件造成流水线冗长。
4. **上下文压缩（Compacting）被误判**：模型自动压缩耗时较长且无工具输出，容易被误判为卡死。

**Antigravity Task Monitor** 提供极低资源开销的桌面半透明悬浮窗、动态系统托盘与自动唤醒看门狗，实现任务执行过程的全局可视化与自主守护。

---

## ✨ 核心特性

- 🎯 **自适应悬浮窗 & 双显示模式**
  - **展开模式 (`520×400`)**：完整显示当前任务、阶段流水线、命令/文件预览、上下文遥测与实时日志抽屉。
  - **迷你胶囊模式 (`520×74`)**：一键平滑收缩，仅保留标题、环形/线性进度与关键状态徽标，小巧不遮挡工作区。
  - **点击穿透模式 (Click-Through)**：开启后透明度降为 62%，鼠标点击直接穿透至底层编辑器，双击托盘即可恢复。

- ⚡ **多任务并行胶囊栏 (Multi-Task Tabs)**
  - 自动检测并行活跃任务；存在多任务时自动展开 `28px` 紧凑标签栏，单任务自动隐退。
  - 任务完成后保持 3 分钟状态驻留，支持随时切换与快速关闭。
  - 后台任务静默卡顿超频时，胶囊自动显示琥珀色警告徽标，点击即可秒级定位。

- 🐕 **智能看门狗 (Auto-Wakeup Watchdog)**
  - 监测最近输出静默时长，提供 `60s` / `120s`（默认）/ `240s` / `仅告警` 多档阈值。
  - 优先调用 `agentapi.bat send-message` 自动重调巡检，失败时安全兜底写入剪贴板。
  - **Compacting 保护机制**：智能识别上下文压缩阶段，自动挂起看门狗，避免打断模型压缩。

- 🔍 **智能流水线与操作聚合**
  - 多层优先级自然语言清洗，精准提取当前目标与追问意图。
  - 连续操作合并：自动聚合针对同一文件的多次读写与分段读取，收折至子步骤抽屉。
  - 支持直接锁定选中步骤、一键复制完整命令与超长路径智能截断。

- 📊 **Context Window 实时遥测**
  - 实时采集 Token 消耗并折算增量字节，绘制右上角 SVG 迷你饼图。
  - 充裕（青色）、较高（琥珀色）、超限预警（紫色）三级健康度提示，悬停展示命中率与压缩历史。

- 🔔 **纯内存动态系统托盘 & 原生通知**
  - 基于 Node.js 原生 Zlib/Buffer 内存动态合成 32×32 RGBA PNG 环形状态图标，无需外部静态图片资产。
  - 浮窗隐藏时，后台任务完成或严重卡顿会自动触发 Windows 原生桌面系统通知。

- 🪶 **极简架构 & 零运行时依赖**
  - 后端业务逻辑与 HTTP 服务完全基于 Node.js 原生 API 实现（零外部 npm 运行时依赖），仅引入 Electron 作为开发依赖。

---

## 🚀 快速上手

### 环境要求
- [Node.js](https://nodejs.org/) `>= 18.0.0`
- [Google Antigravity (AGY)](https://antigravity.google/) 运行环境

### 安装与启动

1. **克隆仓库**
   ```bash
   git clone https://github.com/biyou/agy-monitor.git
   cd agy-monitor
   ```

2. **安装依赖**
   ```bash
   npm install
   ```

3. **启动桌面监控浮窗**
   ```bash
   npm start
   ```

> [!TIP]
> **无 Electron 环境 / 浏览器模式**：直接执行 `node main.cjs`，程序将自动以纯 HTTP 模式在 `http://127.0.0.1:17890` 启动，可直接在浏览器中打开监控界面。

---

## ⌨️ 常用交互与快捷方式

| 操作 | 作用说明 |
| :--- | :--- |
| **按住顶栏拖拽** | 移动悬浮窗至屏幕任意位置 |
| **右上角折叠按钮 (`▲ / ▼`)** | 在 `520×400` 完整模式与 `520×74` 迷你胶囊模式间平滑切换 |
| **多任务胶囊标签** | 单击切换焦点会话，点击 `×` 关闭已完成任务标签 |
| **阶段行单击** | 展开同文件合并操作明细，或锁定（Pin）预览该步骤详细命令 |
| **右侧日志胶囊** | 展开底部实时终端日志抽屉（最近 30 行实时滚动） |
| **停止按钮 (`■`)** | **二次防误触机制**：首次点击提示「确认停止?」，2.6 秒内再次点击下发终止指令 |
| **托盘图标单击** | 快速显示 / 隐藏监控悬浮窗 |
| **托盘图标双击** | 强制解除半透明点击穿透状态，恢复 100% 不透明度聚焦 |
| **托盘右键菜单** | 切换置顶、开启点击穿透、手动唤醒重调、终止任务与退出程序 |

---

## 🛠️ 项目结构

```text
agy-monitor/
├── main.cjs                # Electron 入口：单实例锁、无边框透明窗口、托盘动态图标与通知
├── index.html              # 监控页面 DOM 骨架
├── package.json            # 项目配置与启动脚本
├── REQUIREMENTS.md         # 详细功能设计与规格需求文档
├── AGENTS.md               # 模块索引与开发指导
├── css/
│   ├── styles.css          # 全局 CSS 变量、外框卡片、进度条与 Context 饼图
│   └── stages-footer.css   # 阶段列表、子步骤抽屉、预览栏、看门狗与实时日志
├── js/
│   ├── state-utils.js      # 前端全局状态、DOM 引用、SVG 图标与格式化函数
│   ├── api-actions.js      # 后端 API 通信、窗口尺寸控制、看门狗与会话轮询
│   ├── render-widgets.js   # 局部组件渲染（预览栏、多任务栏、Context 饼图、状态栏）
│   ├── render.js           # 核心快照渲染（智能标题、阶段列表就地复用更新）
│   └── events-init.js      # DOM 事件与键盘导航绑定、启动轮询定时器
└── server/
    ├── config-state.cjs    # 全局路径常量、会话状态记录与纯 Node 托盘 PNG 生成器
    ├── parser-utils.cjs    # 自然语言清洗、智能任务标题提取与工具类型解析
    ├── stage-extractor.cjs # transcript.jsonl 解析、阶段聚合与 Token 遥测
    ├── collector.cjs       # 活跃会话扫描与单会话监控数据快照聚合
    ├── actions.cjs         # AgentAPI / 剪贴板唤醒下发与任务终止控制
    └── http-server.cjs     # 127.0.0.1:17890 本地 HTTP 服务与静态资源安全路由
```

---

## 🔌 本地 HTTP 接口 (`127.0.0.1:17890`)

程序内置轻量本地 HTTP 服务，支持通过标准 REST API 对监控器进行二次开发与控制：

| 接口路径 | 请求方法 | 功能说明 |
| :--- | :--- | :--- |
| `/` 或 `/index.html` | `GET` | 监控控制台主界面 HTML |
| `/api/status` | `GET` | 获取当前会话状态、阶段流水线、进度与遥测数据的完整快照 |
| `/api/select-conv` | `POST` | 切换监控会话（`{ "convId": "auto" \| "<uuid>" }`） |
| `/api/wakeup` | `POST` | 下发看门狗唤醒指令（`{ "convId": "...", "prompt": "..." }`） |
| `/api/stop-task` | `POST` | 标记停止并终止当前运行任务（`{ "convId": "..." }`） |
| `/api/resize` | `POST` | 调整 Electron 窗口尺寸（`{ "width": 520, "height": 400 | 74 }`） |
| `/api/hide-to-tray` | `POST` | 将悬浮窗最小化至系统托盘 |
| `/api/open-log` | `POST` | 调用系统记事本打开当前活跃任务日志 |

---

## 📄 开源许可

本项目基于 [GNU General Public License v3.0](./LICENSE) 协议开源。
