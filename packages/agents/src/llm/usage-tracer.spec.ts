import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  LangfuseUsageTracer,
  NoopUsageTracer,
  StubChatProvider,
  StubEmbeddingsProvider,
  ZERO_USAGE,
  createUsageTracer,
  tracerConfigFromEnv,
  type LangfuseClientLike,
} from './index';

type Body = Record<string, unknown>;

function fakeClient() {
  const calls = { trace: [] as Body[], span: [] as Body[], generation: [] as Body[], flush: 0 };
  const client: LangfuseClientLike = {
    trace: (b) => void calls.trace.push(b as Body),
    span: (b) => void calls.span.push(b as Body),
    generation: (b) => void calls.generation.push(b as Body),
    flushAsync: async () => void calls.flush++,
    shutdownAsync: async () => undefined,
  };
  return { client, calls };
}

function allStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (value instanceof Date) return out;
  else if (Array.isArray(value)) value.forEach((v) => allStrings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => allStrings(v, out));
  return out;
}

const usage = { modelCalls: 1, inputTokens: 10, outputTokens: 5, embeddingTokens: 0 };

describe('NoopUsageTracer', () => {
  it('does nothing and never throws', async () => {
    const t = new NoopUsageTracer();
    expect(t.enabled).toBe(false);
    expect(t.content).toBeUndefined();
    const run = t.startRun({ id: 'r', kind: 'ingest', userId: 'u' });
    const step = t.startStep(run, 'n');
    expect(run.runId).toBe('r');
    expect(step.node).toBe('n');
    expect(() => {
      t.recordCall(step, { model: 'm', provider: 'stub', usage, durationMs: 1, ok: true });
      t.endStep(step, { ok: true });
      t.endRun(run);
    }).not.toThrow();
    await expect(t.flush()).resolves.toBeUndefined();
  });
});

describe('createUsageTracer / tracerConfigFromEnv', () => {
  it('returns the no-op tracer when any setting is missing', () => {
    const base = { publicKey: 'pk', secretKey: 'sk', host: 'http://localhost:3000', captureContent: false };
    expect(createUsageTracer({ ...base, publicKey: undefined })).toBeInstanceOf(NoopUsageTracer);
    expect(createUsageTracer({ ...base, secretKey: undefined })).toBeInstanceOf(NoopUsageTracer);
    expect(createUsageTracer({ ...base, host: undefined })).toBeInstanceOf(NoopUsageTracer);
    expect(createUsageTracer({ captureContent: false })).toBeInstanceOf(NoopUsageTracer);
  });

  it('returns a LangfuseUsageTracer when all are set (client construction makes no request)', async () => {
    const t = createUsageTracer({ publicKey: 'pk', secretKey: 'sk', host: 'http://127.0.0.1:1', captureContent: false });
    expect(t).toBeInstanceOf(LangfuseUsageTracer);
    expect(t.enabled).toBe(true);
  });

  it('reads the environment', () => {
    expect(
      tracerConfigFromEnv({
        LANGFUSE_PUBLIC_KEY: 'pk',
        LANGFUSE_SECRET_KEY: 'sk',
        LANGFUSE_HOST: 'http://h',
        LANGFUSE_CAPTURE_CONTENT: 'true',
      }),
    ).toEqual({ publicKey: 'pk', secretKey: 'sk', host: 'http://h', captureContent: true });
    expect(tracerConfigFromEnv({ LANGFUSE_PUBLIC_KEY: '' })).toEqual({
      publicKey: undefined,
      secretKey: undefined,
      host: undefined,
      captureContent: false,
    });
  });
});

