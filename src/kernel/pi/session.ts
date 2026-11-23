import { appendFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { findModel } from '../../models/index.ts'
import type {
  SessionArchiveEntry,
  SessionStore,
  SessionTranscriptAdapter,
} from '../../session/contracts.ts'
import { getCompactUserSummaryMessage } from '../../session/compactPrompt.ts'
import { restoreLegacyPiCompactionContext } from './compaction.ts'

const COMPACTION_CHECKPOINT_TYPE = 'microcode.compaction-checkpoint'
const SESSION_VERSION = 3

export interface JsonlSessionMetadata {
  id: string
  cwd: string
  createdAt: number
  path: string
  modifiedAt?: number
}

interface SessionHeader {
  type: 'session'
  version: number
  id: string
  timestamp: string
  cwd: string
}

interface StoredEntry {
  type: string
  id?: string
  parentId?: string | null
  timestamp?: string | number
  message?: unknown
  summary?: string
  retainedTail?: unknown[]
  customType?: string
  data?: unknown
  [key: string]: unknown
}

interface CompactionCheckpoint<Message> {
  version: 1
  summary: string
  contextMessages: Message[]
  tokensBefore: number
  tokensAfter: number
  keptMessageCount: number
  compactedMessageCount: number
  automatic: boolean
  model: { provider: string; modelId: string; contextWindow: number }
}

function isCompactionCheckpoint<Message>(data: unknown): data is CompactionCheckpoint<Message> {
  if (!data || typeof data !== 'object') return false
  const checkpoint = data as Partial<CompactionCheckpoint<Message>>
  return checkpoint.version === 1 && typeof checkpoint.summary === 'string' &&
    Array.isArray(checkpoint.contextMessages) && typeof checkpoint.tokensBefore === 'number' &&
    typeof checkpoint.tokensAfter === 'number'
}

function isoTimestamp(value: number): string {
  return new Date(value).toISOString()
}

function parseTimestamp(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function safeSessionId(id: string): string {
  return encodeURIComponent(id).replace(/%/g, '_')
}

function parseHeader(line: string): SessionHeader | undefined {
  try {
    const value = JSON.parse(line) as Partial<SessionHeader>
    if (value.type !== 'session' || typeof value.id !== 'string' ||
      typeof value.cwd !== 'string' || typeof value.timestamp !== 'string' ||
      typeof value.version !== 'number') return undefined
    return value as SessionHeader
  } catch {
    return undefined
  }
}

function normalizeLegacyMessage(value: unknown): AgentMessage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const message = value as Record<string, unknown>
  if (['system', 'user', 'assistant', 'toolResult'].includes(String(message.role))) {
    return value as AgentMessage
  }

  const timestamp = parseTimestamp(message.timestamp, Date.now())
  let label: string
  let kind: string
  let content: string
  switch (message.role) {
    case 'bashExecution':
      kind = 'command_activity'
      label = 'Previous command activity'
      content = `Command: ${String(message.command ?? '')}\nOutput: ${String(message.output ?? '')}`
      break
    case 'compactionSummary':
      kind = 'compaction_summary'
      label = 'Previous conversation summary'
      content = String(message.summary ?? '')
      break
    case 'branchSummary':
      kind = 'branch_summary'
      label = 'Previous branch summary'
      content = String(message.summary ?? '')
      break
    case 'custom':
      kind = String(message.customType ?? 'custom')
      label = 'Previous context note'
      content = typeof message.content === 'string'
        ? message.content
        : JSON.stringify(message.content ?? '')
      break
    default:
      return undefined
  }
  return {
    role: 'user',
    content: `[${label}]\n${content}`,
    timestamp,
    microcodeKind: kind,
    microcodeLegacyMessage: message,
  } as unknown as AgentMessage
}

function entryTimestamp(entry: StoredEntry, fallback: number): number {
  return parseTimestamp(entry.timestamp, fallback)
}

/** MicroCode-owned JSONL persistence for Pi 1.6, preserving the historical v3 archive format. */
export class PiJsonlSessionStore implements SessionStore<AgentMessage, JsonlSessionMetadata> {
  private metadata: JsonlSessionMetadata | null = null
  private lastEntryId: string | null = null

  constructor(private readonly sessionsRoot = path.join(os.homedir(), '.microcode', 'sessions')) {}

  async create(cwd: string): Promise<JsonlSessionMetadata> {
    const createdAt = Date.now()
    const id = randomUUID()
    await mkdir(this.sessionsRoot, { recursive: true })
    const filePath = path.join(this.sessionsRoot, `${isoTimestamp(createdAt).replace(/[:.]/g, '-')}_${safeSessionId(id)}.jsonl`)
    const header: SessionHeader = { type: 'session', version: SESSION_VERSION, id, timestamp: isoTimestamp(createdAt), cwd }
    await writeFile(filePath, `${JSON.stringify(header)}\n`, { flag: 'wx' })
    this.metadata = { id, cwd, createdAt, path: filePath, modifiedAt: createdAt }
    this.lastEntryId = null
    return this.metadata
  }

  async open(metadata: JsonlSessionMetadata): Promise<void> {
    const contents = await readFile(metadata.path, 'utf8')
    const header = contents.split(/\r?\n/, 1)[0]
    if (!header || parseHeader(header)?.id !== metadata.id) throw new Error('Session file does not match its metadata.')
    this.metadata = { ...metadata, modifiedAt: (await stat(metadata.path)).mtimeMs }
    this.lastEntryId = contents.split(/\r?\n/).slice(1).filter(Boolean).map((line) => {
      try { return (JSON.parse(line) as StoredEntry).id ?? null } catch { return null }
    }).filter((id): id is string => typeof id === 'string').at(-1) ?? null
  }

  async list(cwd?: string): Promise<JsonlSessionMetadata[]> {
    const paths: string[] = []
    const visit = async (directory: string): Promise<void> => {
      let entries
      try { entries = await readdir(directory, { withFileTypes: true }) } catch { return }
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        const fullPath = path.join(directory, entry.name)
        if (entry.isDirectory()) await visit(fullPath)
        else if (entry.isFile() && entry.name.endsWith('.jsonl')) paths.push(fullPath)
      }
    }
    await visit(this.sessionsRoot)
    const sessions: JsonlSessionMetadata[] = []
    for (const filePath of paths) {
      try {
        const contents = await readFile(filePath, 'utf8')
        const firstLine = contents.split(/\r?\n/, 1)[0]
        if (!firstLine) continue
        const header = parseHeader(firstLine)
        if (!header || (cwd !== undefined && header.cwd !== cwd)) continue
        sessions.push({
          id: header.id,
          cwd: header.cwd,
          createdAt: parseTimestamp(header.timestamp, (await stat(filePath)).birthtimeMs),
          path: filePath,
          modifiedAt: (await stat(filePath)).mtimeMs,
        })
      } catch { /* Ignore incomplete or unreadable session files. */ }
    }
    return sessions.sort((a, b) => (b.modifiedAt ?? b.createdAt) - (a.modifiedAt ?? a.createdAt))
  }

  async appendMessage(message: AgentMessage): Promise<void> {
    await this.append({ type: 'message', message })
  }

  async appendCustomEntry(type: string, data: unknown): Promise<void> {
    await this.append({ type: 'custom', customType: type, data })
  }

  async loadEntries(): Promise<SessionArchiveEntry<AgentMessage>[]> {
    if (!this.metadata) return []
    const lines = (await readFile(this.metadata.path, 'utf8')).split(/\r?\n/).slice(1).filter(Boolean)
    const entries: SessionArchiveEntry<AgentMessage>[] = []
    for (const line of lines) {
      let entry: StoredEntry
      try { entry = JSON.parse(line) as StoredEntry } catch { continue }
      const timestamp = entryTimestamp(entry, this.metadata.createdAt)
      if (entry.type === 'message') {
        const message = normalizeLegacyMessage(entry.message)
        if (message) entries.push({ type: 'message', message, timestamp })
      } else if (entry.type === 'compaction' && typeof entry.summary === 'string' && Array.isArray(entry.retainedTail)) {
        entries.push({
          type: 'compaction',
          summary: entry.summary,
          retainedTail: entry.retainedTail.map(normalizeLegacyMessage).filter((message): message is AgentMessage => Boolean(message)),
          timestamp,
        })
      } else if (entry.type === 'branch_summary' && typeof entry.summary === 'string') {
        entries.push({ type: 'branch_summary', summary: entry.summary, timestamp })
      } else if (entry.type === 'custom' && typeof entry.customType === 'string') {
        entries.push({ type: 'custom', customType: entry.customType, ...(entry.data === undefined ? {} : { data: entry.data }), timestamp })
      }
    }
    return entries
  }

  async delete(metadata: JsonlSessionMetadata): Promise<void> {
    await rm(metadata.path, { force: true })
    if (this.metadata?.id === metadata.id) {
      this.metadata = null
      this.lastEntryId = null
    }
  }

  async close(): Promise<void> {
    this.metadata = null
    this.lastEntryId = null
  }

  private async append(entry: Record<string, unknown>): Promise<void> {
    if (!this.metadata) throw new Error('No active session.')
    const now = Date.now()
    const id = randomUUID()
    const persisted = {
      ...entry,
      id,
      parentId: this.lastEntryId,
      timestamp: isoTimestamp(now),
    }
    await appendFile(this.metadata.path, `${JSON.stringify(persisted)}\n`)
    this.lastEntryId = id
    this.metadata.modifiedAt = now
  }
}

