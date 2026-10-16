import { describe, expect, it, vi } from 'vitest';
import { RecordingUsageTracer } from '../llm/recording-usage-tracer';
import { ZERO_USAGE, type Usage } from '../llm/usage';
import type { UsageTracer } from '../llm/usage-tracer';
import { CuratorStepError, type CuratorDeps, type StepRecord, type StepRecorder } from './ports';
import { resolveEntry, resolvePromptEntry, withStep, type StepName } from './steps';

describe('resolveEntry', () => {
  const table: Array<[StepName | null, string]> = [
    [null, 'chunk'],
    ['chunk', 'embed'],
    ['embed', 'extractConcepts'],
    ['extractConcepts', 'linkPrerequisites'],
    ['linkPrerequisites', 'draftQuestions'],
    ['draftQuestions', 'draftQuestions'],
    ['validate', 'finalise'],
    ['publish', 'none'],
  ];
  for (const [last, entry] of table) {
    it(`${last ?? 'null'} -> ${entry}`, () => {
      expect(resolveEntry(last)).toBe(entry);
    });
  }
});

describe('resolvePromptEntry', () => {
  it('follows the table of the prompt run', () => {
    expect(resolvePromptEntry(null, false)).toBe('outline');
    expect(resolvePromptEntry('outline', true)).toBe('draftQuestions');
    expect(resolvePromptEntry('outline', false)).toBe('outline');
    expect(resolvePromptEntry('draftQuestions', true)).toBe('draftQuestions');
    expect(resolvePromptEntry('critique', true)).toBe('draftQuestions');
    expect(resolvePromptEntry('refine', true)).toBe('draftQuestions');
    expect(resolvePromptEntry('validate', true)).toBe('finalise');
    expect(resolvePromptEntry('publish', true)).toBe('none');
  });
});

interface Call {
  name: string;
  args: unknown[];
}

function makeRecorder() {
  const calls: Call[] = [];
  const record: StepRecord = {
    taskId: 't1',
    stepId: 's1',
    node: 'chunk',
    order: 1,
    attempt: 1,
    round: 0,
    startedAt: 1,
  };
  const recorder: StepRecorder = {
    begin: vi.fn(async (...args: unknown[]) => {
      calls.push({ name: 'begin', args });
      return record;
    }) as StepRecorder['begin'],
    progress: vi.fn(),
    complete: vi.fn(async (...args: unknown[]) => {
      calls.push({ name: 'complete', args });
    }) as StepRecorder['complete'],
    fail: vi.fn(async (...args: unknown[]) => {
      calls.push({ name: 'fail', args });
    }) as StepRecorder['fail'],
  };
  return { recorder, calls, record };
}

function makeDeps(over: Partial<CuratorDeps> = {}) {
  const { recorder, calls } = makeRecorder();
  const tracer = new RecordingUsageTracer();
  const deps = {
    graph: {} as CuratorDeps['graph'],
    chat: {} as CuratorDeps['chat'],
    embeddings: {} as CuratorDeps['embeddings'],
    recorder,
    tracer,
    isActive: async () => true,
    params: { chunkSizeChars: 1200, chunkOverlapChars: 150 },
    now: () => 1,
    ...over,
  } satisfies CuratorDeps;
  return { deps, calls, tracer, recorder };
}

const RUN = { taskId: 't1', requesterId: 'u1' };
const USAGE: Usage = { modelCalls: 2, inputTokens: 30, outputTokens: 10, embeddingTokens: 5 };