describe('LangfuseUsageTracer', () => {
  const clock = { now: () => new Date('2026-01-01T00:00:10.000Z') };

  it('sends one trace per run, one span per step, one generation per call', () => {
    const { client, calls } = fakeClient();
    const t = new LangfuseUsageTracer({ client, captureContent: false, clock });
    const run = t.startRun({ id: 'task-1', kind: 'generate', userId: 'user-uuid' });
    const step = t.startStep(run, 'extract');
    t.recordCall(step, {
      model: 'gpt-x',
      provider: 'openai',
      usage: { modelCalls: 2, inputTokens: 10, outputTokens: 5, embeddingTokens: 7 },
      durationMs: 2000,
      ok: true,
      label: 'curator.extract',
      usageReported: false,
    });
    t.endStep(step, { ok: true });
    t.endRun(run, { ok: true });

    expect(calls.trace).toHaveLength(1);
    expect(calls.trace[0]).toMatchObject({ id: 'task-1', name: 'generate', userId: 'user-uuid', metadata: { kind: 'generate' } });
    expect(calls.span).toHaveLength(1);
    expect(calls.span[0]).toMatchObject({ traceId: 'task-1', name: 'extract' });
    expect(calls.generation).toHaveLength(1);
    const g = calls.generation[0]!;
    expect(g).toMatchObject({
      traceId: 'task-1',
      parentObservationId: calls.span[0]!.id,
      name: 'curator.extract',
      model: 'gpt-x',
      usage: { input: 17, output: 5, total: 22 },
      metadata: { provider: 'openai', modelCalls: 2, embeddingTokens: 7, usageReported: false },
    });
    expect((g.endTime as Date).getTime() - (g.startTime as Date).getTime()).toBe(2000);
    expect(g).not.toHaveProperty('input');
    expect(g).not.toHaveProperty('output');
  });

  it('marks failed steps and calls with level ERROR', () => {
    const { client, calls } = fakeClient();
    const t = new LangfuseUsageTracer({ client, captureContent: false, clock });
    const run = t.startRun({ id: 'r', kind: 'coach', userId: 'u' });
    const step = t.startStep(run, 'n');
    t.recordCall(step, { model: 'm', provider: 'stub', usage, durationMs: 1, ok: false });
    t.endStep(step, { ok: false });
    expect(calls.generation[0]!.level).toBe('ERROR');
    expect(calls.span[0]!.level).toBe('ERROR');
  });

  it('sends no content in usage-only mode, even through stub providers', async () => {
    const { client, calls } = fakeClient();
    const t = new LangfuseUsageTracer({ client, captureContent: false, clock });
    expect(t.content).toBeUndefined();
    const prompt = 'SECRET-PROMPT about jane.doe@example.com';
    const response = 'SECRET-RESPONSE-TEXT';
    const chat = new StubChatProvider({ tracer: t }).on('c', response).enqueue('s', { v: 'bad-VALUE' }, { n: 1 });
    const emb = new StubEmbeddingsProvider(8, { tracer: t });
    const run = t.startRun({ id: 'r', kind: 'ingest', userId: 'internal-uuid' });
    const step = t.startStep(run, 'node');
    await chat.complete([{ role: 'user', content: prompt }], { label: 'c', trace: step });
    await chat.completeStructured([{ role: 'user', content: prompt }], z.object({ n: z.number() }), { label: 's', trace: step });
    await emb.embed([prompt], { label: 'e', trace: step });
    t.endStep(step, { ok: true });
    t.endRun(run, { ok: true });

    expect(calls.generation).toHaveLength(4);
    const bodies = [...calls.trace, ...calls.span, ...calls.generation];
    for (const b of bodies) {
      expect(b).not.toHaveProperty('input');
      expect(b).not.toHaveProperty('output');
    }
    const strings = allStrings(bodies).join('\n');
    expect(strings).not.toContain('SECRET-PROMPT');
    expect(strings).not.toContain('SECRET-RESPONSE-TEXT');
    expect(strings).not.toContain('jane.doe@example.com');
    expect(strings).not.toContain('bad-VALUE');
  });

  it('reports one call per attempt, a failed call with ok false', async () => {
    const { client, calls } = fakeClient();
    const t = new LangfuseUsageTracer({ client, captureContent: false, clock });
    const chat = new StubChatProvider({ tracer: t }).enqueue('s', { n: 'x' }, { n: 1 }).on('e', new Error('boom'));
    const run = t.startRun({ id: 'r', kind: 'coach', userId: 'u' });
    const step = t.startStep(run, 'n');
    await chat.completeStructured([{ role: 'user', content: 'q' }], z.object({ n: z.number() }), { label: 's', trace: step });
    expect(calls.generation).toHaveLength(2);
    await chat.complete([{ role: 'user', content: 'q' }], { label: 'e', trace: step }).catch(() => undefined);
    expect(calls.generation).toHaveLength(3);
    expect(calls.generation[2]!.level).toBe('ERROR');
  });

  it('sets input and output only through content capture', () => {
    const { client, calls } = fakeClient();
    const t = new LangfuseUsageTracer({ client, captureContent: true, clock });
    const run = t.startRun({ id: 'r', kind: 'coach', userId: 'u' });
    const step = t.startStep(run, 'n');
    t.content!.recordCallWithContent(
      step,
      { model: 'm', provider: 'stub', usage, durationMs: 1, ok: true },
      { input: 'the prompt', output: 'the answer' },
    );
    expect(calls.generation[0]).toMatchObject({ input: 'the prompt', output: 'the answer' });
    t.recordCall(step, { model: 'm', provider: 'stub', usage, durationMs: 1, ok: true });
    expect(calls.generation[1]).not.toHaveProperty('input');
  });

  it('providers use recordCallWithContent when content capture is on', async () => {
    const { client, calls } = fakeClient();
    const t = new LangfuseUsageTracer({ client, captureContent: true, clock });
    const chat = new StubChatProvider({ tracer: t }).on('c', 'answer');
    const run = t.startRun({ id: 'r', kind: 'coach', userId: 'u' });
    const step = t.startStep(run, 'n');
    await chat.complete([{ role: 'user', content: 'question' }], { label: 'c', trace: step });
    expect(calls.generation[0]).toMatchObject({ input: 'question', output: 'answer' });
  });

  it('survives an unreachable service: no throw, same result, one warning, flush resolves', async () => {
    const boom = () => {
      throw new Error('connect ECONNREFUSED');
    };
    const client: LangfuseClientLike = {
      trace: boom,
      span: boom,
      generation: boom,
      flushAsync: () => Promise.reject(new Error('flush failed')),
      shutdownAsync: () => Promise.reject(new Error('shutdown failed')),
    };
    const warn = vi.fn();
    const t = new LangfuseUsageTracer({ client, captureContent: false, logger: { warn }, clock });
    const chat = new StubChatProvider({ tracer: t }).on('c', 'ok');
    const run = t.startRun({ id: 'r', kind: 'coach', userId: 'u' });
    const step = t.startStep(run, 'n');
    const r = await chat.complete([{ role: 'user', content: 'q' }], { label: 'c', trace: step });
    expect(r.text).toBe('ok');
    expect(r.usage.modelCalls).toBe(1);
    t.endStep(step, { ok: true });
    t.endRun(run, { ok: true });
    await expect(t.flush()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('Usage tracing unavailable');
  });

  it('flush gives up after its time limit', async () => {
    vi.useFakeTimers();
    try {
      const client: LangfuseClientLike = { ...fakeClient().client, flushAsync: () => new Promise(() => undefined) };
      const warn = vi.fn();
      const t = new LangfuseUsageTracer({ client, captureContent: false, logger: { warn } });
      const p = t.flush();
      await vi.advanceTimersByTimeAsync(5001);
      await expect(p).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses ZERO usage safely', () => {
    const { client, calls } = fakeClient();
    const t = new LangfuseUsageTracer({ client, captureContent: false, clock });
    const step = t.startStep(t.startRun({ id: 'r', kind: 'cover', userId: 'u' }), 'n');
    t.recordCall(step, { model: 'm', provider: 'stub', usage: ZERO_USAGE, durationMs: 0, ok: true });
    expect(calls.generation[0]!.usage).toEqual({ input: 0, output: 0, total: 0 });
  });
});
