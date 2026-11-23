import { readRuntimeToken, removeRuntimeMetadata, runtimeMetadataForServer, runtimeStartingMetadata, writeRuntimeMetadata } from './config.ts'
import { RUNTIME_SERVICE_PROTOCOL_VERSION } from './types.ts'
import type { PermissionMode } from '../../permissions/index.ts'
import { isRuntimeThinkingLevel } from '../../runtime/contracts.ts'
import { createConfiguredRuntimeAgentService } from './composition.ts'

function envValue(name: string): string | undefined {
  const value = process.env[name]
  return value && value.length > 0 ? value : undefined
}

export async function runRuntimeDaemon(): Promise<void> {
  process.title = 'microcode-runtime'
  const key = envValue('MICROCODE_RUNTIME_KEY')
  const cwd = envValue('MICROCODE_RUNTIME_CWD')
  if (!key || !cwd) throw new Error('Runtime daemon startup configuration is incomplete.')
  const token = await readRuntimeToken(key)
  await writeRuntimeMetadata(key, runtimeStartingMetadata(cwd))
  const modelId = envValue('MICROCODE_RUNTIME_MODEL_ID')
  const rawThinkingLevel = envValue('MICROCODE_RUNTIME_THINKING_LEVEL')
  const thinkingLevel = rawThinkingLevel === undefined ? undefined : isRuntimeThinkingLevel(rawThinkingLevel) ? rawThinkingLevel : undefined
  const permissionMode = envValue('MICROCODE_RUNTIME_PERMISSION_MODE') as PermissionMode | undefined
  if (rawThinkingLevel !== undefined && !thinkingLevel) {
    throw new Error('Runtime daemon thinking level is invalid.')
  }
  if (permissionMode && !['interactive', 'auto-approve', 'plan'].includes(permissionMode)) {
    throw new Error('Runtime daemon permission mode is invalid.')
  }
  const portText = envValue('MICROCODE_RUNTIME_PORT') ?? '43128'
  const port = /^\d+$/.test(portText) ? Number(portText) : Number.NaN
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error('Runtime daemon port is invalid.')
  let stopping: Promise<void> | undefined
  let runtime: Awaited<ReturnType<typeof createConfiguredRuntimeAgentService>> | undefined
  const removeMetadata = () => removeRuntimeMetadata(key, process.pid)
  const stop = async () => {
    if (stopping) return stopping
    stopping = (async () => {
      await runtime?.close()
      await removeMetadata()
    })()
    return stopping
  }

  try {
    runtime = await createConfiguredRuntimeAgentService({
      cwd,
      token,
      port,
      ...(modelId ? { modelId } : {}),
      ...(thinkingLevel ? { thinkingLevel } : {}),
      ...(permissionMode ? { permissionMode } : {}),
      ...(envValue('MICROCODE_RUNTIME_RESUME_SESSION_ID')
        ? { resumeSessionId: envValue('MICROCODE_RUNTIME_RESUME_SESSION_ID') }
        : {}),
      ...(envValue('MICROCODE_RUNTIME_RESUME_LATEST') === '1' ? { resumeLatest: true } : {}),
      onSessionIdChanged: async (sessionId) => {
        if (!runtime) return
        await writeRuntimeMetadata(key, runtimeMetadataForServer(runtime.server, cwd, sessionId))
      },
    })
    const metadata = runtimeMetadataForServer(runtime.server, cwd, runtime.session.sessionId)
    if (metadata.protocolVersion !== RUNTIME_SERVICE_PROTOCOL_VERSION) throw new Error('Runtime daemon protocol version is inconsistent.')
    await writeRuntimeMetadata(key, metadata)
  } catch (error) {
    await runtime?.close().catch(() => undefined)
    await removeRuntimeMetadata(key, process.pid)
    throw error
  }

  process.once('SIGINT', () => { void stop() })
  process.once('SIGTERM', () => { void stop() })
  process.once('beforeExit', () => { void removeRuntimeMetadata(key, process.pid) })
}