export function replacePiImageBlocksForPersistence(message: AgentMessage): AgentMessage {
  if (message.role !== 'user' && message.role !== 'toolResult') return message
  if (typeof message.content === 'string') return message

  let changed = false
  const content = message.content.map((block) => {
    if (block.type !== 'image') return block
    changed = true
    return { type: 'text' as const, text: `[Image: ${block.mimeType ?? 'unknown'}]` }
  })
  return changed ? { ...message, content } : message
}

export const piSessionTranscriptAdapter: SessionTranscriptAdapter<AgentMessage> = {
  replaceImagesForPersistence: replacePiImageBlocksForPersistence,
  restoreLegacyCompactionContext(messages, legacyMessage, timestamp) {
    if (legacyMessage.role !== 'user' || typeof legacyMessage.content !== 'string') return undefined
    const match = legacyMessage.content.match(/^\[Earlier conversation summarized \((\d+) tokens before compaction\)\]:\n([\s\S]*)$/)
    if (!match) return undefined
    const priorAssistant = [...messages].reverse().find((message) => message.role === 'assistant')
    const model = priorAssistant?.role === 'assistant'
      ? findModel(priorAssistant.model, priorAssistant.api, String(priorAssistant.provider))
      : undefined
    return model
      ? restoreLegacyPiCompactionContext(messages, model.contextWindow, Number(match[1]), match[2] ?? '', timestamp)
      : undefined
  },
  createSummaryMessage(summary, timestamp, kind) {
    return {
      role: 'user',
      content: kind === 'compaction' ? getCompactUserSummaryMessage(summary) : `[Conversation summary]:\n${summary}`,
      timestamp,
    }
  },
}
