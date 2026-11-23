import { describe, expect, test } from 'bun:test'
import type { AssistantMessage, Models } from '@earendil-works/pi-ai'
import { getAllModels } from '../../src/models/index.ts'
import { createPiCompactionSummarizer } from '../../src/kernel/pi/compaction.ts'

function summaryMessage(text: string, model: ReturnType<typeof getAllModels>[number], stopReason: 'stop' | 'error' = 'stop'): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 10,
      output: 3,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 13,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    ...(stopReason === 'error' ? { errorMessage: 'summary provider failed' } : {}),
    timestamp: 1,
  }
}

describe('Pi 1.6 compaction summarizer adapter', () => {
  test('uses completeSimple with the selected model and bounded summary context', async () => {
    const model = getAllModels().find((entry) => entry.provider === 'openai-codex' && entry.id === 'gpt-6.2-sol')!
    let request: { model?: unknown; context?: unknown; options?: unknown } = {}
    const models = {
      async completeSimple(selectedModel: unknown, context: unknown, options: unknown) {
        request = { model: selectedModel, context, options }
        return summaryMessage('Earlier work summary.', model)
      },
    } as unknown as Models
    const summarize = createPiCompactionSummarizer({ models, getModel: () => model })
    const result = await summarize([
      { role: 'user', content: 'Inspect the repository.', timestamp: 1 },
      {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'call-1', name: 'grep', arguments: { pattern: 'adapter' } }],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: summaryMessage('', model).usage,
        stopReason: 'toolUse',
        timestamp: 2,
      },
      { role: 'toolResult', toolCallId: 'call-1', toolName: 'grep', content: [{ type: 'text', text: 'Found adapter source.' }], isError: false, timestamp: 3 },
    ], { reserveTokens: 1024, instructions: 'Keep exact file paths.' })

    expect(result).toEqual({ ok: true, value: 'Earlier work summary.' })
    expect(request.model).toBe(model)
    expect(request.options).toEqual({ maxTokens: 1024 })
    expect(request.context).toMatchObject({ systemPrompt: expect.stringContaining('Keep exact file paths.') })
    expect(JSON.stringify(request.context)).toContain('grep')
    expect(JSON.stringify(request.context)).toContain('Found adapter source.')
  })

  test('returns Pi completion failures through the runtime summary contract', async () => {
    const model = getAllModels().find((entry) => entry.provider === 'deepseek' && entry.id === 'deepseek-v4-pro')!
    const models = {
      async completeSimple() { return summaryMessage('', model, 'error') },
    } as unknown as Models
    const summarize = createPiCompactionSummarizer({ models, getModel: () => model })
    const result = await summarize([{ role: 'user', content: 'Input', timestamp: 1 }], { reserveTokens: 512 })

    expect(result).toEqual({ ok: false, error: { message: 'summary provider failed' } })
  })
})
