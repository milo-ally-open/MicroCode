# 设计：Agent GUI 工作台

> 行为合同：[spec.md](spec.md)；状态与范围：[proposal.md](proposal.md)。

## 模块与依赖方向

```text
GUI views / interaction state
             │ Agent Application Client
             ▼
Versioned Agent Application API
             │ host implementation
             ├── existing MicroCode Runtime service (initial backing)
             └── future compatible application host
```

- `src/gui-workbench/` contains presentation, view models, and client-facing commands.
- `src/gui-workbench/client/` defines application-level interfaces and DTOs.
- Runtime/API transport implementation stays outside GUI components; protocol choice and GUI shell remain design decisions.
- MicroCode Runtime is the initial host, but GUI modules cannot import Agent, Kernel, Pi or SessionManager implementation types.
- ACP is an independent protocol integration. The GUI must not depend on ACP packet/feature types.

## Contract shape

The application contract covers workspace/session listing and lifecycle; message submit/steer/cancel; event subscription and snapshot; run and tool activity projection; approval list/resolve; model catalog metadata if enabled. Commands carry request IDs for idempotency. Events carry session ID, monotonic cursor, timestamp, stable kind, and safe application payload. Unsupported features are capability-gated.

The first host adapter maps the existing Runtime client/facades into this UI contract. Mapping belongs in host/client composition, not React/view components. Fake clients reproduce reconnect, unknown event, stale approval and service unavailable states.

## Local security

- Bind the local application API to loopback by default and perform an authenticated handshake before commands/events.
- Keep credentials in the host's protected credential lifecycle. GUI renderer receives only short-lived authorized client state, never provider credentials.
- Avoid storing bearer credentials in browser local/session storage. Use a platform-selected secure transport/session mechanism before shell implementation.
- Filter sensitive tool output server-side; UI masking is defense in depth only.

## State and errors

- Client state separates persisted snapshot from transient connection state.
- Reconnect resumes from last event cursor; if replay is unavailable, replace from a fresh snapshot and de-duplicate by command/request ID.
- Unknown events or state values are surfaced as generic activity and retained in diagnostics only after redaction.
- Approval resolution uses server-owned pending request IDs and expiry; local UI cannot synthesize success state.

## Decisions deferred

Desktop shell, frontend framework, packaging, multi-window policy and detailed API transport are not locked. T-06 records selected options before implementation. No new dependency is approved by this design.

## 变更记录

| 日期 | 内容 |
|---|---|
| 2026-11-24 | 首稿：定义 GUI/client/API 的隔离边界与本机安全约束 |
