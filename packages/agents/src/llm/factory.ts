import { fileURLToPath } from 'node:url';
import { assertValidConfig, type EmbeddingsConfig, type LlmConfig } from './config';
import { createOllamaChatProvider, createOllamaEmbeddingsProvider } from './ollama';
import { createOllamaHealthCheck, type FetchLike } from './ollama-health';
import { FallbackChatProvider, type FallbackLogger } from './fallback';
import {
  createOpenAiChatProvider,
  createOpenAiEmbeddingsProvider,
  createOpenRouterChatProvider,
  createOpenRouterEmbeddingsProvider,
} from './openai-compatible';
import { StubChatProvider, StubEmbeddingsProvider } from './stub';
import type { ChatProvider, EmbeddingsProvider } from './types';
import type { UsageTracer } from './usage-tracer';

export interface ChatFactoryOptions {
  tracer?: UsageTracer;
  /** "ollama-with-fallback" only. */
  logger?: FallbackLogger;
  /** Test hook for the Ollama health probe. */
  fetch?: FetchLike;
}

export function createChatProvider(
  config: LlmConfig,
  options: ChatFactoryOptions = {},
): ChatProvider {
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
    case 'ollama-with-fallback': {
      const primary = createOllamaChatProvider(config, options);
      const fallback = config.fallback
        ? createOpenRouterChatProvider(config.fallback, options)
        : undefined;
      const isUp = createOllamaHealthCheck({
        baseUrl: config.baseUrl ?? '',
        cfAccess: config.cfAccess,
        fetch: options.fetch,
      });
      return new FallbackChatProvider(primary, fallback, isUp, options.logger);
    }
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
    case 'openrouter':
      return createOpenRouterEmbeddingsProvider(config, options);
  }
}
