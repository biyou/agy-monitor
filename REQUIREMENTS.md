# Antigravity Task Monitor (`agy-monitor`) 功能需求文档

## 1. 产品定位与背景

**Antigravity Task Monitor (`agy-monitor`)** 是一款面向 Google Antigravity (AGY) 的桌面实时任务进度悬浮监控与自动唤醒看门狗（Watchdog）工具。

### 1.1 解决的核心痛点
1. **长任务黑盒执行缺少可视化感知**：Agent 在后台执行多步骤任务或长耗时命令时，用户在切换至其他窗口后无法直观感知当前回合进度、当前步骤耗时及上下文窗口占用。
2. **后台任务偶发卡顿/静默挂起**：终端子进程交互等待或长时间无输出时，需要人工切回 IDE 检查并手动唤醒。
3. **高频文件操作刷屏**：Agent 连续多次读取或修改同一文件时，步骤列表容易被细碎操作淹没，难以看清主干进度。
4. **上下文压缩（Compacting）误判卡死**：当上下文临近阈值触发自动压缩时，耗时较长且无工具输出，容易被误判为任务卡死或被人工误打断。

---

## 2. 系统架构与运行模式

- **技术栈**：Electron 桌面壳（无边框透明置顶窗口 + 系统托盘）+ Node.js 原生 HTTP 服务（`127.0.0.1:17890`，零第三方运行时依赖）+ 原生 HTML/CSS/JS 前端。
- **双模式兼容**（[`server/config-state.cjs`](file:///d:/ai/tools/agy-monitor/server/config-state.cjs) & [`main.cjs`](file:///d:/ai/tools/agy-monitor/main.cjs)）：
  - **Electron 桌面模式**（默认 `npm run dev` / `npm start`）：启动桌面置顶悬浮窗、动态系统托盘与原生通知，同时内置 HTTP 服务。
  - **纯 Node 服务端模式**（无 Electron 环境降级）：仅启动 `127.0.0.1:17890` 本地 Web 监控服务，可通过浏览器直接访问。
- **数据源与外部集成**：
  - 会话日志目录：`~/.gemini/antigravity/brain/<conv-uuid>/.system_generated/logs/transcript.jsonl`
  - 后台任务日志：`~/.gemini/antigravity/brain/<conv-uuid>/.system_generated/tasks/task-*.log`
  - Agent 唤醒通道：`~/.gemini/antigravity/bin/agentapi.bat`（支持剪贴板自动兜底）

---

## 3. 核心功能需求明细

### 3.1 会话发现、多任务并行标签栏与智能追踪（[`server/collector.cjs`](file:///d:/ai/tools/agy-monitor/server/collector.cjs)、[`server/actions.cjs`](file:///d:/ai/tools/agy-monitor/server/actions.cjs)、[`js/render-widgets.js`](file:///d:/ai/tools/agy-monitor/js/render-widgets.js)）
1. **活跃会话扫描与子智能体识别**：
   - 自动扫描 `BRAIN_DIR` 下所有 UUID 格式的会话目录，按 `transcript.jsonl` 最后修改时间（`mtimeMs`）降序排列，取最近 12 个会话，并在下拉列表中展示前 6 个会话及其状态标签（`[运行中]`、`[压缩中]`、`[已停止]`、`[已就绪]`）。
   - **子智能体（Subagent）自动识别**：通过交叉比对父会话 `invoke_subagent` 输出的 UUID 以及会话输入源特征（`isSubagent`），自动识别子智能体会话并标记 `[子]` 徽标与角色名称。
2. **顶部多任务胶囊标签栏（Multi-Task Pill Tabs）**：
   - **自适应显隐**：当同时存在 `≥ 2` 个并行活跃任务或刚完成的任务时，在 `74px` 顶栏下方自动浮现 `28px` 高的紧凑多任务胶囊栏（`#multiTaskBar`）；单任务时自动隐藏，零空间占用。
   - **入驻与 3 分钟驻留策略**：所有处于 `isRunning` / `isCompacting` 的任务实时入驻；刚完成或手动停止的任务自动驻留 **3 分钟**（显示翠绿 `✓ 完成` 或玫红 `■ 已停`），并提供 `×` 按钮支持手动关闭标签；若任务再次运行则自动恢复显示。
   - **跨标签卡顿琥珀告警**：当后台未选中的并行任务发生静默卡顿时，其胶囊标签自动切换为琥珀色闪烁边框并显示 `⚠ Xs`，点击即可秒切至该任务详情，且不会强行打断当前前台视图。
3. **74px 折叠态「实时步骤 + 并行微章」与点击轮播**：
   - 在 `520×74` 迷你胶囊折叠模式下，单任务时直接实时展示当前执行步骤（`▸ <activeStageTitle>`）；若存在 `≥ 2` 个并行任务，顶栏按钮自动切换为高对比微章并附带当前步骤摘要（正常显示 `⚡ N并行(X/N) · <步骤>`，后台有卡顿时琥珀闪烁显示 `⚠ M卡顿/N并行 · <步骤>`）。
   - 左键单击直接轮播切换至下一个并行任务（单任务时展开会话菜单），右键单击展开完整会话菜单与面板。
4. **双追踪策略**：
   - **自动追踪模式（`auto`，默认）**：优先锁定当前处于 `isRunning` 或 `isCompacting` 状态的活跃会话；若均空闲，则展示最近更新的会话。
   - **手动锁定模式**：用户可通过顶部多任务胶囊栏或下拉菜单（支持鼠标点击及 `ArrowUp` / `ArrowDown` / `Enter` / `Escape` 键盘导航）指定监控某个特定会话 UUID。

---

### 3.2 智能任务标题提取与悬停详情（[`server/parser-utils.cjs`](file:///d:/ai/tools/agy-monitor/server/parser-utils.cjs)）
1. **多层优先级标题推导（`deriveSmartTaskTitle`）**：
   - **优先级 1（核心目标提炼）**：从全部 `USER_INPUT` 的 `<USER_REQUEST>` 内容中过滤掉短追问与评论式反馈（`isFeedbackOrChatter`，如“完成了吗”、“继续”、“参考下面的修改”、“这张新截图”等），清洗前缀口语词（如“请帮我”、“麻烦”等）与斜杠指令，保留完整首句核心目标（上限放宽至 `45~48` 字符）。
   - **优先级 2（阶段逆向合成）**：当输入全为评审反馈时，自动从最近非待办阶段标题或预设主题合成标题，兜底显示 `会话 <前8位ID>`。
2. **主标题拖拽与多维详情悬停提示（Tooltip）**：
   - 主标题文本支持直接按住拖拽移动浮窗；若用户最新输入为简短追问（`isShortFollowup`，如 `继续`、`好了吗`），主标题保持不变，右侧展示 `追问: "..."` 独立胶囊标签。
   - 鼠标悬停标题旁 `ⓘ` 详情微标或状态胶囊时，展示完整 `【任务名称】`、`【初始任务】`（前 160 字）与 `【本轮指令】`（前 220 字）。

---

### 3.3 阶段流水线解析、中文化与连续操作合并（[`server/stage-extractor.cjs`](file:///d:/ai/tools/agy-monitor/server/stage-extractor.cjs)）
1. **工具调用提取与状态判定**：
   - 解析 `PLANNER_RESPONSE` 中的 `tool_calls`（忽略 `manage_task` 与 `ask_question` 辅助调用）。
   - 结合后续 `GENERIC` 步骤与系统消息判定阶段状态：
     - **后台任务（`bgTaskId`）**：匹配 `Task id "..." completed / was canceled / failed` 判定 `done` / `stopped` / `error`；若标记 `IsDaemon=true` 且已有后续步骤，自动标记为 `done`（徽标 `后台常驻`）。
     - **同步命令**：检测 `Command exited with code X`，非 0 退出码标记为 `error` 并显示 `Exit X` 徽标。
     - **真实进度百分比提取（`parseLogProgress`）**：从关联的 `task-*.log` 内容中正则提取最新 `XX%` 进度数值并实时展示。
2. **英文阶段摘要中文化（`localizeToolTitle`）**：
   - 自动将常见英文 `toolSummary`（如 `Check ... syntax`、`List workspace files`、`Search ...`、`Launch floating monitor...` 等）转换为规范中文描述。
3. **连续同文件操作自动聚合（`mergedStages`）**：
   - 当 Agent 对同一文件（`groupKey = file:<basename>`）连续执行 `read_file`、`edit_file`、`write_file` 时，自动合并为单个阶段行，累加总耗时，并将明细收纳至 `subSteps` 子步骤抽屉：
     - 读写混合：标题显示 `修改 <文件名>`，徽标显示 `X次修改 · Y段读取`。
     - 纯修改/写入：徽标显示 `X次修改`。
     - 纯分段读取：自动计算首尾行号跨度，徽标显示 `Y段 · L起始–结束`。
4. **合成推理/压缩阶段**：
   - 当会话仍在运行（`isRunning`）且无活跃后台工具任务时，自动在末尾合成当前阶段：
     - 若处于上下文压缩状态：追加 `上下文压缩中 (Compacting)` 阶段（徽标 `~XXk tokens`）。
     - 否则：追加 `模型深度思考与生成回复中...` 阶段（徽标 `推理中`）。
5. **整体完成度算法（`overallProgress`）**：
   - 已完成状态固定为 `100%`；运行中根据 `(已完成阶段数 + 当前运行阶段权重) / 总阶段数` 计算（有真实百分比取 `progress / 100`，否则取 `0.45`），并限制在 `8% ~ 92%` 区间内避免虚标。

---

### 3.4 上下文窗口（Context Window）遥测与 Compact 识别（[`server/stage-extractor.cjs`](file:///d:/ai/tools/agy-monitor/server/stage-extractor.cjs)、[`js/render-widgets.cjs`](file:///d:/ai/tools/agy-monitor/js/render-widgets.js)）
1. **Token 遥测与实时估算**：
   - 采集每次 `PLANNER_RESPONSE` 的 `input_tokens`、`cache_read_tokens`、`output_tokens`。
   - 结合上次响应后新增的 `GENERIC` 文本字节数（按 `bytes / 3.2` 折算）实时估算当前上下文 Token 数（`estimatedContextTokens`），对比 `256,000` 最大窗口计算占用百分比与缓存命中率（`cacheHitPct`）。
2. **自动 Compact 历史检测**：
   - 当上一次上下文 `>= 80,000` tokens 且新一轮骤降至原值的 `55%` 以下时，自动记录一次上下文压缩事件（累计 `compactionCount`，记录 `lastCompactedFrom -> lastCompactedTo`）。
3. **实时 Compacting 状态判定**：
   - 当会话运行中、无后台工具任务，且满足 `estimatedContextTokens >= 135,000`（或单轮新增字节 `>= 60,000` 且等待 `>= 10s`）时，自动进入 `isCompacting` 状态。
4. **顶部迷你饼图胶囊（`ctxPill`）**：
   - 位于右上角控制区，实时绘制 SVG 扇形占比与百分比数值。
   - **三级颜色预警**：`< 65%` 青色充裕、`65% ~ 85%` 琥珀色较高、`>= 86%` 或压缩中显示紫色高负载预警。
   - 悬停展示完整三行遥测报告：`【上下文窗口】`、`【Token 构成】`、`【压缩记录】`。

---

### 3.5 自动看门狗（Watchdog）与任务控制（[`server/actions.cjs`](file:///d:/ai/tools/agy-monitor/server/actions.cjs)、[`js/render-widgets.js`](file:///d:/ai/tools/agy-monitor/js/render-widgets.js)）
1. **静默时长监测与可视化倒计时条**：
   - 综合 `transcript.jsonl` 修改时间、最新 `task-*.log` 修改时间与最后步骤时间戳计算静默秒数 `silenceSeconds`。
   - 底部 3px 静默倒计时条（`silenceBarFill`）随 `silenceSeconds / watchdogThreshold` 动态增长，并在 `50%`（琥珀色）、`85%`（红色）阶梯变色。
2. **可配置卡死阈值与全局后台看门狗巡检**：
   - 支持切换 4 档策略：`60s`、`120s（推荐，默认）`、`240s`、`仅告警不自动唤醒（0s）`。
   - **多任务全局后台巡检**：所有正在运行的并行会话（含未处于当前焦点的后台会话）均独立计算 `silenceSeconds` 与会话级 `15s` 唤醒冷却时间；当任意会话满足 `silenceSeconds >= watchdogThreshold` 时自动调用 `/api/wakeup` 下发带 `convId` 的针对性唤醒指令，并在前台弹出轻量 Toast 提示。
   - **防打断保护**：当会话处于 `isCompacting`（上下文压缩）状态时，自动暂停超时重调并锁定「⚡ 立即重调」按钮，防止打断模型上下文压缩。
3. **双通道唤醒与停止指令下发**：
   - **唤醒（`triggerWakeup`）**：优先调用 `agentapi.bat send-message <convId> <prompt>` 发送巡检恢复指令；仅当 `agentapi.bat` 不存在或调用失败时，才将指令兜底写入系统剪贴板并在 Toast 中提供「复制指令」按钮（零剪贴板污染原则）。
   - **手动停止任务（`stopRunningTask`）**：
     - 右上角按钮在任务运行时自动切换为红色停止图标，采用**二次点击确认机制**（点击后变为闪烁的 `确认停止?`，2.6 秒内未二次点击自动恢复，防止误触）。
     - 确认后记录手动停止状态（12 秒后由红色高亮 `stopped` 自动过渡为柔和灰蓝色冷却态 `stopped_cool`），并通过 AgentAPI / 剪贴板下发 `manage_task(kill)` 终止指令。

---

### 3.6 浮窗 UI 交互与详情检视（[`js/render.js`](file:///d:/ai/tools/agy-monitor/js/render.js)、[`js/events-init.js`](file:///d:/ai/tools/agy-monitor/js/events-init.js)）
1. **五态全局视觉反馈与阶段层级高亮**：
   - 外框卡片、顶部环形进度条、折叠态线性进度条及状态胶囊随状态同步切换主题色：**进行中（青蓝）**、**Compacting（紫色无限旋转光效）**、**疑似卡顿（琥珀色告警）**、**已停止（玫红 → 灰蓝冷却）**、**已完成（翠绿）**。
   - 阶段列表对已完成步骤做柔和降噪，对当前运行/压缩/卡顿/异常步骤卡片施加主题色底纹与左侧状态色条高亮。
2. **平滑折叠迷你胶囊模式**：
   - 点击右上角矢量折叠按钮，浮窗高度在 `400px`（展开态）与 `74px`（迷你顶栏胶囊态）之间平滑动画切换，展开先行扩容窗口、折叠等待动画完成后收缩窗口尺寸，保持窗口左上角坐标不偏移。
3. **全组件就地差分复用（阶段列表 / 多任务栏 / 会话菜单）**：
   - 每秒轮询更新时，阶段列表、多任务胶囊栏与会话下拉菜单均通过 `renderSig` 就地比对复用 DOM 节点（配合事件委托），不重置滚动位置、悬停态与键盘焦点。
   - 当列表向下滚动隐藏早期步骤时，顶部浮现 `↑ 上方还有 N 项已完成步骤（点击查看）` 胶囊提示，点击平滑滚回顶部。
   - 点击任意阶段行可**锁定选中（Pin）**或展开合并子步骤（`├─ (1/N)`），再次点击或点击预览栏「↩ 回到当前 / ✕ 取消选中」恢复自动跟随。
4. **工具感知型命令/文件预览栏（`cmdPreviewBar`）**：
   - 根据工具类型自动匹配前缀：`$`（终端命令，自动剥离 `ELECTRON_RUN_AS_NODE` 冗余前缀）、`📝 写入`、`📝 修改`、`📄 读取`、`🔍 检索`、`🧠 状态`。
   - 对超长文件路径采用智能中间省略算法（`middleEllipsisPath`，保留盘符/根目录、父目录与文件名），支持一键复制完整命令或路径。
5. **实时日志流抽屉（`logDrawer`）**：
   - 点击数据源胶囊（显示当前活跃 `task-X.log` 或 `日志`）可展开/收起底部终端抽屉，实时 `tail -f` 展示最近 30 行输出（自动贴底滚动），支持「记事本打开」（调用 `notepad.exe`）与「复制日志」。
6. **回合完成静默总结栏与一键复制摘要**：
   - 当回合进入已完成状态（`isDoneState`）时，底部自动隐藏看门狗阈值与唤醒按钮，切换为静默总结栏：展示相对完成时间（如 `刚刚完成`、`3 分钟前完成`，悬停显示精确时钟时刻）及总耗时拆分（`步骤执行 Xs · 思考等待 Ys`）。
   - 提供「复制摘要」按钮，一键生成包含任务名称、完成状态、耗时统计、上下文占用及全部阶段明细的结构化文本至剪贴板。

---

### 3.7 桌面窗口管理、系统托盘与原生通知（[`main.cjs`](file:///d:/ai/tools/agy-monitor/main.cjs)、[`server/config-state.cjs`](file:///d:/ai/tools/agy-monitor/server/config-state.cjs)）
1. **单实例锁与无边框置顶窗口**：
   - 通过 `app.requestSingleInstanceLock()` 保证全局单实例运行；二次启动自动唤醒并聚焦已有浮窗。
   - 默认停靠在主显示器右上角（`screen-saver` 最高置顶层级，跳过任务栏 `skipTaskbar: true`），支持拖拽顶栏移动位置，并监听 `index.html`、`css/*`、`js/*` 修改自动热重载。
2. **纯 Node 动态生成的五态系统托盘图标**：
   - 无需外部图片资源，由 [`createTrayPngBuffer`](file:///d:/ai/tools/agy-monitor/server/config-state.cjs#L52-L106) 在内存中直接构造带 CRC32 校验与 Zlib 压缩的 32×32 RGBA PNG 圆环图标，随任务状态（`running`、`compacting`、`stalled`、`error`、`idle`）实时切换托盘图标配色与多行悬停 Tooltip。
3. **托盘交互与防遮挡穿透模式**：
   - 左键单击托盘图标：切换浮窗显示/隐藏（首次隐藏时弹出系统通知引导）。
   - 左键双击托盘图标：强制退出半透明穿透模式并恢复 100% 不透明度聚焦显示。
   - 右键托盘菜单：
     - 显示/隐藏监控浮窗
     - 窗口始终置顶（Checkbox）
     - **半透明点击穿透模式（防遮挡，Checkbox）**：开启后窗口透明度降为 `62%` 且启用 `setIgnoreMouseEvents(true, { forward: true })`，浮窗同步切换虚线边框并显示 `穿透中 · 双击托盘恢复` 提示徽标，鼠标点击直接穿透至底层 IDE 或浏览器。
     - 立即唤醒重调当前任务 / 停止当前运行任务 / 退出监控程序。
4. **Windows 原生系统通知**：
   - **任务完成通知**：当浮窗处于隐藏状态且后台任务由运行中变为完成（100%）时，弹出系统通知提示任务标题与总耗时。
   - **严重卡顿告警**：当任务连续静默满 `120s` 的整数倍（且非 Compacting 状态）时，弹出原生告警通知。

---

## 4. 本地 HTTP 接口清单（`127.0.0.1:17890`）

| 路径 | 方法 | 功能描述 |
| :--- | :--- | :--- |
| `/` 或 `/index.html` | `GET` | 返回监控面板主页面 HTML（含 `no-store` 防缓存头） |
| `/css/*`、`/js/*` | `GET` | 静态资源安全路由（含 `path.normalize` 目录越界校验与 `no-store` 防缓存头） |
| `/api/status` | `GET` | 获取当前监控会话完整快照 JSON，并触发系统托盘状态同步 |
| `/api/select-conv` | `POST` | 切换追踪的会话模式（`auto` 或指定 `convId`） |
| `/api/wakeup` | `POST` | 触发看门狗唤醒指令（优先 AgentAPI，失败兜底剪贴板） |
| `/api/stop-task` | `POST` | 标记手动停止当前会话任务并下发终止指令 |
| `/api/hide-to-tray` | `POST` | 将 Electron 悬浮窗隐藏至系统托盘 |
| `/api/resize` | `POST` | 动态调整 Electron 悬浮窗宽高（展开态 `520×400` / 折叠态 `520×74`） |
| `/api/open-log` | `POST` | 调用系统 `notepad.exe` 打开当前活跃日志文件 |
