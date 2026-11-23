# 行为规格：ACP Agent 支持

> 提案：[proposal.md](proposal.md)<br>
> 设计：[design.md](design.md)<br>
> 任务：[tasks.md](tasks.md)<br>
> 状态：stdio/runtime 首期 slice 已实现；目标客户端互操作和发布验收仍在 T-05。

## ACP 角色与版本范围

本项目首期作为 ACP **Agent**，由外部 ACP Client 启动。基线采用 ACP stable v1 over stdio；仅在完成兼容性与依赖审查后才锁定 SDK/API。ACP v2 当前官方文档标为 preview，首期不承诺。

ACP 是 JSON-RPC 2.0 双向请求/通知协议，不是 Model Gateway 协议，也不是 GUI 工作台的内部 API。[协议概览](https://agentclientprotocol.com/protocol/v1/overview)；初始化协商版本和 capabilities，之后建立 session、处理 prompt turn，并通过 session/update 通知推送进度。[初始化](https://agentclientprotocol.com/protocol/v1/initialization) · [session setup](https://agentclientprotocol.com/protocol/v1/session-setup) · [prompt turn](https://agentclientprotocol.com/protocol/v1/prompt-turn)

### REQ-01：ACP v1 连接与初始化

**需求**：ACP Agent 必须实现所选 ACP v1 stable schema 的 JSON-RPC 初始化和 stdio framing。依赖锁定官方 `@agentclientprotocol/sdk` 2.9.1 的 stable v1 默认入口。

- **AC-01.1** 启动后通过 stdin 读取 UTF-8、逐行 JSON-RPC 消息，并逐行写入合法 JSON-RPC 响应/通知。
- **AC-01.2** stdout 不出现 banner、TUI、日志、debug 或其他非 ACP 文本；诊断写 stderr。
- **AC-01.3** initialize 返回 Agent 支持的协议版本 1 和实际 capabilities；请求其他主版本时明确返回所支持版本，malformed request 返回 schema 定义的 JSON-RPC 错误。
- **AC-01.4** 只报告本实现实际支持且经过验收的 Agent capabilities、auth methods、Agent info。

### REQ-02：ACP session lifecycle

**需求**：每个 ACP session 必须映射到隔离的 MicroCode server-side session owner。

- **AC-02.1** `session/new` 校验 cwd 和可选配置，然后创建唯一 ACP session ID 与唯一内部 session mapping。
- **AC-02.2** 两个 ACP session 的 transcript、正在运行任务、审批和取消互不串线。
- **AC-02.3** 只有真实实现恢复与历史 replay 后才能声明 `loadSession` 并接受对应恢复请求。
- **AC-02.4** `session/close` 结束 ACP session owner 并保留内部 transcript；不声明 transcript delete/load 能力；客户端断连不能误删 transcript。

### REQ-03：Prompt turn 与流式事件

**需求**：prompt turn 必须正确映射到 Agent runtime，并遵守 ACP 消息/事件顺序。

- **AC-03.1** `session/prompt` 支持范围严格对应协商后的 prompt content capabilities；未支持的 block 明确拒绝或按协议定义处理。
- **AC-03.2** assistant output、tool activity、plan/state update 只映射到已实现的 ACP v1 update kinds；保持 per-session event order。
- **AC-03.3** Prompt response 仅在前台 turn 完成/失败/取消后返回，并提供准确 stop reason。
- **AC-03.4** `session/cancel` 仅取消匹配 session 的活动 turn，停止信号传递至 runtime；晚到事件不能把 cancelled turn 复活成 running。
- **AC-03.5** JSON-RPC request ID、ACP session ID、内部 session/run ID 映射分离且可诊断。

### REQ-04：审批与工具活动

**需求**：工具活动与 permission request 必须在 ACP turn 内安全呈现和处理。

- **AC-04.1** 工具调用状态使用 ACP pending/in_progress/completed/failed 生命周期，包含稳定 toolCallId 和安全的 title/kind；只有安全可用时才附带 location/content。
- **AC-04.2** 危险操作继续经过内部 PermissionManager；ACP permission request 标明工具名称和操作类别，仅提供 allow-once/reject-once；选择结果回传当前匹配请求。
- **AC-04.3** 过期、重复、未知 outcome 或跨 session 的 permission response 不能授权操作。
- **AC-04.4** Runtime 工具安全策略不因 Client capabilities、ACP tool name 或 `allow_always` 名称而绕过；保存授权范围由 Agent policy 决定。
- **AC-04.5** ACP tool updates 不发送 rawInput/rawOutput、工具预览或内部错误；assistant updates 不发送隐藏 reasoning；permission request 只发送不含输入值的操作标签。
- **AC-04.6** 首期不声明 Client elicitation capability；`AskUserQuestion` 请求以 blocked 结果结束，不等待无响应的用户输入。

### REQ-05：文件、终端与其他可选能力

**需求**：ACP Agent 不得把 Client capability 声明当作额外工具授权。

- **AC-05.1** 首期默认不声明 Client fs 或 terminal capability，除非实现了完整授权、路径验证、审批和 isolated run test。
- **AC-05.2** 所有实际文件操作仍走内部 workspace path guard 和 PermissionManager；ACP root/cwd 不能扩大现有授权范围。
- **AC-05.3** Client 未声明能力时，不发送相应 fs/terminal request。
- **AC-05.4** 图片/audio/embedded context 等 prompt blocks 按底层 Agent 和锁定模型能力逐项声明，unsupported 内容不能静默丢弃。

### REQ-06：错误、取消、退出和安全

**需求**：协议错误和子进程生命周期必须可预测，不影响普通 CLI/TUI。

- **AC-06.1** protocol errors 映射到 ACP/JSON-RPC 定义的 error code；内部异常不暴露 stack、路径 secrets 或 credential。
- **AC-06.2** EOF、broken pipe、Client cancellation 和 SIGTERM 有序停止该 ACP host 持有的 turn/resources，不关闭其他客户端正在使用的共享 daemon。
- **AC-06.3** `microcode acp` 为显式入口；普通 CLI、`--no-daemon` 和 Gateway 子命令行为不变。
- **AC-06.4** CI tests 不调用真实模型服务、不需要 OAuth/API secrets；协议 interoperability 通过固定 fixture 和官方 schema/SDK contract tests。

### REQ-07：兼容性与依赖策略

**需求**：ACP 依赖与协议版本必须显式锁定、可升级和可验证。

- **AC-07.1** `package.json`/`bun.lock` 锁定经审核的官方 SDK stable v1 入口版本，或记录选择自研窄 adapter 的原因；不得运行时下载 schema/feature catalog。
- **AC-07.2** 升级前对照官方 stable v1 docs/schema、SDK release notes 和 Bun standalone build 检查；v2 preview 需单独评审。
- **AC-07.3** 目标客户端/版本与 ACP compatibility evidence 记录在 release readiness；不把“能启动/能发文字”宣称为完整 ACP 兼容。

## 不变量与范围外

- MicroCode Agent Runtime 和模型选择仍由本项目现有架构拥有；ACP adapter 只做 protocol/application mapping。
- ACP 不替代 GUI Workbench API，不引入 Harness registry 或跨 Harness orchestration。
- 首期仅 Agent + stdio stable v1；ACP Client、remote transports、Proxy/Conductor、registry、v2 preview、FS/terminal client capabilities 都不在首期范围。
- 工具许可、provider allowlist、credential store 和 transcript owner 遵循[运行时架构规格](../runtime-architecture/spec.md)与仓库锁定依赖及实现。

## 需求追踪

| 上游目标 | REQ | 模块 | 任务 | 验收 | 状态 |
|---|---|---|---|---|---|
| MicroCode 可由 ACP-compatible editor 直接启动 | REQ-01、REQ-03 | ACP stdio host/agent adapter | T-01、T-02 | AC-01.1 至 AC-01.4、AC-03.1 至 AC-03.5 | 本地 SDK/subprocess contract 已验证；编辑器互操作待 T-05 |
| 会话、审批和工具安全 | REQ-02、REQ-04、REQ-05 | session bridge、PermissionManager mapping | T-03、T-04 | AC-02.1 至 AC-02.4、AC-04.1 至 AC-05.4 | 已实现；按 tasks.md 记录的自动化测试验证 |
| 子进程、依赖和兼容性 | REQ-06、REQ-07 | CLI entry、ACP tests/build | T-01、T-05 | AC-06.1 至 AC-07.3 | 显式 CLI、SDK pin 和 standalone build 已验证；兼容客户端证据待 T-05 |

## 官方协议参考

- [ACP v1 overview](https://agentclientprotocol.com/protocol/v1/overview)
- [Initialization and capabilities](https://agentclientprotocol.com/protocol/v1/initialization)
- [Session setup](https://agentclientprotocol.com/protocol/v1/session-setup)
- [Prompt turn](https://agentclientprotocol.com/protocol/v1/prompt-turn)
- [Tool calls and permission requests](https://agentclientprotocol.com/protocol/v1/tool-calls)
- [Client filesystem capabilities](https://agentclientprotocol.com/protocol/v1/file-system)
- [stdio transport](https://agentclientprotocol.com/protocol/v1/transports)
- [Security considerations](https://agentclientprotocol.com/protocol/v1/security)
- [ACP v2 draft announcement](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/announcements/acp-v2-draft.mdx)

## 变更记录

| 日期 | 内容 |
|---|---|
| 2026-11-24 | 首稿：限定 stable v1 Agent/stdio 首期支持边界 |
| 2026-11-24 | 对齐官方 initialize 版本协商语义，记录首期 stdio/runtime 实现范围 |
