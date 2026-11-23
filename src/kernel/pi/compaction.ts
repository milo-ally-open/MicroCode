import type { Api, Context, Model, Models } from '@earendil-works/pi-ai'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import {
  restoreLegacyCompactionContext,
  type CompactionSummaryGenerator,
} from '../../session/CompactionManager.ts'
import type { CompactionMessageAdapter } from '../../session/contracts.ts'
import { estimateMessagesTokens } from '../../session/TokenEstimator.ts'
import { getCompactUserSummaryMessage } from '../../session/compactPrompt.ts'

function getPiToolCalls(message: AgentMessage) {
  if (message.role !== 'assistant') return []
  return message.content
    .filter((block) => block.type === 'toolCall')
    .map((block) => ({
      id: block.id,
      name: block.name,
      arguments: block.arguments,
    }))
}

function getPiToolResult(message: AgentMessage) {
  return message.role === 'toolResult'
    ? { callId: message.toolCallId, toolName: message.toolName }
    : undefined
}

export const piCompactionMessageAdapter: CompactionMessageAdapter<AgentMessage> = {
  getToolCalls: getPiToolCalls,
  getToolResult: getPiToolResult,
  getTimestamp(message) {
    return 'timestamp' in message && typeof message.timestamp === 'number'
      ? message.timestamp
      : undefined
  },
  estimateTokens(messages) {
    return estimateMessagesTokens(messages)
  },
  formatMalformedUnit(messages) {
    return messages.map((message) => {
      const result = getPiToolResult(message)
      if (result) {
        const content = message.role === 'toolResult'
          ? message.content
              .filter((block) => block.type === 'text')
              .map((block) => block.text)
              .join('\n')
          : ''
        return `Tool result ${result.toolName} (${result.callId}): ${content}`
      }
      const calls = getPiToolCalls(message)
      if (calls.length > 0) {
        return `Assistant requested tools: ${calls
          .map((call) => `${call.name}(${JSON.stringify(call.arguments)})`)
          .join(', ')}`
      }
      return `${message.role}: ${JSON.stringify(message)}`
    }).join('\n')
  },
  createUserMessage(content, timestamp) {
    return { role: 'user', content, timestamp }
  },
  createSummaryMessage(summary, timestamp) {
    return {
      role: 'user',
      content: getCompactUserSummaryMessage(summary),
      timestamp,
    }
  },
  replaceToolResultContent(message, content) {
    if (message.role !== 'toolResult') return message
    return {
      ...message,
      content: [{ type: 'text', text: content }],
    }
  },
}

/** Pi-backed session compatibility bridge for legacy compaction entries. */
export function restoreLegacyPiCompactionContext(
  messages: readonly AgentMessage[],
  contextWindow: number,
  tokensBefore: number,
  summary: string,
  timestamp: number,
): AgentMessage[] {
  return restoreLegacyCompactionContext(
    messages,
    contextWindow,
    tokensBefore,
    summary,
    timestamp,
    piCompactionMessageAdapter,
  )
}

/** Keeps Pi's summary API behind the kernel adapter and exposes the runtime summarizer contract. */
export function createPiCompactionSummarizer(options: {
  models: Models
  getModel: () => Model<Api>
}): CompactionSummaryGenerator<AgentMessage> {
  return async (messages, summaryOptions) => {
    const model = options.getModel()
    const transcript = messages.map((message) => {
      const role = message.role === 'assistant' ? 'Assistant' : message.role === 'toolResult' ? `Tool (${message.toolName})` : 'User'
      const content = message.role === 'assistant'
        ? message.content.map((block) => block.type === 'text' ? block.text : block.type === 'toolCall'
          ? `[tool call ${block.name}: ${JSON.stringify(block.arguments)}]`
          : block.type === 'thinking' ? '' : '[image]').filter(Boolean).join('\n')
        : message.role === 'toolResult'
          ? message.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n')
          : typeof message.content === 'string' ? message.content
            : message.content.map((block) => block.type === 'text' ? block.text : '[image]').join('\n')
      return `${role}: ${content}`
    }).join('\n\n')
    const context: Context = {
      systemPrompt: [
        'Summarize the earlier conversation for an AI coding assistant continuing the work.',
        'Preserve user goals, decisions, constraints, important code facts, unresolved questions, and exact identifiers or paths that matter.',
        'Do not invent facts. Keep the summary concise and directly usable as context.',
        summaryOptions.instructions,
      ].filter(Boolean).join('\n\n'),
      messages: [{ role: 'user', content: transcript, timestamp: Date.now() }],
    }
    try {
      const result = await options.models.completeSimple(model, context, {
        maxTokens: Math.max(256, Math.min(model.maxTokens, summaryOptions.reserveTokens)),
      })
      if (result.stopReason === 'error' || result.stopReason === 'aborted') {
        return { ok: false, error: { message: result.errorMessage ?? `Summarization ${result.stopReason}.` } }
      }
      const text = result.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n').trim()
      return text ? { ok: true, value: text } : { ok: false, error: { message: 'Summarization returned no text.' } }
    } catch (error) {
      return { ok: false, error: { message: error instanceof Error ? error.message : String(error) } }
    }
  }
}
