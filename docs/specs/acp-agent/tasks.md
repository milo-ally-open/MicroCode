# 实施任务：ACP Agent 支持

> 关联规格：[spec.md](spec.md)；设计：[design.md](design.md)。

## 任务

- [x] **T-01 评审协议版本、SDK 与 CLI composition** — 覆盖 REQ-01、REQ-06、REQ-07；AC：AC-01.1、AC-01.2、AC-01.3、AC-01.4、AC-06.2、AC-06.3、AC-07.1、AC-07.2；交付：审核 stable v1 与官方 SDK 2.9.1、确认 Bun standalone build 可行、确定显式 ACP entry 和首期 capability profile；依赖：无。
- [x] **T-02 实现 ACP v1 stdio transport 与 JSON-RPC methods** — 覆盖 REQ-01、REQ-03、REQ-06；AC：AC-01.1 至 AC-01.4、AC-03.1、AC-03.3、AC-03.5、AC-06.1；交付：initialize/version negotiation、session/new、prompt lifecycle、error mapping、stdout framing subprocess tests；依赖：T-01。
- [x] **T-03 实现隔离 session mapping、事件流与取消** — 覆盖 REQ-02、REQ-03、REQ-06；AC：AC-02.1 至 AC-02.4、AC-03.2 至 AC-03.5、AC-06.2；交付：独立 ACP/Runtime IDs、每 session Runtime owner、未支持 loadSession 策略、事件顺序、cancel/EOF cleanup tests；依赖：T-02。
- [x] **T-04 实现工具活动和 PermissionManager mapping** — 覆盖 REQ-04、REQ-05；AC：AC-04.1 至 AC-04.6、AC-05.1 至 AC-05.4；交付：tool_call updates、session/request-bound permission mapping、安全 payload projection、unsupported capability/block tests；依赖：T-03。
- [ ] **T-05 完成兼容、打包、安全和发布验收** — 覆盖 REQ-01、REQ-02、REQ-03、REQ-04、REQ-05、REQ-06、REQ-07；AC：AC-01.1、AC-01.2、AC-01.3、AC-01.4、AC-02.1、AC-02.2、AC-02.3、AC-02.4、AC-03.1、AC-03.2、AC-03.3、AC-03.4、AC-03.5、AC-04.1、AC-04.2、AC-04.3、AC-04.4、AC-04.5、AC-04.6、AC-05.1、AC-05.2、AC-05.3、AC-05.4、AC-06.1、AC-06.2、AC-06.3、AC-06.4、AC-07.1、AC-07.2、AC-07.3；交付：fixed protocol fixtures、官方 SDK/schema contract、已声明客户端版本的互操作证据、standalone build、CLI/TUI regression、安全脱敏复核和发布说明；依赖：T-01、T-02、T-03、T-04。

## 验收记录

| 范围 | 证据 | 状态 |
|---|---|---|
| REQ-01、REQ-02、REQ-03、REQ-04、REQ-05、REQ-06 范围内的首期 slice | `bun test ./tests`：304 passed、1 skipped、0 failed；`tsc --noEmit` 通过；standalone Bun compile 成功；真实编辑器互操作尚未验收 | 部分验证 |
| REQ-07 发布兼容性 | SDK 2.9.1 stable v1 entry 已 pin；设计中记录 capability profile；目标编辑器和版本尚未指定/实测 | 待完成（T-05） |

## 变更记录

| 日期 | 内容 |
|---|---|
| 2026-11-24 | 首稿：规划 ACP stable v1 Agent 端实现和互操作验收 |
| 2026-11-24 | 完成 T-01 至 T-04；记录本地协议/构建/测试证据，保留客户端互操作发布门槛 |
