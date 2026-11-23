# 设计：MicroCode ACP Agent

> 行为合同：[spec.md](spec.md)；提案：[proposal.md](proposal.md)。

## Protocol boundary

```text
ACP Client/editor
      │ UTF-8 JSON-RPC, stdio framing (ACP v1)
      ▼
`microcode acp` → `src/daemon/acp-agent/` subprocess host / protocol adapter
      │ internal application commands/events
      ▼
MicroCode runtime-service session owner
      ├── MicrocodeAgent + PermissionManager
      ├── SessionManager / JSONL transcript
      └── models/providers and capability policy
```

ACP is an inbound Agent protocol boundary. It is separate from the Agent GUI Application API and the Model Gateway's outbound model-inference protocols. ACP DTOs terminate at the adapter; internal runtime contracts remain authoritative.

## Process and transport

- Explicit CLI entry (proposed `microcode acp`) is launched by the ACP Client as a child process.
- stdin/stdout are owned exclusively by the JSON-RPC stdio transport. No TUI initialization, banner, prompt, or logs on stdout. Logs go to stderr.
- Runtime composition must avoid competing readers of stdin/stdout and must not start a second interactive UI.
- JSON-RPC request processing is concurrent where the protocol permits it, but session state mutations are serialized per session; cancellation is scoped to active prompt request/session.
- EOF/child shutdown closes only resources owned by this ACP host. It does not shut down a shared daemon still used by other clients.
- The implementation pins `@agentclientprotocol/sdk` 2.9.1 and imports its stable default v1 entrypoint. `ndJsonStream` supplies the UTF-8 newline-delimited transport and schema validation.
- Initialization reports protocol version 1. When a client requests another major version, the Agent reports its supported version so the Client can detect incompatibility as specified by ACP.

## Runtime owner

- Each `session/new` creates a distinct `RuntimeAgentSession` and an owned loopback Runtime service on an ephemeral port. ACP session IDs and internal Runtime session IDs are generated independently.
- The ACP host creates and closes these Runtime services in-process. Each uses a random per-session Runtime token, and shutdown closes its Runtime service, MCP connections, pending approvals, and event stream.
- `cwd` must resolve to the directory used to start `microcode acp`. Additional directories, client-provided system prompts, and client MCP server definitions are rejected. Project and user MCP configuration continues to load through MicroCode's existing configuration path.
- `session/close` persists the Runtime transcript and releases the active owner. Transcript deletion and session replay are not advertised.

## Session and state mapping

- Maintain explicit mapping: ACP session ID ↔ internal runtime session ID; prompt request ID ↔ internal run/cancellation token. Never infer one identifier from another.
- `session/new` canonicalizes cwd and applies existing workspace/path policy before creating a runtime session.
- `loadSession` is advertised only when the implementation can restore the exact transcript and emit required history replay. Do not claim support based solely on JSONL existence.
- Translate internal events to ACP v1 `session/update`; preserve order, session affinity, and valid final stop reason.
- Permission requests use internal pending request ID and PermissionManager owner. ACP response outcome is mapped only to the exact pending request; unknown outcomes deny.

## Capabilities and tool I/O

- Start with the smallest truthful capabilities (text prompts, supported session methods, truthful cancel semantics).
- Do not declare Client `fs` or `terminal` support in initial profile. MicroCode Agent uses its own authorized tool adapters, not editor-owned filesystem methods.
- Map tool activity to ACP tool call updates; payload projections are bounded and redacted. ACP location metadata does not grant path authorization.
- Image/audio/context block support is determined by the actual input mapper and selected model capability; unsupported blocks return a clear error.

## Compatibility profile

| ACP v1 feature | Initial Agent profile | Evidence / limit |
|---|---|---|
| Transport and initialize | UTF-8 newline-delimited JSON-RPC; version 1; no auth methods | Official SDK `ndJsonStream` and subprocess framing test; editor interoperability remains open |
| Sessions | `session/new`, `session/prompt`, `session/cancel`, `session/close` | End-to-end subprocess tests; cwd must match process cwd |
| Prompt content | Text and resource links | Unsupported content blocks return invalid params; no image/audio support is claimed |
| Session updates | Assistant text chunks and tool call lifecycle | Runtime event mapping tests; internal plan and reasoning are not exposed |
| Permissions | Allow once or reject once | Mapping tests; no persistent ACP grant is offered |
| Restore and client tools | No `loadSession`, `fs`, `terminal`, MCP-over-ACP, or elicitation | Capabilities omitted; unsupported question tool requests are blocked |

This profile records implemented behavior, not full ACP conformance. T-05 remains open until a declared editor/client version is exercised and release evidence is recorded.

## SDK decision

The official SDK is pinned to 2.9.1. Its package license is Apache-2.0, its default entrypoint is stable ACP v1, and the v2 protocol uses a separate experimental import. The implementation uses the SDK's typed Agent handlers and schema-validated stdio stream. The standalone Bun build and editor interoperability remain release gates.

## Security and compatibility

- cwd is canonicalized and checked against the MicroCode workspace root policy; ACP `cwd` cannot authorize arbitrary external paths.
- API/OAuth/MCP secrets are never placed in ACP event payloads, diagnostics, arguments, or stdout.
- ACP tool updates omit raw inputs and outputs. Permission requests carry an operation label and only allow-once/reject-once choices.
- stdout parser tests reject any non-JSON-RPC line; malformed requests cannot crash unrelated runtime sessions.
- Protocol compliance is tested against the chosen official SDK/schema and at least one declared editor/client version before claiming compatibility.
- ACP v2 preview, custom remote transport, MCP-over-ACP, FS/terminal client capabilities and ACP Client role remain separate proposals.

## 变更记录

| 日期 | 内容 |
|---|---|
| 2026-11-24 | 首稿：定义 ACP v1 Agent 子进程边界、session mapping 和权限处理 |
| 2026-11-24 | 锁定 TypeScript SDK 2.9.1 stable v1，补充独立 Runtime owner 与当前 stdio session 边界 |
