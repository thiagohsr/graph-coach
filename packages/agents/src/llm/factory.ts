import { fileURLToPath } from 'node:url';
import { assertValidConfig, type EmbeddingsConfig, type LlmConfig } from './config';
import { createOllamaChatProvider, createOllamaEmbeddingsProvider } from './ollama';
import { createOpenAiChatProvider, createOpenAiEmbeddingsProvider } from './openai-compatible';
import { StubChatProvider, StubEmbeddingsProvider } from './stub';
import type { ChatProvider, EmbeddingsProvider } from './types';
import type { UsageTracer } from './usage-tracer';

export function createChatProvider(config: LlmConfig, options: { tracer?: UsageTracer } = {}): ChatProvider {
  assertValidConfig(config, 'LLM');
  switch (config.provider) {
    case 'stub':
      if (config.baseUrl?.startsWith('file:')) {
        return StubChatProvider.fromRecordings(fileURLToPath(config.baseUrl), options);
      }
      return new StubChatProvider({
        ...options,
        noResponseMessage: 'LLM provider is "stub"; set LLM_PROVIDER to use this feature',
      });
    case 'openai':
      return createOpenAiChatProvider(config, options);
    case 'ollama':
      return createOllamaChatProvider(config, options);
  }
}

export function createEmbeddingsProvider(
  config: EmbeddingsConfig,
  options: { tracer?: UsageTracer } = {},
): EmbeddingsProvider {
  assertValidConfig(config, 'EMBEDDING');
  switch (config.provider) {
    case 'stub':
      return new StubEmbeddingsProvider(config.dimension, options);
    case 'openai':
      return createOpenAiEmbeddingsProvider(config, options);
    case 'ollama':
      return createOllamaEmbeddingsProvider(config, options);
  }
}
