# 实施任务：Agent GUI 工作台

> 关联规格：[spec.md](spec.md)；设计：[design.md](design.md)。任务均未开始。

## 任务

- [ ] **T-01 锁定 GUI shell、应用 client contract 和 module boundary** — 覆盖 REQ-05、REQ-07；AC：AC-05.1、AC-05.2、AC-05.3、AC-07.1、AC-07.3；交付 shell 决策、版本化 DTO/commands/events、fake client 与依赖方向检查；依赖：无。
- [ ] **T-02 实现 Workspace、Conversation 与消息页面** — 覆盖 REQ-01、REQ-02；AC：AC-01.1、AC-01.2、AC-01.3、AC-02.1、AC-02.2、AC-02.3；交付列表/创建/恢复/归档、消息流和目录不可用恢复状态；依赖：T-01。
- [ ] **T-03 实现 Run、tool activity 与实时事件状态** — 覆盖 REQ-03、REQ-05；AC：AC-03.1、AC-03.2、AC-03.3、AC-03.4、AC-05.2、AC-05.4；交付事件 timeline、取消/steer capability gating、重连与 snapshot recovery；依赖：T-01、T-02。
- [ ] **T-04 实现权限审批和敏感数据处理** — 覆盖 REQ-04、REQ-06；AC：AC-04.1、AC-04.2、AC-04.3、AC-04.4、AC-06.1、AC-06.2；交付请求预览/过期状态、request-bound resolution、secret-safe diagnostics；依赖：T-01、T-03。
- [ ] **T-05 集成初始 Agent Application host，并验证 CLI/TUI 兼容** — 覆盖 REQ-02、REQ-03、REQ-05、REQ-06；AC：AC-02.1、AC-02.2、AC-03.1 至 AC-03.4、AC-05.1 至 AC-05.4、AC-06.3、AC-06.4；交付现有 Runtime client/facades 到 UI contract 的 host adapter 与生命周期验收；依赖：T-01 至 T-04。
- [ ] **T-06 完成打包、可访问性与 release 验收** — 覆盖 REQ-06、REQ-07；AC：AC-06.1 至 AC-06.4、AC-07.1、AC-07.2、AC-07.3；交付所选平台构建、键盘访问检查、凭据/退出审查及安装说明；依赖：T-05。

## 验收记录

| 范围 | 证据 | 状态 |
|---|---|---|
| 全部 REQ/AC | 文档计划；实现未开始 | 未验证 |

## 变更记录

| 日期 | 内容 |
|---|---|
| 2026-11-24 | 首稿：将旧多 Harness 工作台目标收敛为独立 Agent GUI 前端 |
