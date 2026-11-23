import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type {
  Api,
  ImageContent,
  Message,
  Model,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
} from '@earendil-works/pi-ai'
import type {
  RuntimeContentBlock,
  RuntimeImageInput,
  RuntimeMessage,
} from '../../runtime/contracts.ts'
import { toRuntimeModelDescriptor } from '../../runtime/modelProjection.ts'

export function toPiImageContent(image: RuntimeImageInput): ImageContent {
  return { type: 'image', data: image.data, mimeType: image.mimeType }
}

/** Map pi-agent-core transcript messages to the pinned pi-ai request shape. */
export function createPiModelMessageMapper(getModel: () => Model<Api>) {
  return (messages: AgentMessage[]): Message[] => {
    const model = getModel()
    const compat = model.compat as any
    const requiresReasoningContent =
      compat?.requiresReasoningContentOnAssistantMessages && model.reasoning

    return messages.flatMap((message) => {
      switch (message.role) {
        case 'system':
          // pi-agent-core stores the active system prompt and tool loadout
          // changes in system messages. Dropping them makes models appear
          // tool-less even though the tools are registered in Agent.state.
          return [message as Message]

        case 'user':
        case 'toolResult':
          return [message as Message]

        case 'assistant': {
          if (model.api === 'openai-completions') {
            const thinkingText = message.content
              .filter((content: any) => content.type === 'thinking')
              .map((content: any) => content.thinking)
              .join('\n')
            const filtered = message.content.filter((content: any) => content.type !== 'thinking')
            const result: any = { ...message, content: filtered }
            if (requiresReasoningContent) result.reasoning_content = thinkingText || ''
            return [result as Message]
          }
          return [message as Message]
        }

        default:
          return []
      }
    })
  }
}

function jsonValue(value: unknown): unknown {
  try {
    const serialized = JSON.stringify(value)
    return serialized === undefined ? undefined : JSON.parse(serialized) as unknown
  } catch {
    return undefined
  }
}

type PiContent = TextContent | ThinkingContent | ImageContent | ToolCall

function mapContent(content: PiContent): RuntimeContentBlock {
  switch (content.type) {
    case 'text':
      return { type: 'text', text: content.text }
    case 'thinking':
      return {
        type: 'thinking',
        text: '',
        redacted: true,
      }
    case 'image':
      return { type: 'image', data: content.data, mime_type: content.mimeType }
    case 'toolCall':
      return {
        type: 'tool_call',
        call_id: content.id,
        tool_id: content.name,
        arguments: jsonValue(content.arguments) as Record<string, unknown> ?? {},
        ...(content.namespace ? { namespace: content.namespace } : {}),
      }
    default: {
      const unreachable: never = content
      return unreachable
    }
  }
}

function mapResultContent(content: ToolResultMessage['content']): Extract<RuntimeMessage, { role: 'tool_result' }>['content'] {
  return content.map((block) => {
    if (block.type === 'image') return { type: 'image', data: block.data, mime_type: block.mimeType }
    return { type: 'text', text: block.text }
  }) as Extract<RuntimeMessage, { role: 'tool_result' }>['content']
}

function mapLegacyCustomContent(value: unknown): Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mime_type: string }> {
  if (!Array.isArray(value)) return [{ type: 'text', text: String(value ?? '') }]
  return value.map((block) => {
    if (!block || typeof block !== 'object') return { type: 'text', text: String(block ?? '') }
    const candidate = block as Record<string, unknown>
    if (candidate.type === 'image' && typeof candidate.data === 'string') {
      return { type: 'image', data: candidate.data, mime_type: String(candidate.mimeType ?? 'application/octet-stream') }
    }
    if (candidate.type === 'text' && typeof candidate.text === 'string') return { type: 'text', text: candidate.text }
    return { type: 'text', text: JSON.stringify(candidate) }
  })
}

export function toRuntimeMessage(message: AgentMessage): RuntimeMessage {
  const role = (message as { role: string }).role
  const extended = message as AgentMessage & {
    microcodeKind?: string
    microcodeLegacyMessage?: Record<string, unknown>
  }
  const legacy = extended.microcodeLegacyMessage ?? (
    ['system', 'user', 'assistant', 'toolResult'].includes(role)
      ? undefined
      : message as unknown as Record<string, unknown>
  )
  if (legacy) {
    if (legacy.role === 'bashExecution') {
      return {
        role: 'command_activity',
        command: String(legacy.command ?? ''),
        output: String(legacy.output ?? ''),
        exit_code: typeof legacy.exitCode === 'number' ? legacy.exitCode : null,
        cancelled: Boolean(legacy.cancelled),
        truncated: Boolean(legacy.truncated),
        ...(typeof legacy.fullOutputPath === 'string' ? { full_output_path: legacy.fullOutputPath } : {}),
        timestamp: message.timestamp,
      }
    }
    if (legacy.role === 'compactionSummary' || legacy.role === 'branchSummary') {
      return {
        role: 'summary',
        kind: legacy.role === 'compactionSummary' ? 'compaction' : 'branch',
        summary: String(legacy.summary ?? ''),
        ...(typeof legacy.fromId === 'string' ? { from_id: legacy.fromId } : {}),
        ...(typeof legacy.tokensBefore === 'number' ? { tokens_before: legacy.tokensBefore } : {}),
        timestamp: message.timestamp,
      }
    }
    if (legacy.role === 'custom') {
      return {
        role: 'custom',
        kind: String(legacy.customType ?? 'custom'),
        content: typeof legacy.content === 'string'
          ? legacy.content
          : mapLegacyCustomContent(legacy.content),
        display: legacy.display !== false,
        timestamp: message.timestamp,
      }
    }
  }
  if (extended.microcodeKind === 'task-reminder') {
    return { role: 'custom', kind: 'task-reminder', content: String(message.content), display: false, timestamp: message.timestamp }
  }
  switch (message.role) {
    case 'system':
      return {
        role: 'system',
        // The runtime DTO is a frontend projection; system instructions remain kernel-owned.
        content: '[system instructions]',
        timestamp: message.timestamp,
      }
    case 'user':
      return {
        role: 'user',
        content: typeof message.content === 'string'
          ? message.content
          : message.content.map(mapContent),
        timestamp: message.timestamp,
      }
    case 'assistant':
      return {
        role: 'assistant',
        content: message.content.map(mapContent),
        model: {
          provider_id: String(message.provider),
          model_id: message.model,
          api_id: message.api,
        },
        usage: {
          input_tokens: message.usage.input,
          output_tokens: message.usage.output,
          total_tokens: message.usage.totalTokens,
          cost: message.usage.cost.total,
        },
        stop_reason: message.stopReason,
        ...(message.errorMessage ? { error_message: message.errorMessage } : {}),
        timestamp: message.timestamp,
      }
    case 'toolResult':
      return {
        role: 'tool_result',
        call_id: message.toolCallId,
        tool_id: message.toolName,
        content: mapResultContent(message.content),
        ...(message.details === undefined ? {} : { details: jsonValue(message.details) }),
        is_error: message.isError,
        timestamp: message.timestamp,
      }
    default: {
      const unreachable: never = message
      return unreachable
    }
  }
}

export const toRuntimeModel = toRuntimeModelDescriptor
