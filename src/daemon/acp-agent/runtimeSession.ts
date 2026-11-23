import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { methods, RequestError } from '@agentclientprotocol/sdk'
import type { AgentContext, JsonRpcId, PromptRequest, SessionUpdate } from '@agentclientprotocol/sdk'
import { createConfiguredRuntimeAgentService } from '../runtime-service/composition.ts'
import { RuntimeClientSession } from '../../runtime/client.ts'
import { RuntimeServiceClient } from '../../runtime/transportClient.ts'
import type { RuntimeEventEnvelope, RuntimeMessage } from '../../runtime/contracts.ts'

interface ActiveTurn {
  clientRequestId: JsonRpcId
  runtimeRequestId: string
  messageId: string
  text: string
  cancelled: boolean
  started: boolean
  resolve(stopReason: 'end_turn' | 'max_tokens' | 'cancelled'): void
  reject(error: RequestError): void
  result: Promise<'end_turn' | 'max_tokens' | 'cancelled'>
}

interface PendingPermission {
  requestId: string
  toolName: string
  input: Record<string, unknown>
  toolCallId: string
  title: string
}

export interface AcpRuntimeSession {
  readonly id: string
  readonly cwd: string
  readonly client: AgentContext
  readonly service: Awaited<ReturnType<typeof createConfiguredRuntimeAgentService>>
  readonly runtime: RuntimeClientSession
  readonly closeController: AbortController
  readonly pendingPermissions: Map<string, PendingPermission>
  readonly toolCallIds: Map<string, string>
  eventTail: Promise<void>
  activeTurn?: ActiveTurn
  closed: boolean
  unsubscribe?: () => void
}

function sameDirectory(left: string, right: string): boolean {
  const normalizedLeft = resolve(left)
  const normalizedRight = resolve(right)
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

export async function validateSessionCwd(requestedCwd: string, allowedCwd: string): Promise<string> {
  let canonicalRequested: string
  let canonicalAllowed: string
  try {
    [canonicalRequested, canonicalAllowed] = await Promise.all([realpath(requestedCwd), realpath(allowedCwd)])
    if (!(await stat(canonicalRequested)).isDirectory()) throw new Error('not a directory')
  } catch {
    throw RequestError.invalidParams(undefined, 'The session working directory must be an existing directory.')
  }
  if (!sameDirectory(canonicalRequested, canonicalAllowed)) {
    throw RequestError.invalidParams(undefined, 'The session working directory must match the directory used to start Microcode.')
  }
  return canonicalRequested
}

function safeToolName(toolName: string): string {
  return toolName.replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 80) || 'tool'
}

function toolTitle(toolName: string): string {
  const name = toolName.toLowerCase()
  if (/bash|shell|command/.test(name)) return 'Run a shell command'
  if (/write|edit|patch/.test(name)) return 'Change a project file'
  if (/delete|remove/.test(name)) return 'Delete a project file'
  if (/read|glob|grep|search/.test(name)) return 'Read or search project files'
  if (/fetch|web/.test(name)) return 'Access web content'
  return `Run ${safeToolName(toolName)}`
}

function toolKind(toolName: string): 'read' | 'edit' | 'delete' | 'search' | 'execute' | 'fetch' | 'other' {
  const name = toolName.toLowerCase()
  if (/bash|shell|command/.test(name)) return 'execute'
  if (/delete|remove/.test(name)) return 'delete'
  if (/write|edit|patch/.test(name)) return 'edit'
  if (/read/.test(name)) return 'read'
  if (/glob|grep|search/.test(name)) return 'search'
  if (/fetch|web/.test(name)) return 'fetch'
  return 'other'
}

function matchingPermission(session: AcpRuntimeSession, toolName: string, input: Record<string, unknown>): PendingPermission | undefined {
  const serializedInput = JSON.stringify(input)
  for (const [requestId, pending] of session.pendingPermissions) {
    if (pending.toolName === toolName && JSON.stringify(pending.input) === serializedInput) {
      session.pendingPermissions.delete(requestId)
      return pending
    }
  }
  return undefined
}

function notifyUpdate(session: AcpRuntimeSession, update: SessionUpdate): Promise<void> {
  return session.client.notify(methods.client.session.update, {
    sessionId: session.id,
    update,
  })
}

function assistantText(message: RuntimeMessage | undefined): string {
  if (!message || message.role !== 'assistant') return ''
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.type === 'text' ? block.text : '')
    .join('')
}

