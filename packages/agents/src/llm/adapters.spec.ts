import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  ProviderConfigError,
  ProviderError,
  ProviderOutputError,
  ProviderUnavailableError,
  RecordingUsageTracer,
  RemoteChatProvider,
  RemoteEmbeddingsProvider,
  type ChatTransport,
  type EmbedTransport,
} from './index';
import { resetUsageWarnings } from './remote';

const msgs = [{ role: 'user' as const, content: 'hi' }];
const schema = z.object({ n: z.number() });

beforeEach(() => resetUsageWarnings());

function chatWith(
  responses: Array<{ text: string; inputTokens?: number; outputTokens?: number } | Error>,
  extras = {},
) {
  const queue = [...responses];
  const transport: ChatTransport = {
    invoke: vi.fn(async () => {
      const next = queue.shift()!;
      if (next instanceof Error) throw next;
      return next;
    }),
  };
  return { transport, provider: new RemoteChatProvider('openai', 'm', transport, extras) };
}

describe('RemoteChatProvider', () => {
  it('reads usage from the response', async () => {
    const { provider } = chatWith([{ text: 'x', inputTokens: 7, outputTokens: 3 }]);
    const r = await provider.complete(msgs);
    expect(r).toEqual({
      text: 'x',
      usage: { modelCalls: 1, inputTokens: 7, outputTokens: 3, embeddingTokens: 0 },
      usageReported: true,
    });
  });

  it('counts a call with zero tokens when usage is omitted, warning once per provider and model', async () => {
    const warn = vi.fn();
    const { provider } = chatWith([{ text: 'a' }, { text: 'b' }], { logger: { warn } });
    const a = await provider.complete(msgs);
    const b = await provider.complete(msgs);
    expect(a.usageReported).toBe(false);
    expect(b.usage).toEqual({ modelCalls: 1, inputTokens: 0, outputTokens: 0, embeddingTokens: 0 });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('translates failures and attaches the call spent', async () => {
    const down = Object.assign(new Error('bad gateway'), { status: 502 });
    const badKey = Object.assign(new Error('unauthorized'), { status: 401 });
    const rate = Object.assign(new Error('slow down'), { status: 429 });
    for (const [err, cls] of [
      [down, ProviderUnavailableError],
      [badKey, ProviderConfigError],
      [rate, ProviderUnavailableError],
      [new Error('ECONNREFUSED'), ProviderUnavailableError],
    ] as const) {
      const { provider } = chatWith([err]);
      const e = (await provider.complete(msgs).catch((x: unknown) => x)) as ProviderError;
      expect(e).toBeInstanceOf(cls);
      expect(e.usage).toEqual({
        modelCalls: 1,
        inputTokens: 0,
        outputTokens: 0,
        embeddingTokens: 0,
      });
    }
  });

  it('structured: sums attempts, asks for JSON, and traces each attempt', async () => {
    const tracer = new RecordingUsageTracer();
    const step = tracer.startStep(tracer.startRun({ id: 'r', kind: 'generate', userId: 'u' }), 'n');
    const { provider, transport } = chatWith(
      [
        { text: '{"n":"x"}', inputTokens: 10, outputTokens: 4 },
        { text: '```json\n{"n":2}\n```', inputTokens: 14, outputTokens: 3 },
      ],
      { tracer },
    );
    const r = await provider.completeStructured(msgs, schema, { label: 'l', trace: step });
    expect(r.value).toEqual({ n: 2 });
    expect(r.attempts).toBe(2);
    expect(r.usage).toEqual({
      modelCalls: 2,
      inputTokens: 24,
      outputTokens: 7,
      embeddingTokens: 0,
    });
    expect(vi.mocked(transport.invoke).mock.calls[0]![0].json).toBe(true);
    expect(tracer.calls.map((c) => c.call.ok)).toEqual([false, true]);
    expect(tracer.totalUsage()).toEqual(r.usage);
  });

  it('structured: exhausted retries throw ProviderOutputError with summed usage', async () => {
    const { provider } = chatWith([
      { text: 'nope', inputTokens: 1, outputTokens: 1 },
      { text: 'still nope', inputTokens: 2, outputTokens: 2 },
    ]);
    const e = (await provider
      .completeStructured(msgs, schema)
      .catch((x: unknown) => x)) as ProviderOutputError;
    expect(e).toBeInstanceOf(ProviderOutputError);
    expect(e.usage).toEqual({ modelCalls: 2, inputTokens: 3, outputTokens: 3, embeddingTokens: 0 });
  });
});

function embedWith(
  dimension: number,
  results: Array<{ vectors: number[][]; tokens?: number } | Error>,
  extras = {},
) {
  const queue = [...results];
  const transport: EmbedTransport = {
    embed: vi.fn(async () => {
      const next = queue.shift()!;
      if (next instanceof Error) throw next;
      return next;
    }),
  };
  return {
    transport,
    provider: new RemoteEmbeddingsProvider('ollama', 'e', dimension, transport, extras),
  };
}

describe('RemoteEmbeddingsProvider', () => {
  it('reports embedding tokens and one model call per request', async () => {
    const { provider } = embedWith(2, [
      {
        vectors: [
          [1, 0],
          [0, 1],
        ],
        tokens: 9,
      },
    ]);
    const r = await provider.embed(['a', 'b']);
    expect(r.usage).toEqual({ modelCalls: 1, inputTokens: 0, outputTokens: 0, embeddingTokens: 9 });
    expect(r.usageReported).toBe(true);
  });

  it('splits a large batch into sub-requests', async () => {
    const texts = Array.from({ length: 600 }, (_, i) => `t${i}`);
    const { provider, transport } = embedWith(1, [
      { vectors: texts.slice(0, 512).map(() => [1]), tokens: 5 },
      { vectors: texts.slice(512).map(() => [1]), tokens: 2 },
    ]);
    const r = await provider.embed(texts);
    expect(r.vectors).toHaveLength(600);
    expect(r.usage.modelCalls).toBe(2);
    expect(r.usage.embeddingTokens).toBe(7);
    expect(transport.embed).toHaveBeenCalledTimes(2);
  });

  it('asserts the vector length, keeping the usage spent', async () => {
    const { provider } = embedWith(3, [{ vectors: [[1, 0]], tokens: 4 }]);
    const e = (await provider.embed(['a']).catch((x: unknown) => x)) as ProviderConfigError;
    expect(e).toBeInstanceOf(ProviderConfigError);
    expect(e.usage.modelCalls).toBe(1);
    expect(e.usage.embeddingTokens).toBe(4);
  });

  it('counts a call with zero tokens when the provider omits them', async () => {
    const warn = vi.fn();
    const { provider } = embedWith(1, [{ vectors: [[1]] }], { logger: { warn } });
    const r = await provider.embed(['a']);
    expect(r.usageReported).toBe(false);
    expect(r.usage.modelCalls).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('translates failures', async () => {
    const { provider } = embedWith(1, [Object.assign(new Error('nf'), { status_code: 404 })]);
    const e = (await provider.embed(['a']).catch((x: unknown) => x)) as ProviderError;
    expect(e).toBeInstanceOf(ProviderConfigError);
    expect(e.usage.modelCalls).toBe(1);
  });
});
