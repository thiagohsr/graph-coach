import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import {
  OPENROUTER_BASE_URL,
  type EmbeddingsConfig,
  type LlmConfig,
  type OpenRouterConfig,
} from './config';
import { openRouterHeaders } from './headers';
import {
  RemoteChatProvider,
  RemoteEmbeddingsProvider,
  withTimeout,
  type ChatTransport,
  type EmbedTransport,
  type Logger,
} from './remote';
import type { UsageTracer } from './usage-tracer';

interface MessageLike {
  content: unknown;
  usage_metadata?: { input_tokens?: number; output_tokens?: number } | undefined;
  response_metadata?: Record<string, unknown> | undefined;
}

/** Flattens an AI message's content (a string, or blocks with a `text` field) to text. */
export function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : '',
      )
      .join('');
  }
  return '';
}

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/**
 * V20: `@langchain/openai` chat puts token counts in `usage_metadata.{input_tokens,output_tokens}` and, as a
 * fallback, in `response_metadata.tokenUsage.{promptTokens,completionTokens}`.
 */
export function openAiTokens(msg: MessageLike): {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
} {
  const meta = msg.usage_metadata;
  const legacy = (msg.response_metadata?.tokenUsage ?? {}) as Record<string, unknown>;
  return {
    inputTokens: num(meta?.input_tokens) ?? num(legacy.promptTokens),
    outputTokens: num(meta?.output_tokens) ?? num(legacy.completionTokens),
  };
}

/** `headers` are sent on every request (OpenRouter attribution). */
export function openAiChatTransport(
  config: LlmConfig,
  headers?: Record<string, string>,
): ChatTransport {
  return {
    async invoke(req) {
      const model = new ChatOpenAI({
        model: config.model,
        ...(config.apiKey ? { apiKey: config.apiKey } : {}),
        temperature: req.temperature,
        ...(req.maxTokens !== undefined ? { maxTokens: req.maxTokens } : {}),
        timeout: req.timeoutMs,
        maxRetries: 0,
        ...(config.baseUrl || headers
          ? {
              configuration: {
                ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
                ...(headers ? { defaultHeaders: headers } : {}),
              },
            }
          : {}),
        ...(req.json ? { modelKwargs: { response_format: { type: 'json_object' } } } : {}),
      });
      const pairs = req.messages.map((m): [string, string] => [m.role, m.content]);
      const messages = req.json
        ? [
            ['system', 'Reply with a single JSON document and nothing else.'] as [string, string],
            ...pairs,
          ]
        : pairs;
      const msg = (await model.invoke(messages, {
        ...(req.signal ? { signal: req.signal } : {}),
        timeout: req.timeoutMs,
      })) as MessageLike;
      return { text: messageText(msg.content), ...openAiTokens(msg) };
    },
  };
}

/** Exposes the raw response of the embeddings request, which `embedDocuments` throws away (V20: `usage.prompt_tokens`). */
class RawOpenAIEmbeddings extends OpenAIEmbeddings {
  raw(model: string, input: string[]) {
    return this.embeddingWithRetry({ model, input });
  }
}

export function openAiEmbedTransport(
  config: EmbeddingsConfig,
  headers?: Record<string, string>,
): EmbedTransport {
  const client = new RawOpenAIEmbeddings({
    model: config.model,
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
    maxRetries: 0,
    ...(config.baseUrl || headers
      ? {
          configuration: {
            ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
            ...(headers ? { defaultHeaders: headers } : {}),
          },
        }
      : {}),
  });
  return {
    async embed(texts, req) {
      const res = await withTimeout(client.raw(config.model, texts), req.timeoutMs, req.signal);
      const usage = res.usage as { prompt_tokens?: number; total_tokens?: number } | undefined;
      return {
        vectors: res.data.map((d) => d.embedding),
        tokens: num(usage?.prompt_tokens) ?? num(usage?.total_tokens),
      };
    },
  };
}

export function createOpenAiChatProvider(
  config: LlmConfig,
  extras: {
    tracer?: UsageTracer | undefined;
    logger?: Logger | undefined;
    transport?: ChatTransport | undefined;
  } = {},
): RemoteChatProvider {
  return new RemoteChatProvider(
    'openai',
    config.model,
    extras.transport ?? openAiChatTransport(config),
    extras,
  );
}

export function createOpenAiEmbeddingsProvider(
  config: EmbeddingsConfig,
  extras: {
    tracer?: UsageTracer | undefined;
    logger?: Logger | undefined;
    transport?: EmbedTransport | undefined;
  } = {},
): RemoteEmbeddingsProvider {
  return new RemoteEmbeddingsProvider(
    'openai',
    config.model,
    config.dimension,
    extras.transport ?? openAiEmbedTransport(config),
    extras,
  );
}

/** OpenRouter chat: the OpenAI-compatible API with attribution headers. */
export function createOpenRouterChatProvider(
  config: OpenRouterConfig,
  extras: {
    tracer?: UsageTracer | undefined;
    logger?: Logger | undefined;
    transport?: ChatTransport | undefined;
  } = {},
): RemoteChatProvider {
  const asLlm: LlmConfig = {
    provider: 'openai',
    model: config.model,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl ?? OPENROUTER_BASE_URL,
  };
  return new RemoteChatProvider(
    'openrouter',
    config.model,
    extras.transport ?? openAiChatTransport(asLlm, openRouterHeaders()),
    extras,
  );
}

/** OpenRouter embeddings. The provider rejects any vector whose length is not `config.dimension`. */
export function createOpenRouterEmbeddingsProvider(
  config: EmbeddingsConfig,
  extras: {
    tracer?: UsageTracer | undefined;
    logger?: Logger | undefined;
    transport?: EmbedTransport | undefined;
  } = {},
): RemoteEmbeddingsProvider {
  const withUrl: EmbeddingsConfig = { ...config, baseUrl: config.baseUrl ?? OPENROUTER_BASE_URL };
  return new RemoteEmbeddingsProvider(
    'openrouter',
    config.model,
    config.dimension,
    extras.transport ?? openAiEmbedTransport(withUrl, openRouterHeaders()),
    extras,
  );
}
