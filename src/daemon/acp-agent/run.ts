import { Readable, Writable } from 'node:stream'
import { realpath } from 'node:fs/promises'
import { agent, methods, ndJsonStream, RequestError } from '@agentclientprotocol/sdk'
import type { AcpRuntimeSession } from './runtimeSession.ts'
import { cancelAcpSession, closeAcpRuntimeSession, createAcpRuntimeSession, promptAcpSession, validateSessionCwd } from './runtimeSession.ts'
import { PERMISSION_MODES, type PermissionMode } from '../../permissions/index.ts'

declare const MACRO: { VERSION: string }

const ACP_HELP = `MicroCode ACP Agent
ACP stable v1 Agent over stdio.

USAGE
  microcode acp [OPTIONS]

OPTIONS
  --model <PROVIDER/ID>   Select the model for ACP sessions
  --permission <MODE>     Set approvals: interactive, auto-approve, or plan
  -h, --help              Show this help

The ACP client starts MicroCode as a subprocess. Standard input and output are
reserved for ACP JSON-RPC messages. Diagnostic output is written to standard error.`

interface AcpOptions {
  modelId?: string
  permissionMode?: PermissionMode
}

function parseAcpOptions(args: string[]): AcpOptions | undefined {
  const options: AcpOptions = {}
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!
    if (argument === '--model') {
      const modelId = args[index + 1]
      if (!modelId || modelId.startsWith('-')) {
        console.error('microcode acp: missing model ID after --model')
        return undefined
      }
      options.modelId = modelId
      index += 1
      continue
    }
    if (argument === '--permission' || argument === '--permission-mode') {
      const mode = args[index + 1]
      if (!mode || !PERMISSION_MODES.includes(mode as PermissionMode)) {
        console.error('microcode acp: --permission must be interactive, auto-approve, or plan')
        return undefined
      }
      options.permissionMode = mode as PermissionMode
      index += 1
      continue
    }
    if (argument.startsWith('--model=') && argument.length > '--model='.length) {
      options.modelId = argument.slice('--model='.length)
      continue
    }
    if ((argument.startsWith('--permission=') || argument.startsWith('--permission-mode='))
      && argument.includes('=')) {
      const mode = argument.slice(argument.indexOf('=') + 1)
      if (!PERMISSION_MODES.includes(mode as PermissionMode)) {
        console.error('microcode acp: --permission must be interactive, auto-approve, or plan')
        return undefined
      }
      options.permissionMode = mode as PermissionMode
      continue
    }
    console.error(`microcode acp: unknown option ${argument}`)
    return undefined
  }
  return options
}

function sessionFor(sessions: Map<string, AcpRuntimeSession>, sessionId: string): AcpRuntimeSession {
  const session = sessions.get(sessionId)
  if (!session || session.closed) throw RequestError.sessionNotFound(sessionId)
  return session
}

export async function runAcpAgent(args: string[] = process.argv.slice(3)): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(ACP_HELP)
    return
  }
  const options = parseAcpOptions(args)
  if (!options) {
    process.exitCode = 2
    return
  }

  process.title = 'microcode-acp'
  const allowedCwd = await realpath(process.cwd())
  const sessions = new Map<string, AcpRuntimeSession>()
  const app = agent({ name: 'MicroCode ACP Agent' })
    .onRequest(methods.agent.initialize, () => ({
      protocolVersion: 1,
      agentCapabilities: {
        promptCapabilities: {},
        sessionCapabilities: { close: {} },
      },
      authMethods: [],
      agentInfo: {
        name: 'microcode',
        title: 'MicroCode',
        version: MACRO.VERSION,
      },
    }))
    .onRequest(methods.agent.session.new, async ({ params, client }) => {
      if (params.additionalDirectories?.length) {
        throw RequestError.invalidParams(undefined, 'Additional session directories are not supported.')
      }
      if (params.systemPrompt != null) {
        throw RequestError.invalidParams(undefined, 'Client-provided system prompts are not supported.')
      }
      if (params.mcpServers.length) {
        throw RequestError.invalidParams(undefined, 'Configure MCP servers in MicroCode before starting the ACP Agent.')
      }
      const cwd = await validateSessionCwd(params.cwd, allowedCwd)
      const session = await createAcpRuntimeSession({
        cwd,
        client,
        ...(options.modelId ? { modelId: options.modelId } : {}),
        ...(options.permissionMode ? { permissionMode: options.permissionMode } : {}),
      })
      sessions.set(session.id, session)
      return { sessionId: session.id }
    })
    .onRequest(methods.agent.session.prompt, async ({ params, signal, requestId }) => {
      const session = sessionFor(sessions, params.sessionId)
      return { stopReason: await promptAcpSession(session, params, signal, requestId) }
    })
    .onRequest(methods.agent.session.close, async ({ params }) => {
      const session = sessionFor(sessions, params.sessionId)
      sessions.delete(session.id)
      await closeAcpRuntimeSession(session)
    })
    .onNotification(methods.agent.session.cancel, ({ params }) => {
      const session = sessions.get(params.sessionId)
      if (session) void cancelAcpSession(session)
    })

  const connection = app.connect(ndJsonStream(
    Writable.toWeb(process.stdout),
    Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>,
  ))
  const requestShutdown = () => connection.close(new Error('ACP process is shutting down.'))
  process.once('SIGINT', requestShutdown)
  process.once('SIGTERM', requestShutdown)
  try {
    await connection.closed
  } finally {
    process.removeListener('SIGINT', requestShutdown)
    process.removeListener('SIGTERM', requestShutdown)
    await Promise.all([...sessions.values()].map((session) => closeAcpRuntimeSession(session)))
    sessions.clear()
  }
}
