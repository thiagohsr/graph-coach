import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { z } from 'zod';
import { ProviderConfigError, ProviderError,ProviderUnavailableError, attachUsage } from './errors';
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

interface RecordedEntry {
  promptHash: string;
  response: StubValue;
}

/** sha-256 (hex) of the message contents joined with "\n" (roles are not hashed). */
export function promptHash(messages: ChatMessage[]): string {
  return createHash('sha256').update(messages.map((m) => m.content).join('\n')).digest('hex');
}

const LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const isSafeLabel = (label: string): boolean => LABEL_PATTERN.test(label) && !label.includes('..');

function loadRecordings(dir: string): Map<string, RecordedEntry[]> {
  const root = resolve(dir);
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    throw new ProviderConfigError(`Recordings directory is not readable: ${root}`, { provider: 'stub' });
  }
  const map = new Map<string, RecordedEntry[]>();
  for (const name of names.sort()) {
    if (!name.endsWith('.json')) continue;
    const label = name.slice(0, -'.json'.length);
    if (!isSafeLabel(label)) continue;
    const file = join(root, name);
    if (!lstatSync(file).isFile()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      throw new ProviderConfigError(`Recording file is not valid JSON: ${name}`, { provider: 'stub' });
    }
    const entries = (parsed as { responses?: unknown } | null)?.responses;
    if (!Array.isArray(entries)) {
      throw new ProviderConfigError(`Recording file ${name} needs a "responses" array`, { provider: 'stub' });
    }
    const list: RecordedEntry[] = [];
    for (const e of entries as Array<Record<string, unknown>>) {
      if (typeof e?.promptHash !== 'string' || e.response === undefined || e.response === null) {
        throw new ProviderConfigError(`Recording file ${name} has an entry without promptHash/response`, {
          provider: 'stub',
        });
      }
      list.push({ promptHash: e.promptHash, response: e.response as StubValue });
    }
    map.set(label, list);
  }
  return map;
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

  private recordings: Map<string, RecordedEntry[]> | undefined;

  constructor(options: { tracer?: UsageTracer; noResponseMessage?: string } = {}) {
    this.tracer = options.tracer;
    this.noResponseMessage = options.noResponseMessage;
  }

  /**
   * Recorded-response mode: answers by label and prompt hash from `<label>.json` files in `dir`
   * (format: seed/recordings/README.md). The directory is resolved and read once, here; only
   * regular `.json` files directly inside it are read. A call with no matching recording throws
   * ProviderUnavailableError naming the label (never the prompt text).
   */
  static fromRecordings(
    dir: string,
    options: { tracer?: UsageTracer } = {},
  ): StubChatProvider {
    const provider = new StubChatProvider(options);
    provider.recordings = loadRecordings(dir);
    return provider;
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
    const fixed = this.fixed.find((f) => matches(f.matcher, call.label))?.response;
    if (fixed !== undefined || !this.recordings) return fixed;
    if (call.label === undefined || !isSafeLabel(call.label)) return undefined;
    const hash = promptHash(call.messages);
    return this.recordings.get(call.label)?.find((e) => e.promptHash === hash)?.response;
  }

  private async attempt(messages: ChatMessage[], options: ChatOptions, structured: boolean): Promise<RawChat> {
    const call: StubCall = { label: options.label, messages, options, structured };
    this.calls.push(call);
    const scripted = this.next(call);
    if (scripted === undefined) {
      const hash = promptHash(messages);
      throw new ProviderUnavailableError(
        this.recordings
          ? `No recorded response for label "${options.label ?? '(none)'}" (prompt hash ${hash})`
          : this.noResponseMessage ?? `Stub chat provider has no response for label "${options.label ?? '(none)'}"`,
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
