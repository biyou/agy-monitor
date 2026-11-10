# Antigravity Task Monitor (`agy-monitor`) 模块索引

本项目已完成无损模块化拆分，所有源码文件均控制在 15 KB 以内。后续维护请按职责精准读取对应子文件（切勿读取 `.backup/` 备份目录）：

## 根目录入口与启动说明
- `REQUIREMENTS.md`：项目完整功能需求文档（涵盖业务痛点、核心算法、状态机、UI 交互与 HTTP API 清单）。
- `package.json`：项目元信息与入口声明（`main.cjs`），包含 `electron` 开发依赖（`devDependencies`）以及 `dev` / `start` 启动脚本（`electron .`），业务逻辑零第三方运行时依赖。
- `.npmrc`：配置 `electron_mirror` 与 `electron_builder_binaries_mirror` 国内镜像源。
- `main.cjs`：应用主入口，负责 Electron 单实例锁、无边框置顶浮窗、系统托盘动态图标/菜单及系统通知，并启动本地 HTTP 服务。
- `index.html`：前端页面 DOM 骨架，按顺序引入 `./css/*` 样式表与 `./js/*` 全局脚本。

## 后端模块 (`./server/*.cjs`)
- `server/config-state.cjs`：全局路径常量（`BRAIN_DIR`、`AGENTAPI_BAT`、`PORT`）、运行时状态（会话选择、看门狗记录）及纯 Node 托盘 PNG 图标生成器。
- `server/parser-utils.cjs`：文本清洗、用户指令提取、智能任务标题推导、工具类型分类与英文阶段名中文化工具函数。
- `server/stage-extractor.cjs`：读取并解析 `transcript.jsonl`，提取用户 Prompt、后台任务状态、Context Token 遥测及连续同类文件操作合并（`mergedStages`）。
- `server/collector.cjs`：扫描最近活跃会话列表（`listConversations`）、巡检 `.system_generated/tasks/*.log` 进度，汇总生成单会话完整监控快照（`parseConversation`）。
- `server/actions.cjs`：获取当前追踪快照（`getCurrentSnapshot`）、触发 AgentAPI / 剪贴板看门狗唤醒（`triggerWakeup`）及手动终止任务（`stopRunningTask`）。
- `server/http-server.cjs`：本地 `127.0.0.1:17890` HTTP 服务端，提供 `/api/*` 控制接口以及 `/css/*`、`/js/*` 静态资源安全路由（含目录越界校验）。

## 前端样式 (`./css/*.css`)
- `css/styles.css`：全局 CSS 变量、外框卡片状态色、顶部拖拽栏、环形/线性进度条、窗口控制按钮、会话下拉菜单及 Context 饼图胶囊样式。
- `css/stages-footer.css`：阶段列表滚动容器、阶段行状态样式、合并子步骤抽屉、命令预览栏、静默倒计时条、底部看门狗控制栏、实时日志抽屉与 Toast 样式。

## 前端脚本 (`./js/*.js`，按全局依赖顺序加载)
- `js/state-utils.js`：前端全局状态变量、DOM 节点引用、Toast 提示、阶段状态 SVG 图标、耗时格式化与长路径中间省略工具函数。
- `js/api-actions.js`：前后端通信动作封装（窗口高度同步 `/api/resize`、二次确认停止任务、切换会话、触发唤醒重调、定时轮询 `/api/status`）。
- `js/render-widgets.js`：子组件局部渲染（底部命令/文件预览栏 `updateCmdPreviewBar`、会话下拉菜单、Context 饼图与 Tooltip、底部状态栏状态机 `renderFooterState`）。
- `js/render.js`：核心快照渲染主函数 `renderSnapshot`（顶部环形/线性进度、智能标题、阶段列表 DOM 就地复用差分更新与日志终端同步）。
- `js/events-init.js`：全部 DOM 交互事件与键盘导航绑定，并在加载末尾启动 `pollStatus()` 与 1 秒轮询定时器。
