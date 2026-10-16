import type { z } from 'zod';
import { ProviderConfigError, translateProviderError } from './errors';
import { makeReporter, runComplete, runEmbed, runStructured, type RawChat } from './structured';
import type {
  ChatMessage,
  ChatOptions,
  ChatProvider,
  EmbeddingsProvider,
  EmbedOptions,
  ProviderName,
  StructuredOptions,
} from './types';
import type { ChatResult, EmbeddingsResult, StructuredResult, Usage } from './usage';
import type { UsageTracer } from './usage-tracer';

/** What a real adapter needs from its SDK for one chat request. */
export interface ChatTransportRequest {
  messages: ChatMessage[];
  temperature: number;
  maxTokens?: number | undefined;
  timeoutMs: number;
  signal?: AbortSignal | undefined;
  /** Ask the model for a single JSON document. */
  json: boolean;
  schemaName?: string | undefined;
}

export interface ChatTransportResponse {
  text: string;
  /** Prompt tokens as reported by the provider; undefined when the provider omitted them. */
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
}

export interface ChatTransport {
  invoke(request: ChatTransportRequest): Promise<ChatTransportResponse>;
}

export interface EmbedTransport {
  /** One request to the provider. `tokens` is the provider's count; undefined when omitted. */
  embed(
    texts: string[],
    request: { timeoutMs: number; signal?: AbortSignal | undefined },
  ): Promise<{ vectors: number[][]; tokens?: number | undefined }>;
}

export interface Logger {
  warn(message: string): void;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const EMBED_BATCH_SIZE = 512;
const warnedMissingUsage = new Set<string>();

/** Test hook: forget which provider/model pairs already produced the missing-usage warning. */
export function resetUsageWarnings(): void {
  warnedMissingUsage.clear();
}

function warnMissingUsage(logger: Logger, provider: string, model: string): void {
  const key = `${provider}/${model}`;
  if (warnedMissingUsage.has(key)) return;
  warnedMissingUsage.add(key);
  logger.warn(
    `Provider "${provider}" (model "${model}") did not report token usage; counting the call with 0 tokens`,
  );
}

/** Rejects after `ms` or when `signal` aborts; used where an SDK call has no timeout of its own. */
export async function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  signal?: AbortSignal,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
    timer.unref?.();
    if (signal) {
      onAbort = () => reject(new Error('aborted'));
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
  });
  try {
    return await Promise.race([work, guard]);
  } finally {
    if (timer) clearTimeout(timer);
    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
  }
}

export class RemoteChatProvider implements ChatProvider {
  constructor(
    readonly name: Exclude<ProviderName, 'stub'>,
    readonly model: string,
    private readonly transport: ChatTransport,
    private readonly extras: { tracer?: UsageTracer | undefined; logger?: Logger | undefined } = {},
  ) {}

  complete(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResult> {
    return runComplete({
      provider: this.name,
      label: options.label,
      messages,
      call: (m) => this.attempt(m, options, false),
      report: this.reporter(options),
    });
  }

  completeStructured<T>(
    messages: ChatMessage[],
    schema: z.ZodType<T>,
    options: StructuredOptions = {},
  ): Promise<StructuredResult<T>> {
    return runStructured({
      provider: this.name,
      label: options.label,
      messages,
      schema,
      maxRetries: options.maxRetries,
      call: (m) => this.attempt(m, options, true),
      report: this.reporter(options),
    });
  }

  private reporter(options: ChatOptions) {
    return makeReporter(this.extras.tracer, options.trace, {
      provider: this.name,
      model: this.model,
      label: options.label,
    });
  }

  private async attempt(
    messages: ChatMessage[],
    options: StructuredOptions,
    json: boolean,
  ): Promise<RawChat> {
    let response: ChatTransportResponse;
    try {
      response = await this.transport.invoke({
        messages,
        temperature: options.temperature ?? 0,
        maxTokens: options.maxTokens,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        signal: options.signal,
        json,
        schemaName: options.schemaName,
      });
    } catch (e) {
      throw translateProviderError(e, {
        provider: this.name,
        ...(options.label ? { label: options.label } : {}),
        usage: { modelCalls: 1, inputTokens: 0, outputTokens: 0, embeddingTokens: 0 },
      });
    }
    const reported = response.inputTokens !== undefined || response.outputTokens !== undefined;
    if (!reported) warnMissingUsage(this.extras.logger ?? console, this.name, this.model);
    return {
      text: response.text,
      usage: {
        modelCalls: 1,
        inputTokens: response.inputTokens ?? 0,
        outputTokens: response.outputTokens ?? 0,
        embeddingTokens: 0,
      },
      usageReported: reported,
    };
  }
}

export class RemoteEmbeddingsProvider implements EmbeddingsProvider {
  constructor(
    readonly name: Exclude<ProviderName, 'stub'>,
    readonly model: string,
    readonly dimension: number,
    private readonly transport: EmbedTransport,
    private readonly extras: { tracer?: UsageTracer | undefined; logger?: Logger | undefined } = {},
  ) {}

  embed(texts: string[], options: EmbedOptions = {}): Promise<EmbeddingsResult> {
    return runEmbed({
      provider: this.name,
      label: options.label,
      report: makeReporter(this.extras.tracer, options.trace, {
        provider: this.name,
        model: this.model,
        label: options.label,
      }),
      call: () => this.run(texts, options),
    });
  }

  private async run(texts: string[], options: EmbedOptions): Promise<EmbeddingsResult> {
    const vectors: number[][] = [];
    let usage: Usage = { modelCalls: 0, inputTokens: 0, outputTokens: 0, embeddingTokens: 0 };
    let reported = true;
    const fail = (e: unknown) =>
      translateProviderError(e, {
        provider: this.name,
        ...(options.label ? { label: options.label } : {}),
        usage,
      });

    for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
      const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
      usage = { ...usage, modelCalls: usage.modelCalls + 1 };
      let result: Awaited<ReturnType<EmbedTransport['embed']>>;
      try {
        result = await this.transport.embed(batch, {
          timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          signal: options.signal,
        });
      } catch (e) {
        throw fail(e);
      }
      if (result.tokens === undefined) {
        reported = false;
        warnMissingUsage(this.extras.logger ?? console, this.name, this.model);
      } else {
        usage = { ...usage, embeddingTokens: usage.embeddingTokens + result.tokens };
      }
      if (result.vectors.length !== batch.length) {
        throw new ProviderConfigError(
          `${this.name} returned ${result.vectors.length} vectors for ${batch.length} inputs`,
          { provider: this.name, usage, ...(options.label ? { label: options.label } : {}) },
        );
      }
      for (const v of result.vectors) {
        if (v.length !== this.dimension) {
          throw new ProviderConfigError(
            `${this.name} model "${this.model}" returned vectors of length ${v.length}, expected ${this.dimension}`,
            { provider: this.name, usage, ...(options.label ? { label: options.label } : {}) },
          );
        }
        vectors.push(v);
      }
    }
    return { vectors, usage, usageReported: reported };
  }
}