describe('withStep', () => {
  it('calls begin, then the node, then complete, and returns the node value', async () => {
    const { deps, calls } = makeDeps();
    const order: string[] = [];
    const value = await withStep(deps, RUN, 'chunk', async () => {
      order.push(`fn after ${calls.map((c) => c.name).join(',')}`);
      return { value: 42, log: '3 chunks', counts: { chunks: 3 } };
    });
    expect(value).toBe(42);
    expect(order).toEqual(['fn after begin']);
    expect(calls.map((c) => c.name)).toEqual(['begin', 'complete']);
    expect(calls[0]!.args).toEqual(['t1', 'chunk', 0]);
    const [, log, usage, counts] = calls[1]!.args;
    expect(log).toBe('3 chunks');
    expect(usage).toEqual(ZERO_USAGE);
    expect(counts).toEqual({ chunks: 3 });
  });

  it('passes the meter total to complete', async () => {
    const { deps, calls } = makeDeps();
    await withStep(deps, RUN, 'embed', async (ctx) => {
      ctx.meter.add(USAGE);
      ctx.meter.add({ ...ZERO_USAGE, modelCalls: 1, inputTokens: 1 });
      return { value: null, log: 'x' };
    });
    expect(calls[1]!.args[2]).toEqual({
      modelCalls: 3,
      inputTokens: 31,
      outputTokens: 10,
      embeddingTokens: 5,
    });
  });

  it('calls begin, then fail with the usage so far, and rethrows when the node throws', async () => {
    const { deps, calls } = makeDeps();
    const boom = new CuratorStepError('embed', 'PROVIDER_UNAVAILABLE', 'down');
    await expect(
      withStep(deps, RUN, 'embed', async (ctx) => {
        ctx.meter.add(USAGE);
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(calls.map((c) => c.name)).toEqual(['begin', 'fail']);
    expect(calls[1]!.args[1]).toBe(boom);
    expect(calls[1]!.args[2]).toEqual(USAGE);
  });

  it('stores zeros when a failing node made no call', async () => {
    const { deps, calls } = makeDeps();
    await expect(
      withStep(deps, RUN, 'chunk', async () => Promise.reject(new Error('plain'))),
    ).rejects.toBeInstanceOf(CuratorStepError);
    expect(calls[1]!.args[2]).toEqual(ZERO_USAGE);
  });

  it('wraps an unexpected error as INCONSISTENT_STATE and a graph outage as GRAPH_UNAVAILABLE', async () => {
    const { deps } = makeDeps();
    await expect(
      withStep(deps, RUN, 'chunk', async () => Promise.reject(new Error('x'))),
    ).rejects.toMatchObject({
      code: 'INCONSISTENT_STATE',
      node: 'chunk',
    });
    const outage = Object.assign(new Error('socket'), {
      name: 'GraphUnavailableError',
      code: 'GRAPH_UNAVAILABLE',
    });
    await expect(
      withStep(deps, RUN, 'chunk', async () => Promise.reject(outage)),
    ).rejects.toMatchObject({ code: 'GRAPH_UNAVAILABLE' });
  });

  it('fails the step with STEP_TIMEOUT when the node takes longer than the limit', async () => {
    const { deps, calls } = makeDeps({ stepTimeoutMs: 20 });
    await expect(
      withStep(deps, RUN, 'chunk', () => new Promise<never>(() => undefined)),
    ).rejects.toMatchObject({ code: 'STEP_TIMEOUT', node: 'chunk' });
    expect(calls.map((c) => c.name)).toEqual(['begin', 'fail']);
  });

  it('does not begin or run the node when the requester is blocked', async () => {
    const isActive = vi.fn(async () => false);
    const { deps, calls } = makeDeps({ isActive });
    const fn = vi.fn();
    await expect(withStep(deps, RUN, 'embed', fn)).rejects.toMatchObject({
      code: 'ACCOUNT_BLOCKED',
      node: 'embed',
    });
    expect(isActive).toHaveBeenCalledWith('u1');
    expect(fn).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('opens and closes a tracer step around the node', async () => {
    const { deps, tracer } = makeDeps();
    await withStep(deps, RUN, 'chunk', async () => ({ value: 1, log: 'ok' }));
    await expect(
      withStep(deps, RUN, 'embed', async () => Promise.reject(new Error('x'))),
    ).rejects.toBeDefined();
    expect(tracer.steps).toMatchObject([
      { runId: 't1', node: 'chunk', ended: true, ok: true },
      { runId: 't1', node: 'embed', ended: true, ok: false },
    ]);
  });

  it('hands the node the tracer step handle', async () => {
    const { deps } = makeDeps();
    let seen: unknown;
    await withStep(deps, RUN, 'chunk', async (ctx) => {
      seen = ctx.trace;
      return { value: 1, log: 'ok' };
    });
    expect(seen).toEqual({ runId: 't1', node: 'chunk' });
  });

  it('is not affected by a tracer that throws on every method', async () => {
    const throwing = new Proxy({} as UsageTracer, {
      get: () => () => {
        throw new Error('tracer down');
      },
    });
    const { deps, calls } = makeDeps({ tracer: throwing });
    const value = await withStep(deps, RUN, 'embed', async (ctx) => {
      ctx.meter.add(USAGE);
      return { value: 'fine', log: 'ok' };
    });
    expect(value).toBe('fine');
    expect(calls[1]!.args[2]).toEqual(USAGE);
    await expect(
      withStep(deps, RUN, 'embed', async () =>
        Promise.reject(new CuratorStepError('embed', 'INVALID_MODEL_OUTPUT', 'bad')),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_MODEL_OUTPUT' });
  });
});
