import { createRuntimeAgentService } from './agentSession.ts'
import type { RuntimeThinkingLevel } from '../../runtime/contracts.ts'
import type { PermissionMode } from '../../permissions/index.ts'
import { PluginManager } from '../../plugins/PluginManager.ts'
import { McpClientManager } from '../../mcp/client.ts'
import { discoverMcpCapabilities } from '../../mcp/capabilities.ts'
import { loadProjectInstructions } from '../../instructions/projectInstructions.ts'
import { createGitWorkTreeTool } from '../../tools/index.ts'
import { GitWorkTreeSystem } from '../../git/index.ts'
import { getModelConfigDiagnostics } from '../../models/index.ts'

declare const MACRO: { VERSION: string }

export interface RuntimeAgentServiceOptions {
  cwd: string
  token: string
  port?: number
  modelId?: string
  thinkingLevel?: RuntimeThinkingLevel
  permissionMode?: PermissionMode
  resumeSessionId?: string
  resumeLatest?: boolean
  onSessionIdChanged?: (sessionId: string) => void | Promise<void>
}

/** Creates the same configured Agent owner for the daemon and embedded ACP sessions. */
export async function createConfiguredRuntimeAgentService(options: RuntimeAgentServiceOptions) {
  const { cwd } = options
  const pluginManager = await PluginManager.create(cwd, MACRO.VERSION)
  const pluginSnapshot = pluginManager.getSnapshot()
  const projectInstructions = await loadProjectInstructions(cwd)
  const mcpClient = new McpClientManager()
  const standaloneMcp = await discoverMcpCapabilities(cwd)
  const combinedMcpConfigs = { ...standaloneMcp.configs }
  const capabilityDiagnostics = [
    ...getModelConfigDiagnostics(cwd),
    ...standaloneMcp.diagnostics,
    ...pluginSnapshot.diagnostics,
  ]
  capabilityDiagnostics.push(...pluginSnapshot.plugins.flatMap((plugin) =>
    plugin.diagnostics.map((diagnostic) => `${plugin.name}: ${diagnostic}`),
  ))

  for (const [name, config] of Object.entries(pluginSnapshot.mcpServers)) {
    if (Object.hasOwn(combinedMcpConfigs, name)) {
      capabilityDiagnostics.push(`Plugin MCP server "${name}" conflicts with a configured MCP server; plugin server skipped.`)
      continue
    }
    combinedMcpConfigs[name] = config
  }

  const mcpConnections = mcpClient.connectAll(combinedMcpConfigs)
  let runtime: Awaited<ReturnType<typeof createRuntimeAgentService>> | undefined
  try {
    runtime = await createRuntimeAgentService({
      token: options.token,
      hostname: '127.0.0.1',
      port: options.port,
      session: {
        cwd,
        ...(options.resumeSessionId ? { resumeSessionId: options.resumeSessionId } : {}),
        ...(options.resumeLatest ? { resumeLatest: true } : {}),
        agentOptions: {
          ...(options.modelId ? { modelId: options.modelId } : {}),
          ...(options.thinkingLevel ? { thinkingLevel: options.thinkingLevel } : {}),
          projectInstructions,
          pluginSkills: [...pluginSnapshot.skills],
          pluginDiagnostics: [
            ...pluginSnapshot.diagnostics,
            ...pluginSnapshot.plugins.flatMap((plugin) =>
              plugin.diagnostics.map((diagnostic) => `${plugin.name}: ${diagnostic}`),
            ),
          ],
          mcpServers: mcpClient.getServerStates(),
        },
        ...(options.permissionMode ? { permission: { mode: options.permissionMode } } : {}),
        mcpClient,
        pluginManager,
        standaloneMcpConfigs: standaloneMcp.configs,
        standaloneMcpServers: standaloneMcp.servers,
        standaloneMcpDiagnostics: standaloneMcp.diagnostics,
        plugins: pluginSnapshot.plugins,
        capabilityDiagnostics,
        onSessionIdChanged: options.onSessionIdChanged,
      },
      onShutdown: () => mcpClient.disconnectAll(),
    })
    runtime.session.agent.addTools([createGitWorkTreeTool(() => GitWorkTreeSystem.open(cwd))], { enabled: false })
    void mcpConnections.then(() => runtime?.session.updateMcpServers())
    return runtime
  } catch (error) {
    await mcpClient.disconnectAll().catch(() => undefined)
    await runtime?.close().catch(() => undefined)
    throw error
  }
}
