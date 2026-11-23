import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

setDefaultTimeout(60_000)

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const entryPath = join(projectRoot, 'src', 'entry.ts')
let child: ChildProcess | undefined
let tempRoot: string | undefined

afterEach(async () => {
  if (child && child.exitCode === null) child.kill()
  child = undefined
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
  tempRoot = undefined
})

function launchAcpAgent(cwd: string) {
  const home = join(tempRoot!, 'home')
  const childProcess = spawn(process.execPath, [entryPath, 'acp'], {
    cwd,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      APPDATA: join(home, 'AppData', 'Roaming'),
      LOCALAPPDATA: join(home, 'AppData', 'Local'),
      TERM: 'dumb',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let output = ''
  let stderr = ''
  let buffer = ''
  const messages: Record<string, unknown>[] = []
  const waiters: Array<(message: Record<string, unknown>) => void> = []
  childProcess.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8')
    buffer += chunk.toString('utf8')
    let newline = buffer.indexOf('\n')
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line) {
        let message: Record<string, unknown>
        try { message = JSON.parse(line) as Record<string, unknown> } catch { message = { invalidLine: line } }
        const waiter = waiters.shift()
        if (waiter) waiter(message)
        else messages.push(message)
      }
      newline = buffer.indexOf('\n')
    }
  })
  childProcess.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })

  return {
    process: childProcess,
    output: () => output,
    stderr: () => stderr,
    send(message: Record<string, unknown>) {
      childProcess.stdin!.write(`${JSON.stringify(message)}\n`)
    },
    nextMessage(): Promise<Record<string, unknown>> {
      const message = messages.shift()
      if (message) return Promise.resolve(message)
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`ACP response timed out. stderr: ${stderr}`)), 15_000)
        waiters.push((next) => { clearTimeout(timer); resolve(next) })
      })
    },
  }
}

function sendRequest(
  session: ReturnType<typeof launchAcpAgent>,
  id: number,
  method: string,
  params: Record<string, unknown>,
) {
  session.send({ jsonrpc: '2.0', id, method, params })
  return session.nextMessage()
}

async function jsonlFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const nested = await Promise.all(entries.filter((entry) => entry.isDirectory())
    .map((entry) => jsonlFiles(join(root, entry.name))))
  return [
    ...entries.filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl')).map((entry) => entry.name),
    ...nested.flat(),
  ]
}

describe('ACP Agent stdio v1 host', () => {
  test('negotiates v1, isolates sessions, rejects unsupported content, and preserves closed transcripts', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'microcode-acp-agent-'))
    const cwd = join(tempRoot, 'workspace')
    await mkdir(cwd, { recursive: true })
    const host = launchAcpAgent(cwd)
    child = host.process

    const initialized = await sendRequest(host, 1, 'initialize', {
      protocolVersion: 2,
      clientCapabilities: {},
      clientInfo: { name: 'microcode-test', version: '1.0.0' },
    })
    expect(initialized.result).toMatchObject({
      protocolVersion: 1,
      agentCapabilities: { promptCapabilities: {}, sessionCapabilities: { close: {} } },
      authMethods: [],
    })

    const first = await sendRequest(host, 2, 'session/new', { cwd, mcpServers: [] })
    const second = await sendRequest(host, 3, 'session/new', { cwd, mcpServers: [] })
    const firstSessionId = (first.result as { sessionId: string }).sessionId
    const secondSessionId = (second.result as { sessionId: string }).sessionId
    expect(typeof firstSessionId).toBe('string')
    expect(typeof secondSessionId).toBe('string')
    expect(secondSessionId).not.toBe(firstSessionId)

    const outsideCwd = await sendRequest(host, 4, 'session/new', {
      cwd: tempRoot,
      mcpServers: [],
    })
    expect(outsideCwd.error).toMatchObject({ code: -32602 })

    const unsupportedImage = await sendRequest(host, 5, 'session/prompt', {
      sessionId: firstSessionId,
      prompt: [{ type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' }],
    })
    expect(unsupportedImage.error).toMatchObject({ code: -32602 })

    const loadSession = await sendRequest(host, 6, 'session/load', {
      sessionId: firstSessionId,
      cwd,
      mcpServers: [],
    })
    expect(loadSession.error).toMatchObject({ code: -32601 })

    expect((await sendRequest(host, 7, 'session/close', { sessionId: firstSessionId })).error).toBeUndefined()
    expect((await sendRequest(host, 8, 'session/close', { sessionId: secondSessionId })).error).toBeUndefined()
    expect(await jsonlFiles(join(tempRoot, 'home', '.microcode', 'sessions'))).toHaveLength(2)

    host.process.stdin?.end()
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`ACP child did not exit. stderr: ${host.stderr()}`)), 10_000)
      host.process.once('exit', (code) => { clearTimeout(timer); resolve(code) })
    })
    child = undefined
    expect(exitCode).toBe(0)
    for (const line of host.output().trim().split(/\r?\n/)) {
      expect(JSON.parse(line)).toHaveProperty('jsonrpc', '2.0')
    }
  })
})
