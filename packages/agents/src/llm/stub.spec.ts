import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ProviderError,
  ProviderOutputError,
  ProviderUnavailableError,
  RecordingUsageTracer,
  StubChatProvider,
  StubEmbeddingsProvider,
  ZERO_USAGE,
  addUsage,
  stubTokens,
  sumUsage,
  type StepHandle,
} from './index';
import { RecordingUsageTracer as FromTesting, StubChatProvider as StubFromTesting } from '../testing/index';

const schema = z.object({ n: z.number() });
const msgs = [
  { role: 'system' as const, content: 'You are terse.' },
  { role: 'user' as const, content: 'Give me a number.' },
];
const joined = (m: { content: string }[]) => m.map((x) => x.content).join('\n');

function cosine(a: number[], b: number[]) {
  return a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);
}

describe('usage helpers', () => {
  it('addUsage and sumUsage are field-wise; ZERO_USAGE is frozen', () => {
    const a = { modelCalls: 1, inputTokens: 2, outputTokens: 3, embeddingTokens: 4 };
    const b = { modelCalls: 10, inputTokens: 20, outputTokens: 30, embeddingTokens: 40 };
    expect(addUsage(a, b)).toEqual({ modelCalls: 11, inputTokens: 22, outputTokens: 33, embeddingTokens: 44 });
    expect(sumUsage([a, b, a])).toEqual({ modelCalls: 12, inputTokens: 24, outputTokens: 36, embeddingTokens: 48 });
    expect(sumUsage([])).toEqual(ZERO_USAGE);
    expect(Object.isFrozen(ZERO_USAGE)).toBe(true);
    expect(addUsage(ZERO_USAGE, ZERO_USAGE)).not.toBe(ZERO_USAGE);
  });
  it('stubTokens is ceil(length / 4)', () => {
    expect(stubTokens('')).toBe(0);
    expect(stubTokens('abcd')).toBe(1);
    expect(stubTokens('abcde')).toBe(2);
  });
});

