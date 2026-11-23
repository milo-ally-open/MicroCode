# 行为规格：Agent GUI 工作台

> 关联提案：[proposal.md](proposal.md)<br>
> 设计：[design.md](design.md)<br>
> 任务：[tasks.md](tasks.md)<br>
> 状态：待评审；目标行为尚未实施。

## 范围与术语

- **Workspace**：GUI 展示的本机项目目录及其显示元数据。
- **Conversation**：用户可创建、浏览、恢复、归档的会话。
- **Run**：一次发送/执行周期及其状态。客户端不规定它由何种 Agent 实现完成。
- **Agent Application Client**：GUI 使用的版本化应用层客户端合同，不等同于 ACP 或模型推理 API。

GUI 面向 Agent 用户工作流，不提供 Harness 注册、选择、发现或编排功能。实现可替换底层 Runtime，只要实现同一 Agent Application Client contract。

### REQ-01：项目工作区

**需求**：用户必须能在 GUI 中打开并切换本地项目工作区。

- **AC-01.1** GUI 可选择、查看、最近访问并重新打开工作区；路径显示规范化后的本地路径。
- **AC-01.2** 工作区丢失或不可访问时显示可恢复错误，不静默切换到其他目录。
- **AC-01.3** 文件操作的权限由服务端决定；GUI 不以隐藏按钮代替服务端授权。

### REQ-02：会话与消息

**需求**：用户必须能通过应用 client 创建、恢复和管理对话。

- **AC-02.1** GUI 能列出会话元数据、创建会话、恢复会话以及归档会话。
- **AC-02.2** 消息按服务端序号和状态投影显示；重连后按 snapshot/event cursor 恢复，不重复提交用户输入。
- **AC-02.3** 会话恢复行为由 Agent Application API 声明；客户端不读取或解析 Pi JSONL。

### REQ-03：运行状态与交互

**需求**：GUI 必须展示 Agent 运行过程和可执行操作，并反映服务端状态。

- **AC-03.1** 运行状态至少区分 idle、running、waiting for user、completed、failed 和 cancelled；未知状态以可读的兼容视图显示。
- **AC-03.2** 流式消息、工具调用、进度、错误和完成状态按事件顺序显示；服务端事件不完整时显示恢复或连接状态。
- **AC-03.3** 取消、steer/follow-up 等操作仅在 client capability 声明支持时启用，并展示实际结果。
- **AC-03.4** 发送期间对重复提交、断线重试和取消竞争有明确 UI 状态，不因自动重连重复执行命令。

### REQ-04：工具活动与审批

**需求**：GUI 必须展示工具进展并安全处理需要用户决定的请求。

- **AC-04.1** 工具活动使用稳定的应用 DTO 展示名称、状态和安全预览；工具内部 SDK 类型不进入 UI contract。
- **AC-04.2** 审批展示操作对象、影响范围、请求来源和有效期；决定绑定到服务端提供的 request ID。
- **AC-04.3** GUI 拒绝已过期、重复或当前会话之外的审批操作并刷新状态。
- **AC-04.4** 隐藏推理、认证凭据和受保护配置不进入 GUI DTO、日志或浏览器持久化。

### REQ-05：客户端与模块边界

**需求**：GUI 必须通过独立、可替换的 Agent Application Client contract 工作。

- **AC-05.1** GUI view/component 层只依赖应用 client 和 view model；不得导入 `src/agent`、`src/kernel`、Pi、ACP SDK、Model Gateway protocol adapter 或具体 provider SDK。
- **AC-05.2** API client 负责认证、命令请求、事件订阅、重连和 snapshot；GUI 组件不自行拼装协议 payload。
- **AC-05.3** fake application client 可驱动所有主要页面状态，且 UI 模块可独立启动用于开发。
- **AC-05.4** API/service 不可用、版本不兼容或认证失败时显示明确的恢复指引，不泄露 token。

### REQ-06：本机安全与兼容

**需求**：GUI 必须保持本机客户端的最小信任边界，并兼容现有 CLI/TUI。

- **AC-06.1** Runtime bearer token、OAuth/API credential 和审批 secret 不写入 URL、renderer/browser persistent storage、诊断日志或 crash report。
- **AC-06.2** 本机 API 默认只绑定 loopback；GUI 连接失败时不自动退回到未认证/远程服务。
- **AC-06.3** GUI 生命周期不擅自终止仍被 CLI/TUI 使用的 Runtime 服务。
- **AC-06.4** 新增 GUI 不改变 CLI 默认启动、TUI 和 `--no-daemon` 的会话、权限或退出语义。

### REQ-07：打包与可访问性

**需求**：发布的 GUI 必须可安装、升级和通过常见辅助交互操作。

- **AC-07.1** shell/平台选择、启动/退出行为、更新方式和最小 OS matrix 由实现前 design decision 记录。
- **AC-07.2** 键盘可完成主要导航、消息发送和审批；状态变化有可读文本，不仅依赖颜色。
- **AC-07.3** 打包内容不包含运行时下载的模型目录、provider SDK 或第三方 Harness。

## 不变量与明确不做

- GUI Workbench 是 Agent 产品前端；它不定义或暴露 Harness 抽象。
- GUI Application API 与 ACP 是不同边界。ACP Agent endpoint 即使将来实现，也不作为 GUI 的私有 UI API。
- Provider/model selection 属于应用能力，但其 DTO 不携带密钥或底层 SDK 对象。
- 本规格不实现后台 Agent swarm、共享多 Agent transcript、跨 Agent task planner 或远程协作。
- CLI/TUI 和 no-daemon 模式维持运行时架构规格中的合同。

## 需求追踪

| 上游目标 | REQ | 模块 | 任务 | 验收 | 状态 |
|---|---|---|---|---|---|
| 本机 Agent GUI 前端 | REQ-01、REQ-02、REQ-03 | `src/gui-workbench/` | T-01、T-02、T-05 | AC-01.1 至 AC-03.4 | 待实施 |
| 工具/审批/安全交互 | REQ-04、REQ-06 | GUI client 与 host | T-03、T-04、T-05 | AC-04.1 至 AC-04.4、AC-06.1 至 AC-06.4 | 待实施 |
| GUI 与具体执行实现解耦 | REQ-05、REQ-07 | Workbench UI、Agent Application Client、打包 | T-01、T-05、T-06 | AC-05.1 至 AC-05.4、AC-07.1 至 AC-07.3 | 待实施 |

## 未决问题

- `[待评审]` GUI 首发采用桌面 shell 还是本地浏览器 shell。
- `[待评审]` Agent Application API 的具体 wire protocol 与 daemon lifecycle；明确不复用 ACP。
- `[待评审]` 是否首发覆盖 `/model`、MCP/Plugin 设置和 Git 操作；默认先聚焦会话、运行、工具与审批。

## 变更记录

| 日期 | 内容 |
|---|---|
| 2026-11-24 | 首稿：Harness-neutral Agent 前端 GUI 工作台行为规格 |