async function requestPermission(session: AcpRuntimeSession, request: Record<string, unknown>): Promise<void> {
  const requestId = request.request_id
  const toolName = request.tool_id
  if (typeof requestId !== 'string' || typeof toolName !== 'string') return

  if (request.kind === 'question') {
    await session.runtime.sendCommand('question.resolve', {
      request_id: requestId,
      block: true,
    }).catch(() => undefined)
    return
  }

  const title = toolTitle(toolName)
  const pending: PendingPermission = {
    requestId,
    toolName,
    input: request.input && typeof request.input === 'object' && !Array.isArray(request.input)
      ? request.input as Record<string, unknown>
      : {},
    toolCallId: requestId,
    title,
  }
  session.pendingPermissions.set(requestId, pending)
  let allowed = false
  try {
    const response = await session.client.request(methods.client.session.requestPermission, {
      sessionId: session.id,
      toolCall: {
        toolCallId: pending.toolCallId,
        title,
        name: safeToolName(toolName),
        kind: toolKind(toolName),
        status: 'pending',
      },
      options: [
        { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'reject_once', name: 'Reject', kind: 'reject_once' },
      ],
    }, {
      cancellationSignal: AbortSignal.any([
        session.closeController.signal,
        AbortSignal.timeout(4 * 60 * 1000),
      ]),
      stopWaitingOnCancel: true,
    })
    allowed = response.outcome.outcome === 'selected' && response.outcome.optionId === 'allow_once'
  } catch {
    allowed = false
  }

  if (!allowed) session.pendingPermissions.delete(requestId)
  await session.runtime.sendCommand('permission.resolve', {
    request_id: requestId,
    allowed,
  }).catch(() => undefined)
}

export async function handleRuntimeEvent(session: AcpRuntimeSession, event: RuntimeEventEnvelope): Promise<void> {
  if (session.closed) return
  const payload = event.payload
  if (event.type === 'message_update') {
    const assistantEvent = payload.assistant_event as Record<string, unknown> | undefined
    if (assistantEvent?.type === 'text_delta' && typeof assistantEvent.delta === 'string' && session.activeTurn) {
      session.activeTurn.text += assistantEvent.delta
      await notifyUpdate(session, {
        sessionUpdate: 'agent_message_chunk',
        messageId: session.activeTurn.messageId,
        content: { type: 'text', text: assistantEvent.delta },
      })
    }
    return
  }

  if (event.type === 'tool_execution_start') {
    const toolName = typeof payload.tool_id === 'string' ? payload.tool_id : 'tool'
    const toolCallId = typeof payload.tool_call_id === 'string' ? payload.tool_call_id : randomUUID()
    const input = payload.arguments && typeof payload.arguments === 'object' && !Array.isArray(payload.arguments)
      ? payload.arguments as Record<string, unknown>
      : {}
    const pending = matchingPermission(session, toolName, input)
    const publicToolCallId = pending?.toolCallId ?? toolCallId
    session.toolCallIds.set(toolCallId, publicToolCallId)
    if (pending) {
      await notifyUpdate(session, {
        sessionUpdate: 'tool_call_update',
        toolCallId: publicToolCallId,
        status: 'in_progress',
        title: pending.title,
      })
    } else {
      await notifyUpdate(session, {
        sessionUpdate: 'tool_call',
        toolCallId: publicToolCallId,
        title: toolTitle(toolName),
        name: safeToolName(toolName),
        kind: toolKind(toolName),
        status: 'in_progress',
      })
    }
    return
  }

  if (event.type === 'tool_execution_update') {
    const internalId = typeof payload.tool_call_id === 'string' ? payload.tool_call_id : ''
    const toolCallId = session.toolCallIds.get(internalId) ?? internalId
    if (toolCallId) {
      await notifyUpdate(session, {
        sessionUpdate: 'tool_call_update',
        toolCallId,
        status: 'in_progress',
      })
    }
    return
  }

  if (event.type === 'tool_execution_end') {
    const internalId = typeof payload.tool_call_id === 'string' ? payload.tool_call_id : ''
    const toolCallId = session.toolCallIds.get(internalId) ?? internalId
    if (internalId) session.toolCallIds.delete(internalId)
    if (toolCallId) {
      await notifyUpdate(session, {
        sessionUpdate: 'tool_call_update',
        toolCallId,
        status: payload.is_error === true ? 'failed' : 'completed',
      })
    }
    return
  }

  if (event.type === 'permission_requested') {
    const request = payload.request as Record<string, unknown> | undefined
    if (request) await requestPermission(session, request)
    return
  }

  if (event.type === 'runtime_error') {
    session.activeTurn?.reject(new RequestError(-32603, 'The Agent turn failed.'))
    return
  }

  if (event.type === 'turn_end') {
    const message = payload.message as RuntimeMessage | undefined
    if (!session.activeTurn || message?.role !== 'assistant' || message.stop_reason === 'toolUse') return
    if (message.stop_reason === 'error') {
      session.activeTurn.reject(new RequestError(-32603, 'The Agent turn failed.'))
      return
    }
    if (!session.activeTurn.text) {
      const text = assistantText(message)
      if (text) {
        session.activeTurn.text = text
        await notifyUpdate(session, {
          sessionUpdate: 'agent_message_chunk',
          messageId: session.activeTurn.messageId,
          content: { type: 'text', text },
        })
      }
    }
    const stopReason = session.activeTurn.cancelled || message.stop_reason === 'aborted'
      ? 'cancelled'
      : message.stop_reason === 'length'
        ? 'max_tokens'
        : 'end_turn'
    session.activeTurn.resolve(stopReason)
  }
}

