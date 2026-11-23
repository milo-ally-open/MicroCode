# 提案：MicroCode ACP Agent 支持

> 状态：首期实现中；stdio/runtime slice 已落地，互操作验收待完成<br>
> 负责人：MicroCode maintainers<br>
> 规格：[spec.md](spec.md)；设计：[design.md](design.md)；任务：[tasks.md](tasks.md)

## 背景与目标

实现 Agent Client Protocol (ACP) 的 Agent 端，使兼容编辑器可以启动并与 MicroCode Agent 交互。ACP 是 Agent 与 Client 之间的会话协议：JSON-RPC 方法/通知、初始化与能力协商、session lifecycle、prompt turns、streamed updates、permission request 和可选 Client filesystem/terminal capabilities。

首期建议采用 ACP stable v1、stdio transport，由编辑器作为 Client 启动 MicroCode 子进程。官方协议页面目前将 v1 标为 latest、v2 标为 preview；v2 内容仍作为后续评估候选，不能未经评审进入稳定实现。[ACP overview](https://agentclientprotocol.com/protocol/v1/overview) · [ACP transports](https://agentclientprotocol.com/protocol/v1/transports) · [v2 preview announcement](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/announcements/acp-v2-draft.mdx)

## 本项目边界

- ACP Agent transport/DTO 与当前 Agent Runtime 通过 ACP adapter 连接；ACP adapter 不重写 model/provider/kernel 行为。
- ACP adapter 位于 `src/daemon/acp-agent/`；CLI 入口只装配 ACP host，Runtime composition 由 daemon runtime-service 提供。
- ACP 子进程 stdout 只用于 ACP JSON-RPC framing；诊断输出只能写 stderr。
- 每个 ACP session 映射到服务端隔离的 MicroCode session/permission state；保留现有 allowlist、PermissionManager 和 credential store。
- GUI Workbench 是另一个产品前端和应用层合同；ACP 不作为 GUI 私有 API。

## 不在首期范围

- ACP Client：由 MicroCode 启动并控制第三方 ACP Agent。
- ACP Proxy/Conductor、ACP Registry/discovery、remote transport、v2 preview feature。
- MCP-over-ACP、Client filesystem/terminal capability，除非各自安全范围经单独审查。
- 放宽工具权限、读取其他客户端凭据或修改模型 provider allowlist。

## 成功观察

- 兼容 ACP v1 Client 能完成 initialize、session/new、prompt/update/response、cancel 和 permission flow。
- 不支持的能力被准确声明；过程可恢复、失败可诊断，且 stdout 无协议外文本。
- 基础 CLI/TUI、daemon runtime、Model Gateway 和 `--no-daemon` 行为不变。

## 主要未决项

| 决策 | 建议 | 状态 |
|---|---|---|
| 官方 TypeScript SDK 或手写窄协议 adapter | 采用官方 SDK `@agentclientprotocol/sdk` 2.9.1 的 stable v1 默认入口；Bun standalone 编译已通过，目标客户端兼容性待验收 | 已决定；客户端验收待完成 |
| 进程入口 | 新增显式 `microcode acp` 子命令，不改变 `microcode` 默认启动行为 | 已实现 |
| Session 持久化 | 每个 ACP session 使用独立服务端 session transcript；ACP Session ID 与内部 session ID 显式映射 | 已实现并由 subprocess 测试覆盖 |
| Capability | 先只声明已实现且经过测试的字段；FS/terminal defaults 为关闭 | 已实现；profile 见 design.md |

## 变更记录

| 日期 | 内容 |
|---|---|
| 2026-11-24 | 首稿：定义 MicroCode 作为 ACP v1 Agent 的目标、边界和评审项 |
| 2026-11-24 | 采用官方 stable v1 SDK，开始实现 stdio Agent 与隔离 Runtime session |
