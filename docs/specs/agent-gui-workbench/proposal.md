# 提案：Agent GUI 工作台

> 状态：待评审<br>
> 负责人：MicroCode maintainers<br>
> 规格：[spec.md](spec.md)；设计：[design.md](design.md)；任务：[tasks.md](tasks.md)

## 背景

项目目前以 CLI/TUI 使用本地 Agent Runtime。需要增加图形客户端，提供 Workspace、conversation、运行事件、工具活动和审批等可视化操作。

此 GUI 是 Agent 产品前端。它不管理或识别 Harness，不直接导入 Agent 实现、Pi 类型、ACP 协议类型或具体模型 SDK。界面通过稳定的 Agent Application Client contract 与本机应用服务通信。底层 Runtime 可以是当前 MicroCode 实现；GUI 的领域模型和交互不以该实现细节为前提。

## 目标

- 增加独立的本地 GUI 客户端，并保留现有 CLI/TUI 和 `--no-daemon` 行为。
- 通过客户端合同呈现工作区、会话、消息、运行状态、工具进度、审批和诊断。
- 把 UI view model 与传输/服务端实现分离，使用 fake client 可独立开发和验证 UI。
- 定义鉴权、事件恢复、错误处理和 GUI 生命周期要求。

## 不在范围内

- Harness、ACP、Agent-to-Agent 协作或多后端运行时编排。
- 重写 Agent core、Pi integration、Model Gateway 或现有 CLI/TUI。
- 云托管、多用户、远程工作区、自动更新或发布平台。
- 在技术栈选型前确定 Electron、Tauri、浏览器或具体 UI framework。

## 现状依据

- MicroCode 当前 CLI/TUI 与 Bun Runtime 的实现及边界以[运行时架构规格](../runtime-architecture/spec.md)为准。
- 本地 Model Gateway 与 Pi 集成边界以[运行时架构规格](../runtime-architecture/spec.md)和[模型供应商指南](../runtime-architecture/model-provider-guide.md)为准。
- 本仓库目前没有 GUI application 或 ACP implementation；这项工作先定义边界和验收，再按任务实施。

## 方案

新增 `src/gui-workbench/` 前端模块和 `src/gui-workbench/client/` 中立 client contract；由独立本机 host 提供 API client 实现。GUI 不直接连接 Model Gateway，也不把模型推理协议当作应用会话 API。

保持 UI 中立的基本方式是让它消费应用级 DTO 与 commands，例如 `listWorkspaces`、`openSession`、`sendMessage`、`cancelRun`、`resolveApproval`、`subscribeEvents`。DTO 不暴露 Agent class、Pi message、ACP wire payload 或 provider secret。

## 未决决策

| 决策 | 建议 | 状态 |
|---|---|---|
| GUI shell | 先评估桌面 shell 与本地浏览器 shell；将运行/鉴权/退出做成可验证决策 | 待评审 |
| 前端技术栈 | 根据平台、打包、权限与现有 Bun build 能力选择 | 待评审 |
| GUI 与 daemon 的协议 | 使用专用版本化 Agent Application API；不复用 ACP | 待评审 |
| 同一会话多客户端写入 | 首版单写入控制者，可有只读 observer | 建议 |

## 变更记录

| 日期 | 内容 |
|---|---|
| 2026-11-24 | 首稿：定义与 Harness/Agent 实现解耦的 Agent GUI 前端边界 |