export async function createAcpRuntimeSession(options: {
  cwd: string
  client: AgentContext
  modelId?: string
  permissionMode?: 'interactive' | 'auto-approve' | 'plan'
}): Promise<AcpRuntimeSession> {
  const token = randomUUID() + randomUUID()
  let service: Awaited<ReturnType<typeof createConfiguredRuntimeAgentService>>
  try {
    service = await createConfiguredRuntimeAgentService({
      cwd: options.cwd,
      token,
      port: 0,
      ...(options.modelId ? { modelId: options.modelId } : {}),
      ...(options.permissionMode ? { permissionMode: options.permissionMode } : {}),
    })
  } catch {
    console.error('[acp] Runtime session startup failed.')
    throw RequestError.internalError(undefined, 'The Agent runtime could not be started.')
  }
  const runtime = new RuntimeClientSession(
    new RuntimeServiceClient(`http://${service.server.hostname}:${service.server.port}`, token),
    service.session.sessionId,
  )
  const session: AcpRuntimeSession = {
    id: randomUUID(),
    cwd: options.cwd,
    client: options.client,
    service,
    runtime,
    closeController: new AbortController(),
    pendingPermissions: new Map(),
    toolCallIds: new Map(),
    eventTail: Promise.resolve(),
    closed: false,
  }
  session.unsubscribe = runtime.subscribe({
    onEvent: (event) => {
      session.eventTail = session.eventTail
        .then(() => handleRuntimeEvent(session, event))
        .catch(() => undefined)
    },
  })
  try {
    await runtime.start()
    return session
  } catch {
    await closeAcpRuntimeSession(session)
    throw RequestError.internalError(undefined, 'The Agent runtime could not be started.')
  }
}

export function assertSessionIsActive(session: AcpRuntimeSession): void {
  if (session.closed) throw RequestError.sessionNotFound(session.id)
}

export async function promptAcpSession(
  session: AcpRuntimeSession,
  request: PromptRequest,
  signal: AbortSignal,
  clientRequestId: JsonRpcId = null,
): Promise<'end_turn' | 'max_tokens' | 'cancelled'> {
  assertSessionIsActive(session)
  if (signal.aborted) return 'cancelled'
  if (session.activeTurn) throw RequestError.invalidRequest(undefined, 'This session already has an active prompt.')

  const text = request.prompt.map((block) => {
    if (block.type === 'text') return block.text
    if (block.type === 'resource_link') {
      const title = block.title ?? block.name
      return `[Resource link: ${title}] ${block.uri}`
    }
    throw RequestError.invalidParams(undefined, `Unsupported prompt content type: ${block.type}.`)
  }).join('\n')
  const activeTurn: ActiveTurn = {
    clientRequestId,
    runtimeRequestId: randomUUID(),
    messageId: randomUUID(),
    text: '',
    cancelled: false,
    started: false,
    resolve: () => undefined,
    reject: () => undefined,
    result: Promise.resolve<'end_turn' | 'max_tokens' | 'cancelled'>('end_turn'),
  }
  activeTurn.result = new Promise((resolve, reject) => {
    activeTurn.resolve = resolve
    activeTurn.reject = reject
  })
  session.activeTurn = activeTurn
  const cancel = () => {
    activeTurn.cancelled = true
    if (activeTurn.started) void session.runtime.sendCommand('abort').catch(() => undefined)
    else activeTurn.resolve('cancelled')
  }
  signal.addEventListener('abort', cancel, { once: true })
  if (signal.aborted) cancel()

  try {
    if (activeTurn.cancelled) return await activeTurn.result
    await notifyUpdate(session, {
      sessionUpdate: 'user_message_chunk',
      messageId: randomUUID(),
      content: { type: 'text', text },
    })
    if (activeTurn.cancelled) return await activeTurn.result
    await session.runtime.sendCommand('prompt', { text }, activeTurn.runtimeRequestId)
    activeTurn.started = true
    if (activeTurn.cancelled) await session.runtime.sendCommand('abort').catch(() => undefined)
    return await activeTurn.result
  } catch (error) {
    if (error instanceof RequestError) throw error
    throw RequestError.internalError(undefined, 'The Agent turn failed.')
  } finally {
    signal.removeEventListener('abort', cancel)
    if (session.activeTurn === activeTurn) session.activeTurn = undefined
  }
}

export async function cancelAcpSession(session: AcpRuntimeSession): Promise<void> {
  if (!session.activeTurn) return
  session.activeTurn.cancelled = true
  if (session.activeTurn.started) await session.runtime.sendCommand('abort').catch(() => undefined)
  else session.activeTurn.resolve('cancelled')
}

export async function closeAcpRuntimeSession(session: AcpRuntimeSession): Promise<void> {
  if (session.closed) return
  session.closed = true
  session.closeController.abort(new Error('ACP session closed.'))
  if (session.activeTurn) {
    session.activeTurn.cancelled = true
    session.activeTurn.resolve('cancelled')
    session.activeTurn = undefined
  }
  session.unsubscribe?.()
  await session.runtime.close()
  await session.service.close()
  session.pendingPermissions.clear()
  session.toolCallIds.clear()
}