describe('StubChatProvider', () => {
  it('returns on() responses and records calls', async () => {
    const stub = new StubChatProvider().on('greet', 'hello');
    const r = await stub.complete(msgs, { label: 'greet' });
    expect(r.text).toBe('hello');
    expect(stub.callCount('greet')).toBe(1);
    expect(stub.calls[0]?.messages).toEqual(msgs);
    expect(stub.calls[0]?.structured).toBe(false);
    stub.reset();
    expect(stub.calls).toHaveLength(0);
  });

  it('consumes enqueue() in order, then falls back to on()', async () => {
    const stub = new StubChatProvider().on(/^x/, 'fallback').enqueue('x1', 'a', 'b');
    expect((await stub.complete(msgs, { label: 'x1' })).text).toBe('a');
    expect((await stub.complete(msgs, { label: 'x1' })).text).toBe('b');
    expect((await stub.complete(msgs, { label: 'x1' })).text).toBe('fallback');
  });

  it('supports function responses and object responses for complete()', async () => {
    const stub = new StubChatProvider()
      .on('fn', (call) => `label=${call.label}`)
      .on('obj', { n: 1 });
    expect((await stub.complete(msgs, { label: 'fn' })).text).toBe('label=fn');
    expect((await stub.complete(msgs, { label: 'obj' })).text).toBe('{"n":1}');
  });

  it('throws ProviderUnavailableError naming an unconfigured label, with ZERO_USAGE', async () => {
    const stub = new StubChatProvider();
    const err = await stub.complete(msgs, { label: 'nope' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderUnavailableError);
    expect((err as ProviderError).message).toContain('nope');
    expect((err as ProviderError).usage).toEqual(ZERO_USAGE);
  });

  it('completeStructured returns a validated value', async () => {
    const stub = new StubChatProvider().on('s', { n: 7 });
    const r = await stub.completeStructured(msgs, schema, { label: 's' });
    expect(r.value).toEqual({ n: 7 });
    expect(r.attempts).toBe(1);
    expect(stub.calls[0]?.structured).toBe(true);
  });

  it('retries once on invalid output, then succeeds', async () => {
    const stub = new StubChatProvider().enqueue('s', { n: 'bad' }, { n: 2 });
    const r = await stub.completeStructured(msgs, schema, { label: 's' });
    expect(r.value).toEqual({ n: 2 });
    expect(r.attempts).toBe(2);
    expect(stub.callCount('s')).toBe(2);
    const second = stub.calls[1]!.messages;
    expect(second.length).toBe(msgs.length + 1);
    expect(second[second.length - 1]?.role).toBe('user');
  });

  it('retries on non-JSON text', async () => {
    const stub = new StubChatProvider().enqueue('s', 'not json', '{"n":3}');
    const r = await stub.completeStructured(msgs, schema, { label: 's' });
    expect(r.value).toEqual({ n: 3 });
  });

  it('throws ProviderOutputError with issues after retries are exhausted', async () => {
    const stub = new StubChatProvider().enqueue('s', { n: 'x' }, { n: 'y' });
    const err = await stub.completeStructured(msgs, schema, { label: 's', maxRetries: 1 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderOutputError);
    const out = err as ProviderOutputError;
    expect(out.issues.length).toBeGreaterThan(0);
    expect(out.raw).toBe('{"n":"y"}');
    expect(stub.callCount('s')).toBe(2);
  });

  describe('usage', () => {
    it('complete reports deterministic usage', async () => {
      const stub = new StubChatProvider().on('c', 'twelve chars');
      const r = await stub.complete(msgs, { label: 'c' });
      expect(r.usageReported).toBe(true);
      expect(r.usage).toEqual({
        modelCalls: 1,
        inputTokens: stubTokens(joined(msgs)),
        outputTokens: stubTokens('twelve chars'),
        embeddingTokens: 0,
      });
      const again = await new StubChatProvider().on('c', 'twelve chars').complete(msgs, { label: 'c' });
      expect(again.usage).toEqual(r.usage);
    });

    it('completeStructured returns the sum over attempts', async () => {
      const stub = new StubChatProvider().on('s', { n: 1 });
      const one = await stub.completeStructured(msgs, schema, { label: 's' });
      expect(one.usage.modelCalls).toBe(1);
      expect(one.usage.outputTokens).toBe(stubTokens('{"n":1}'));

      const retried = new StubChatProvider().enqueue('s', { n: 'bad' }, { n: 1 });
      const r = await retried.completeStructured(msgs, schema, { label: 's' });
      expect(r.attempts).toBe(2);
      expect(r.usage.modelCalls).toBe(2);
      const firstIn = stubTokens(joined(retried.calls[0]!.messages));
      const secondIn = stubTokens(joined(retried.calls[1]!.messages));
      expect(r.usage.inputTokens).toBe(firstIn + secondIn);
      expect(r.usage.outputTokens).toBe(stubTokens('{"n":"bad"}') + stubTokens('{"n":1}'));
    });

    it('an exhausted retry loop puts the summed usage on ProviderOutputError', async () => {
      const stub = new StubChatProvider().enqueue('s', { n: 'a' }, { n: 'b' });
      const err = (await stub
        .completeStructured(msgs, schema, { label: 's', maxRetries: 1 })
        .catch((e: unknown) => e)) as ProviderOutputError;
      expect(err.usage.modelCalls).toBe(2);
      expect(err.usage.inputTokens).toBe(
        stubTokens(joined(stub.calls[0]!.messages)) + stubTokens(joined(stub.calls[1]!.messages)),
      );
      expect(err.usage.outputTokens).toBe(stubTokens('{"n":"a"}') + stubTokens('{"n":"b"}'));
    });

    it('a scripted Error counts the call and its input tokens only', async () => {
      const stub = new StubChatProvider().on('e', new Error('boom'));
      const err = (await stub.complete(msgs, { label: 'e' }).catch((e: unknown) => e)) as ProviderError;
      expect(err).toBeInstanceOf(ProviderError);
      expect(err.usage).toEqual({
        modelCalls: 1,
        inputTokens: stubTokens(joined(msgs)),
        outputTokens: 0,
        embeddingTokens: 0,
      });
    });

    it('a ProviderError scripted on the second attempt reports the attempts made', async () => {
      const stub = new StubChatProvider().enqueue('s', { n: 'bad' }, new ProviderUnavailableError('down', { provider: 'stub' }));
      const err = (await stub.completeStructured(msgs, schema, { label: 's' }).catch((e: unknown) => e)) as ProviderError;
      expect(err).toBeInstanceOf(ProviderUnavailableError);
      expect(err.usage.modelCalls).toBe(2);
    });
  });

  describe('tracing', () => {
    const open = (tracer: RecordingUsageTracer): StepHandle => {
      const run = tracer.startRun({ id: 'r1', kind: 'generate', userId: 'u1' });
      return tracer.startStep(run, 'node');
    };

    it('records one call per attempt with the result usage', async () => {
      const tracer = new RecordingUsageTracer();
      const step = open(tracer);
      const stub = new StubChatProvider({ tracer }).on('c', 'hi');
      const r = await stub.complete(msgs, { label: 'c', trace: step });
      expect(r.text).toBe('hi');
      expect(tracer.calls).toHaveLength(1);
      const call = tracer.calls[0]!.call;
      expect(call).toMatchObject({ provider: 'stub', model: 'stub-chat', label: 'c', ok: true });
      expect(tracer.totalUsage()).toEqual(r.usage);
    });

    it('a retried structured call records two calls, the first not ok', async () => {
      const tracer = new RecordingUsageTracer();
      const step = open(tracer);
      const stub = new StubChatProvider({ tracer }).enqueue('s', { n: 'bad' }, { n: 1 });
      const r = await stub.completeStructured(msgs, schema, { label: 's', trace: step });
      expect(tracer.calls.map((c) => c.call.ok)).toEqual([false, true]);
      expect(tracer.totalUsage()).toEqual(r.usage);
    });

    it('failed attempts are recorded and the total equals the thrown usage', async () => {
      const tracer = new RecordingUsageTracer();
      const step = open(tracer);
      const stub = new StubChatProvider({ tracer }).enqueue('s', { n: 'a' }, { n: 'b' }).on('e', new Error('boom'));
      const out = (await stub
        .completeStructured(msgs, schema, { label: 's', trace: step, maxRetries: 1 })
        .catch((e: unknown) => e)) as ProviderError;
      expect(tracer.calls.map((c) => c.call.ok)).toEqual([false, false]);
      expect(tracer.totalUsage()).toEqual(out.usage);

      tracer.reset();
      const step2 = open(tracer);
      const err = (await stub.complete(msgs, { label: 'e', trace: step2 }).catch((e: unknown) => e)) as ProviderError;
      expect(tracer.calls).toHaveLength(1);
      expect(tracer.calls[0]!.call.ok).toBe(false);
      expect(tracer.totalUsage()).toEqual(err.usage);
    });

    it('records nothing without trace, or for an unconfigured label', async () => {
      const tracer = new RecordingUsageTracer();
      const step = open(tracer);
      const stub = new StubChatProvider({ tracer }).on('c', 'hi');
      await stub.complete(msgs, { label: 'c' });
      await stub.complete(msgs, { label: 'missing', trace: step }).catch(() => undefined);
      expect(tracer.calls).toHaveLength(0);
    });
  });
});

describe('StubEmbeddingsProvider', () => {
  it('gives equal unit vectors of the configured dimension for equal text', async () => {
    const stub = new StubEmbeddingsProvider(32);
    const { vectors } = await stub.embed(['Hello world', 'Hello world', '']);
    expect(vectors[0]).toEqual(vectors[1]);
    for (const v of vectors) {
      expect(v).toHaveLength(32);
      expect(Math.hypot(...v)).toBeCloseTo(1, 6);
    }
    expect(stub.dimension).toBe(32);
    expect(new StubEmbeddingsProvider().dimension).toBe(64);
  });

  it('ranks texts sharing words above unrelated texts', async () => {
    const stub = new StubEmbeddingsProvider();
    const { vectors } = await stub.embed([
      'graph databases store nodes and edges',
      'nodes and edges in a graph database',
      'banana smoothie recipe with honey',
    ]);
    expect(cosine(vectors[0]!, vectors[1]!)).toBeGreaterThan(cosine(vectors[0]!, vectors[2]!));
  });

  it('reports usage and traces one call per embed request', async () => {
    const tracer = new RecordingUsageTracer();
    const run = tracer.startRun({ id: 'r', kind: 'ingest', userId: 'u' });
    const step = tracer.startStep(run, 'embed');
    const stub = new StubEmbeddingsProvider(8, { tracer });
    const texts = ['abcdefgh', 'xy'];
    const r = await stub.embed(texts, { label: 'emb', trace: step });
    expect(r.usage).toEqual({
      modelCalls: 1,
      inputTokens: 0,
      outputTokens: 0,
      embeddingTokens: stubTokens('abcdefgh') + stubTokens('xy'),
    });
    expect(r.usageReported).toBe(true);
    expect(tracer.calls).toHaveLength(1);
    expect(tracer.calls[0]!.call).toMatchObject({ provider: 'stub', model: 'stub-embeddings', label: 'emb', ok: true });
    expect(tracer.totalUsage()).toEqual(r.usage);
    await stub.embed(texts);
    expect(tracer.calls).toHaveLength(1);
  });
});

describe('RecordingUsageTracer', () => {
  it('keeps runs, steps, and calls in order', () => {
    const t = new RecordingUsageTracer();
    const run = t.startRun({ id: 'r', kind: 'coach', userId: 'u' });
    const a = t.startStep(run, 'a');
    const usage = { modelCalls: 1, inputTokens: 3, outputTokens: 4, embeddingTokens: 0 };
    t.recordCall(a, { model: 'm', provider: 'stub', usage, durationMs: 1, ok: true });
    t.endStep(a, { ok: true });
    const b = t.startStep(run, 'b');
    t.recordCall(b, { model: 'm', provider: 'stub', usage, durationMs: 1, ok: false });
    t.endStep(b, { ok: false });
    t.endRun(run, { ok: false });
    expect(t.runs).toEqual([{ id: 'r', kind: 'coach', userId: 'u', ok: false, ended: true }]);
    expect(t.steps.map((s) => [s.node, s.ok, s.ended])).toEqual([['a', true, true], ['b', false, true]]);
    expect(t.callsFor('a')).toHaveLength(1);
    expect(t.totalUsage('r').modelCalls).toBe(2);
    expect(t.totalUsage('other')).toEqual(ZERO_USAGE);
    expect(t.content).toBeUndefined();
    t.reset();
    expect(t.runs).toHaveLength(0);
  });

  it('exposes content only with captureContent', () => {
    const t = new RecordingUsageTracer({ captureContent: true });
    const run = t.startRun({ id: 'r', kind: 'coach', userId: 'u' });
    const s = t.startStep(run, 'a');
    t.content!.recordCallWithContent(
      s,
      { model: 'm', provider: 'stub', usage: ZERO_USAGE, durationMs: 0, ok: true },
      { input: 'in', output: 'out' },
    );
    expect(t.calls[0]!.content).toEqual({ input: 'in', output: 'out' });
  });

  it('is importable from the testing entry point', () => {
    expect(FromTesting).toBe(RecordingUsageTracer);
    expect(StubFromTesting).toBe(StubChatProvider);
  });
});
