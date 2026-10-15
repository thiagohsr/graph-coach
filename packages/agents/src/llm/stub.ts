import type { z } from 'zod';
import { ProviderError, ProviderUnavailableError, attachUsage } from './errors';
import {
  makeReporter,
  runComplete,
  runEmbed,
  runStructured,
  type RawChat,
} from './structured';
import type { ChatMessage, ChatOptions, ChatProvider, EmbeddingsProvider, EmbedOptions, StructuredOptions } from './types';
import type { ChatResult, EmbeddingsResult, StructuredResult, Usage } from './usage';
import { ZERO_USAGE } from './usage';
import type { UsageTracer } from './usage-tracer';

export interface StubCall {
  label: string | undefined;
  messages: ChatMessage[];
  options: ChatOptions;
  structured: boolean;
}

type StubValue = string | Record<string, unknown> | unknown[] | Error;
export type StubResponse = StubValue | ((call: StubCall) => StubValue);

/** The stub's token rule: ceil(text.length / 4); 0 for an empty string. */
export function stubTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

type Matcher = string | RegExp;
const matches = (m: Matcher, label: string | undefined): boolean =>
  label !== undefined && (typeof m === 'string' ? m === label : new RegExp(m.source, m.flags.replace('g', '')).test(label));

export class StubChatProvider implements ChatProvider {
  readonly name = 'stub' as const;
  readonly model = 'stub-chat' as const;
  readonly calls: StubCall[] = [];

  private fixed: Array<{ matcher: Matcher; response: StubResponse }> = [];
  private queued: Array<{ matcher: Matcher; responses: StubResponse[] }> = [];
  private readonly tracer: UsageTracer | undefined;
  private readonly noResponseMessage: string | undefined;

  constructor(options: { tracer?: UsageTracer; noResponseMessage?: string } = {}) {
    this.tracer = options.tracer;
    this.noResponseMessage = options.noResponseMessage;
  }

  /** The same response for every call whose label matches. */
  on(label: Matcher, response: StubResponse): this {
    this.fixed.push({ matcher: label, response });
    return this;
  }

  /** Responses consumed in order for that label; afterwards the on() response applies, if any. */
  enqueue(label: Matcher, ...responses: StubResponse[]): this {
    this.queued.push({ matcher: label, responses: [...responses] });
    return this;
  }

  callCount(label?: Matcher): number {
    if (label === undefined) return this.calls.length;
    return this.calls.filter((c) => matches(label, c.label)).length;
  }

  reset(): void {
    this.fixed = [];
    this.queued = [];
    this.calls.length = 0;
  }

  complete(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResult> {
    return runComplete({
      provider: 'stub',
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
      provider: 'stub',
      label: options.label,
      messages,
      schema,
      maxRetries: options.maxRetries,
      call: (m) => this.attempt(m, options, true),
      report: this.reporter(options),
    });
  }

  private reporter(options: ChatOptions) {
    return makeReporter(this.tracer, options.trace, { provider: 'stub', model: this.model, label: options.label });
  }

  private next(call: StubCall): StubResponse | undefined {
    for (const q of this.queued) {
      if (q.responses.length > 0 && matches(q.matcher, call.label)) return q.responses.shift();
    }
    return this.fixed.find((f) => matches(f.matcher, call.label))?.response;
  }

  private async attempt(messages: ChatMessage[], options: ChatOptions, structured: boolean): Promise<RawChat> {
    const call: StubCall = { label: options.label, messages, options, structured };
    this.calls.push(call);
    const scripted = this.next(call);
    if (scripted === undefined) {
      throw new ProviderUnavailableError(
        this.noResponseMessage ?? `Stub chat provider has no response for label "${options.label ?? '(none)'}"`,
        { provider: 'stub', ...(options.label ? { label: options.label } : {}), usage: { ...ZERO_USAGE } },
      );
    }
    const response = typeof scripted === 'function' ? scripted(call) : scripted;
    const inputTokens = stubTokens(messages.map((m) => m.content).join('\n'));
    if (response instanceof Error) {
      const usage: Usage = { modelCalls: 1, inputTokens, outputTokens: 0, embeddingTokens: 0 };
      if (response instanceof ProviderError) throw attachUsage(response, usage);
      throw new ProviderUnavailableError(response.message, {
        provider: 'stub',
        cause: response,
        usage,
        ...(options.label ? { label: options.label } : {}),
      });
    }
    const text = typeof response === 'string' ? response : JSON.stringify(response);
    return {
      text,
      usage: { modelCalls: 1, inputTokens, outputTokens: stubTokens(text), embeddingTokens: 0 },
      usageReported: true,
    };
  }
}

function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function stubVector(text: string, dimension: number): number[] {
  const v = new Array<number>(dimension).fill(0);
  for (const token of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (!token) continue;
    const h = fnv1a(token);
    const bucket = h % dimension;
    v[bucket] = (v[bucket] ?? 0) + ((h >>> 16) & 1 ? 1 : -1);
  }
  const norm = Math.hypot(...v);
  if (norm === 0) {
    v[0] = 1;
    return v;
  }
  return v.map((x) => x / norm);
}

export class StubEmbeddingsProvider implements EmbeddingsProvider {
  readonly name = 'stub' as const;
  readonly model = 'stub-embeddings' as const;
  readonly dimension: number;
  readonly calls: Array<{ texts: string[] }> = [];
  private readonly tracer: UsageTracer | undefined;

  constructor(dimension = 64, options: { tracer?: UsageTracer } = {}) {
    this.dimension = dimension;
    this.tracer = options.tracer;
  }

  embed(texts: string[], options: EmbedOptions = {}): Promise<EmbeddingsResult> {
    this.calls.push({ texts });
    return runEmbed({
      provider: 'stub',
      label: options.label,
      report: makeReporter(this.tracer, options.trace, { provider: 'stub', model: this.model, label: options.label }),
      call: async () => ({
        vectors: texts.map((t) => stubVector(t, this.dimension)),
        usage: {
          modelCalls: 1,
          inputTokens: 0,
          outputTokens: 0,
          embeddingTokens: texts.reduce((n, t) => n + stubTokens(t), 0),
        },
        usageReported: true,
      }),
    });
  }
}
