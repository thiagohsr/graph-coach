import { ChatOllama, OllamaEmbeddings } from '@langchain/ollama';
import type { EmbeddingsConfig, LlmConfig } from './config';
import { messageText } from './openai-compatible';
import {
  RemoteChatProvider,
  RemoteEmbeddingsProvider,
  withTimeout,
  type ChatTransport,
  type EmbedTransport,
  type Logger,
} from './remote';
import type { UsageTracer } from './usage-tracer';

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export function ollamaChatTransport(config: LlmConfig): ChatTransport {
  return {
    async invoke(req) {
      const model = new ChatOllama({
        model: config.model,
        ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
        temperature: req.temperature,
        ...(req.maxTokens !== undefined ? { numPredict: req.maxTokens } : {}),
        ...(req.json ? { format: 'json' } : {}),
      });
      // V20: ChatOllama maps prompt_eval_count / eval_count to usage_metadata.input_tokens / output_tokens.
      const msg = (await withTimeout(
        model.invoke(
          req.messages.map((m): [string, string] => [m.role, m.content]),
req.signal ? { signal: req.signal } : {}),
        req.timeoutMs,
        req.signal,
      )) as { content: unknown; usage_metadata?: { input_tokens?: number; output_tokens?: number } };
      return {
        text: messageText(msg.content),
        inputTokens: num(msg.usage_metadata?.input_tokens),
        outputTokens: num(msg.usage_metadata?.output_tokens),
      };
    },
  };
}

export function ollamaEmbedTransport(config: EmbeddingsConfig): EmbedTransport {
  const embeddings = new OllamaEmbeddings({
    model: config.model,
    ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
  });
  return {
    async embed(texts, req) {
      // The wrapper's embedDocuments drops the token count; the underlying client returns prompt_eval_count.
      const res = await withTimeout(embeddings.client.embed({ model: config.model, input: texts }), req.timeoutMs, req.signal);
      return { vectors: res.embeddings, tokens: num((res as { prompt_eval_count?: unknown }).prompt_eval_count) };
    },
  };
}

export function createOllamaChatProvider(
  config: LlmConfig,
  extras: { tracer?: UsageTracer | undefined; logger?: Logger | undefined; transport?: ChatTransport | undefined } = {},
): RemoteChatProvider {
  return new RemoteChatProvider('ollama', config.model, extras.transport ?? ollamaChatTransport(config), extras);
}

export function createOllamaEmbeddingsProvider(
  config: EmbeddingsConfig,
  extras: { tracer?: UsageTracer | undefined; logger?: Logger | undefined; transport?: EmbedTransport | undefined } = {},
): RemoteEmbeddingsProvider {
  return new RemoteEmbeddingsProvider(
    'ollama',
    config.model,
    config.dimension,
    extras.transport ?? ollamaEmbedTransport(config),
    extras,
  );
}
