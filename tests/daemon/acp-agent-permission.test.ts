import { describe, expect, test } from 'bun:test'
import { ensureBootstrapMacro } from '../../src/macro.ts'
import { cancelAcpSession, handleRuntimeEvent, promptAcpSession, type AcpRuntimeSession } from '../../src/daemon/acp-agent/runtimeSession.ts'
import type { RuntimeEventEnvelope } from '../../src/runtime/contracts.ts'
import type { PromptRequest } from '@agentclientprotocol/sdk'

describe('ACP Agent permission projection', () => {
  test('maps only allow-once/reject-once outcomes and omits raw tool values', async () => {
    ensureBootstrapMacro()
    const clientRequests: Array<Record<string, unknown>> = []
    const updates: Array<Record<string, unknown>> = []
    const runtimeCommands: Array<{ type: string; payload: Record<string, unknown> }> = []
    const session = {
      id: 'acp-session',
      cwd: '/workspace',
      closed: false,
      closeController: new AbortController(),
      pendingPermissions: new Map(),
      toolCallIds: new Map(),
      eventTail: Promise.resolve(),
      client: {
        request: async (_method: string, params: Record<string, unknown>) => {
          clientRequests.push(params)
          return { outcome: { outcome: 'selected', optionId: 'allow_once' } }
        },
        notify: async (_method: string, params: { update: Record<string, unknown> }) => {
          updates.push(params.update)
        },
      },
      runtime: {
        sendCommand: async (type: string, payload: Record<string, unknown>) => {
          runtimeCommands.push({ type, payload })
        },
      },
    } as unknown as AcpRuntimeSession

    await handleRuntimeEvent(session, {
      protocol_version: 1,
      session_id: 'internal-session',
      sequence: 1,
      type: 'permission_requested',
      payload: {
        request: {
          request_id: 'permission-1',
          kind: 'tool',
          tool_id: 'bash',
          input: { command: 'echo do-not-send-this-token' },
          description: 'echo do-not-send-this-token',
        },
      },
    } satisfies RuntimeEventEnvelope)

    expect(clientRequests[0]).toMatchObject({
      sessionId: 'acp-session',
      toolCall: { toolCallId: 'permission-1', title: 'Run a shell command', name: 'bash', status: 'pending' },
      options: [
        { optionId: 'allow_once', kind: 'allow_once' },
        { optionId: 'reject_once', kind: 'reject_once' },
      ],
    })
    expect(JSON.stringify(clientRequests)).not.toContain('do-not-send-this-token')
    expect(runtimeCommands).toEqual([{
      type: 'permission.resolve',
      payload: { request_id: 'permission-1', allowed: true },
    }])

    await handleRuntimeEvent(session, {
      protocol_version: 1,
      session_id: 'internal-session',
      sequence: 2,
      type: 'tool_execution_start',
      payload: {
        tool_call_id: 'kernel-call-1',
        tool_id: 'bash',
        arguments: { command: 'echo do-not-send-this-token' },
      },
    } satisfies RuntimeEventEnvelope)
    await handleRuntimeEvent(session, {
      protocol_version: 1,
      session_id: 'internal-session',
      sequence: 3,
      type: 'tool_execution_end',
      payload: { tool_call_id: 'kernel-call-1', tool_id: 'bash', is_error: false },
    } satisfies RuntimeEventEnvelope)

    expect(updates).toEqual([
      { sessionUpdate: 'tool_call_update', toolCallId: 'permission-1', status: 'in_progress', title: 'Run a shell command' },
      { sessionUpdate: 'tool_call_update', toolCallId: 'permission-1', status: 'completed' },
    ])
    expect(JSON.stringify(updates)).not.toContain('do-not-send-this-token')
  })

  test('cancels only the active runtime turn and reports the cancelled stop reason', async () => {
    ensureBootstrapMacro()
    const runtimeCommands: string[] = []
    const session = {
      id: 'acp-session',
      cwd: '/workspace',
      closed: false,
      closeController: new AbortController(),
      pendingPermissions: new Map(),
      toolCallIds: new Map(),
      eventTail: Promise.resolve(),
      client: {
        request: async () => ({ outcome: { outcome: 'cancelled' } }),
        notify: async () => undefined,
      },
      runtime: {
        sendCommand: async (type: string) => {
          runtimeCommands.push(type)
        },
      },
    } as unknown as AcpRuntimeSession
    const request: PromptRequest = {
      sessionId: session.id,
      prompt: [{ type: 'text', text: 'Wait for cancellation.' }],
    }

    const prompt = promptAcpSession(session, request, new AbortController().signal, 'client-request-7')
    while (!session.activeTurn?.started) await Promise.resolve()
    await cancelAcpSession(session)
    await handleRuntimeEvent(session, {
      protocol_version: 1,
      session_id: 'internal-session',
      sequence: 1,
      type: 'turn_end',
      payload: {
        message: {
          role: 'assistant',
          content: [],
          stop_reason: 'aborted',
        },
      },
    } satisfies RuntimeEventEnvelope)

    expect(await prompt).toBe('cancelled')
    expect(runtimeCommands).toEqual(['prompt', 'abort'])
  })

  test('streams assistant text and keeps ACP and Runtime request IDs distinct', async () => {
    ensureBootstrapMacro()
    const updates: Array<Record<string, unknown>> = []
    let runtimePromptRequestId = ''
    const session = {
      id: 'acp-session',
      cwd: '/workspace',
      closed: false,
      closeController: new AbortController(),
      pendingPermissions: new Map(),
      toolCallIds: new Map(),
      eventTail: Promise.resolve(),
      client: {
        request: async () => ({ outcome: { outcome: 'cancelled' } }),
        notify: async (_method: string, params: { update: Record<string, unknown> }) => {
          updates.push(params.update)
        },
      },
      runtime: {
        sendCommand: async (type: string, _payload: Record<string, unknown>, requestId: string) => {
          if (type === 'prompt') runtimePromptRequestId = requestId
        },
      },
    } as unknown as AcpRuntimeSession

    const prompt = promptAcpSession(session, {
      sessionId: session.id,
      prompt: [{ type: 'text', text: 'Say hello.' }],
    }, new AbortController().signal, 'client-request-9')
    while (!session.activeTurn?.started) await Promise.resolve()

    await handleRuntimeEvent(session, {
      protocol_version: 1,
      session_id: 'internal-session',
      sequence: 1,
      type: 'message_update',
      payload: { assistant_event: { type: 'text_delta', delta: 'Hello.' } },
    } satisfies RuntimeEventEnvelope)
    await handleRuntimeEvent(session, {
      protocol_version: 1,
      session_id: 'internal-session',
      sequence: 2,
      type: 'turn_end',
      payload: {
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello.' }],
          stop_reason: 'stop',
        },
      },
    } satisfies RuntimeEventEnvelope)

    expect(await prompt).toBe('end_turn')
    expect(runtimePromptRequestId).not.toBe('client-request-9')
    expect(updates.some((update) => update.sessionUpdate === 'agent_message_chunk'
      && (update.content as { text?: string }).text === 'Hello.')).toBe(true)
  })
})
