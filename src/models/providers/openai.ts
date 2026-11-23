import type { Provider } from '@earendil-works/pi-ai'
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai'
import type { ModelProviderAdapter } from './types.ts'

function openaiGptProvider(): Provider {
  const provider = openaiProvider()
  // Pi 1.6 adds OAuth to the general OpenAI provider. MicroCode keeps its
  // established API-key-only auth contract; Codex OAuth remains separate.
  const { oauth: _oauth, ...auth } = provider.auth
  return {
    ...provider,
    auth,
    getModels: () => provider.getModels().filter((model) =>
      model.id.startsWith('gpt-') && !model.id.startsWith('gpt-realtime-'),
    ),
  }
}

export const openAiGptModelProvider: ModelProviderAdapter = Object.freeze({
  id: 'openai',
  name: 'OpenAI GPT',
  version: 1,
  authModes: ['api_key'] as const,
  supportedApis: ['openai-responses'] as const,
  createPiProvider: openaiGptProvider,
})
