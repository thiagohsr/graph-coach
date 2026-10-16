// RunOrchestrator with an in-memory graph and mocked graph runners: what it decides (entry, status changes, retry,
// start-up resume, concurrency) and what it never does (invoke a graph for a blocked requester or a finished task).
import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CuratorStepError,
  MAX_CONCURRENT_RUNS,
  runCurator,
  runPromptCreation,
  type TaskPatch,
  type TaskStatusName,
  type TaskUpdate,
} from '@coach/agents/curator';
import type { UsageTracer } from '@coach/agents/llm';
import { AppError } from '../../common/errors/app-error';
import { RunOrchestrator } from './run-orchestrator.service';
import { TaskEventBus, type TaskBusEvent } from './task-events.bus';
import { TaskRecorder } from './task-recorder';

vi.mock('@coach/agents/curator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@coach/agents/curator')>();
  return { ...actual, runCurator: vi.fn(), runPromptCreation: vi.fn() };
});

const runCuratorMock = vi.mocked(runCurator);
const runPromptMock = vi.mocked(runPromptCreation);

interface StoredTask {
  id: string;
  kind: 'ingest' | 'generate';
  status: TaskStatusName;
  result: 'ok' | 'nothing_usable' | 'below_minimum' | null;
  error: string | null;
  lastCompletedStep: string | null;
  requesterId: string | null;
  sourceId: string | null;
  questions: number;
  hasOutline: boolean;
}

const task = (id: string, patch: Partial<StoredTask> = {}): StoredTask => ({
  id,
  kind: 'ingest',
  status: 'queued',
  result: null,
  error: null,
  lastCompletedStep: null,
  requesterId: 'learner-1',
  sourceId: `src-${id}`,
  questions: 0,
  hasOutline: false,
  ...patch,
});

function harness(initial: StoredTask[] = []) {
  const tasks = new Map(initial.map((t) => [t.id, t]));
  const blocked = new Set<string>();
  const state = { paused: false };
  const events: Array<{ taskId: string; event: TaskBusEvent }> = [];
  const bus = new TaskEventBus();
  const watched = new Set<string>();
  const watch = (id: string) => {
    if (watched.has(id)) return;
    watched.add(id);
    bus.subscribe(id, (event) => events.push({ taskId: id, event }));
  };

  const graph = {
    async loadTask(id: string) {
      const t = tasks.get(id);
      return t ? ({ ...t, steps: [], usage: {}, createdAt: 0, updatedAt: 0 } as never) : null;
    },
    async openTasks(statuses: string[], kinds: string[]) {
      return [...tasks.values()].filter(
        (t) => statuses.includes(t.status) && kinds.includes(t.kind),
      );
    },
    async sourceChunks(sourceId: string) {
      const t = [...tasks.values()].find((x) => x.sourceId === sourceId);
      return t ? { source: { outline: t.hasOutline ? { concepts: [] } : null }, chunks: [] } : null;
    },
    async updateTask(
      id: string,
      expected: readonly TaskStatusName[],
      patch: TaskPatch,
    ): Promise<TaskUpdate | null> {
      const t = tasks.get(id);
      if (!t || !expected.includes(t.status)) return null;
      if (patch.status !== undefined) t.status = patch.status;
      if (patch.result !== undefined) t.result = patch.result;
      if (patch.error !== undefined) t.error = patch.error;
      return {
        taskId: id,
        status: t.status,
        result: t.result,
        error: t.error,
        lastCompletedStep: t.lastCompletedStep as never,
      };
    },
  };
  const recorder = new TaskRecorder(graph as never, bus, { now: () => new Date(1_000) });
  const noopTracer = {
    enabled: false,
    startRun: (run: { id: string }) => ({ runId: run.id }),
    startStep: (run: { runId: string }, node: string) => ({ runId: run.runId, node }),
    recordCall: () => undefined,
    endStep: () => undefined,
    endRun: () => undefined,
    flush: async () => undefined,
  } as UsageTracer;

  const orchestrator = new RunOrchestrator(
    graph as never,
    recorder,
    bus,
    {
      getAll: async () => ({ chunkSizeChars: 1200, chunkOverlapChars: 150 }),
      get: async () => 3,
    } as never,
    { isActive: async (id: string) => !blocked.has(id) } as never,
    { now: () => new Date(1_000) },
    {} as never,
    {} as never,
    noopTracer,
    {
      check: async () => (state.paused ? { allowed: false, reason: 'paused' } : { allowed: true }),
    } as never,
  );
  for (const id of tasks.keys()) watch(id);
  const user = { id: 'learner-1', role: 'learner' } as never;
  return { orchestrator, tasks, blocked, state, events, watch, user };
}

beforeEach(() => {
  runCuratorMock.mockReset();
  runPromptMock.mockReset();
  runCuratorMock.mockResolvedValue({ outcome: 'awaiting_review', counts: {} as never });
  runPromptMock.mockResolvedValue({ outcome: 'awaiting_review', counts: {} as never });
});

describe('start', () => {
  it('twice for one task runs the graph once', async () => {
    const h = harness([task('t1')]);
    let release: () => void = () => undefined;
    runCuratorMock.mockImplementation(
      () =>
        new Promise(
          (resolve) =>
            (release = () => resolve({ outcome: 'awaiting_review', counts: {} as never })),
        ),
    );
    h.orchestrator.start('t1');
    h.orchestrator.start('t1');
    await vi.waitFor(() => expect(runCuratorMock).toHaveBeenCalledTimes(1));
    expect(h.orchestrator.isRunning('t1')).toBe(true);
    release();
    await h.orchestrator.whenIdle('t1');
    expect(runCuratorMock).toHaveBeenCalledTimes(1);
    expect(h.tasks.get('t1')!.status).toBe('awaiting_review');
  });

  it('enters an upload run at the node after lastCompletedStep, and a prompt run through the prompt graph', async () => {
    const h = harness([
      task('up', { status: 'in_progress', lastCompletedStep: 'embed' }),
      task('pr', {
        kind: 'generate',
        status: 'in_progress',
        lastCompletedStep: 'outline',
        hasOutline: true,
      }),
      task('pr2', {
        kind: 'generate',
        status: 'queued',
        lastCompletedStep: 'outline',
        hasOutline: false,
      }),
    ]);
    h.orchestrator.start('up');
    h.orchestrator.start('pr');
    h.orchestrator.start('pr2');
    await Promise.all(['up', 'pr', 'pr2'].map((id) => h.orchestrator.whenIdle(id)));
    expect(runCuratorMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ entry: 'extractConcepts' }),
    );
    expect(runPromptMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ taskId: 'pr', entry: 'draftQuestions', minQuestions: 3 }),
    );
    expect(runPromptMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ taskId: 'pr2', entry: 'outline' }),
    );
  });

  it('a nothing_usable outcome ends the task done with that result', async () => {
    const h = harness([task('t1', { kind: 'generate' })]);
    runPromptMock.mockResolvedValue({ outcome: 'nothing_usable', counts: {} as never });
    h.orchestrator.start('t1');
    await h.orchestrator.whenIdle('t1');
    expect(h.tasks.get('t1')).toMatchObject({ status: 'done', result: 'nothing_usable' });
  });

  it('a task that is not open, or not a pipeline task, is left alone', async () => {
    const h = harness([task('a', { status: 'awaiting_review' }), task('b', { status: 'failed' })]);
    h.orchestrator.start('a');
    h.orchestrator.start('b');
    h.orchestrator.start('missing');
    await Promise.all(['a', 'b', 'missing'].map((id) => h.orchestrator.whenIdle(id)));
    expect(runCuratorMock).not.toHaveBeenCalled();
    expect(h.tasks.get('a')!.status).toBe('awaiting_review');
  });

  it('entry finalise sets awaiting_review or done from the stored counts without invoking the graph', async () => {
    const h = harness([
      task('with', { status: 'in_progress', lastCompletedStep: 'validate', questions: 4 }),
      task('without', { status: 'in_progress', lastCompletedStep: 'validate', questions: 0 }),
      task('prompt', {
        kind: 'generate',
        status: 'queued',
        lastCompletedStep: 'validate',
        questions: 2,
      }),
    ]);
    for (const id of ['with', 'without', 'prompt']) h.orchestrator.start(id);
    await Promise.all(['with', 'without', 'prompt'].map((id) => h.orchestrator.whenIdle(id)));
    expect(runCuratorMock).not.toHaveBeenCalled();
    expect(runPromptMock).not.toHaveBeenCalled();
    expect(h.tasks.get('with')!.status).toBe('awaiting_review');
    expect(h.tasks.get('without')).toMatchObject({ status: 'done', result: 'nothing_usable' });
    expect(h.tasks.get('prompt')!.status).toBe('awaiting_review');
  });
});

describe('a failing run', () => {
  it('sets failed with "<node>: <CODE>: <message>" and emits the terminal task event', async () => {
    const h = harness([task('t1')]);
    runCuratorMock.mockRejectedValue(
      new CuratorStepError('embed', 'PROVIDER_UNAVAILABLE', 'The model provider could not answer'),
    );
    h.orchestrator.start('t1');
    await h.orchestrator.whenIdle('t1');
    expect(h.tasks.get('t1')).toMatchObject({
      status: 'failed',
      error: 'embed: PROVIDER_UNAVAILABLE: The model provider could not answer',
    });
    const terminal = h.events.filter((e) => e.event.node === 'task');
    expect(terminal).toHaveLength(1);
    expect(terminal[0]!.event).toMatchObject({
      id: 'task:failed',
      status: 'error',
      payload: {
        taskStatus: 'failed',
        error: 'embed: PROVIDER_UNAVAILABLE: The model provider could not answer',
      },
    });
    expect(h.orchestrator.isRunning('t1')).toBe(false);
  });

  it('turns an unknown error into INCONSISTENT_STATE without its text, and clears the running set', async () => {
    const h = harness([task('t1', { lastCompletedStep: 'linkPrerequisites' })]);
    runCuratorMock.mockRejectedValue(new Error('SECRET passage text from the source'));
    h.orchestrator.start('t1');
    await h.orchestrator.whenIdle('t1');
    const stored = h.tasks.get('t1')!;
    expect(stored.status).toBe('failed');
    expect(stored.error).toBe('draftQuestions: INCONSISTENT_STATE: The run stopped unexpectedly');
    expect(stored.error).not.toContain('SECRET');
    expect(h.orchestrator.isRunning('t1')).toBe(false);
  });

  it('never logs the message of an unknown error (Principle VII), only class, task, step and tag', async () => {
    const secret = 'SECRET passage text from the source';
    class ProviderBoom extends Error {}
    const logged: string[] = [];
    const spies = (['error', 'warn', 'log', 'debug', 'verbose'] as const).map((level) =>
      vi.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(' '));
      }),
    );
    try {
      const h = harness([task('t1', { lastCompletedStep: 'linkPrerequisites' })]);
      runCuratorMock.mockRejectedValue(new ProviderBoom(secret));
      h.orchestrator.start('t1');
      await h.orchestrator.whenIdle('t1');
      expect(logged.length).toBeGreaterThan(0);
      expect(logged.join('\n')).not.toContain(secret);
      expect(logged.join('\n')).toContain('ProviderBoom');
      expect(logged.join('\n')).toContain('task=t1');
      expect(logged.join('\n')).toContain('step=draftQuestions');
      expect(h.tasks.get('t1')!.error).not.toContain(secret);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it('an ACCOUNT_BLOCKED step error is stored with that tag', async () => {
    const h = harness([task('t1', { kind: 'generate' })]);
    runPromptMock.mockRejectedValue(
      new CuratorStepError('refine', 'ACCOUNT_BLOCKED', 'account blocked'),
    );
    h.orchestrator.start('t1');
    await h.orchestrator.whenIdle('t1');
    expect(h.tasks.get('t1')!.error).toBe('refine: ACCOUNT_BLOCKED: account blocked');
  });
});

describe('retry', () => {
  it('moves failed to in_progress, clears the error, and enters at the failed node', async () => {
    const h = harness([
      task('t1', {
        status: 'failed',
        error: 'embed: PROVIDER_UNAVAILABLE: x',
        lastCompletedStep: 'chunk',
      }),
    ]);
    await h.orchestrator.retry(h.user, { id: 't1', kind: 'ingest' });
    await h.orchestrator.whenIdle('t1');
    expect(runCuratorMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ entry: 'embed' }),
    );
    expect(h.tasks.get('t1')).toMatchObject({ status: 'awaiting_review', error: null });
  });

  it('on any other status throws 409 TASK_NOT_FAILED and starts nothing', async () => {
    for (const status of ['queued', 'in_progress', 'awaiting_review', 'done'] as const) {
      const h = harness([task('t1', { status })]);
      const error = await h.orchestrator
        .retry(h.user, { id: 't1', kind: 'ingest' })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code: 'TASK_NOT_FAILED', status: 409, details: { status } });
      expect(h.orchestrator.isRunning('t1')).toBe(false);
    }
    expect(runCuratorMock).not.toHaveBeenCalled();
  });

  it('while creation is paused throws 503 CREATION_PAUSED and leaves the task failed', async () => {
    const h = harness([task('t1', { status: 'failed', error: 'embed: PROVIDER_UNAVAILABLE: x' })]);
    h.state.paused = true;
    await expect(h.orchestrator.retry(h.user, { id: 't1', kind: 'ingest' })).rejects.toMatchObject({
      code: 'CREATION_PAUSED',
      status: 503,
    });
    expect(h.tasks.get('t1')).toMatchObject({
      status: 'failed',
      error: 'embed: PROVIDER_UNAVAILABLE: x',
    });
  });

  it('a second concurrent retry loses the race with 409 and the graph runs once', async () => {
    const h = harness([task('t1', { status: 'failed', lastCompletedStep: 'chunk' })]);
    const results = await Promise.allSettled([
      h.orchestrator.retry(h.user, { id: 't1', kind: 'ingest' }),
      h.orchestrator.retry(h.user, { id: 't1', kind: 'ingest' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    await h.orchestrator.whenIdle('t1');
    expect(runCuratorMock).toHaveBeenCalledTimes(1);
  });
});

describe('resumeOpen', () => {
  it('marks the tasks of a blocked requester failed with ACCOUNT_BLOCKED without invoking a graph', async () => {
    const h = harness([
      task('q', { requesterId: 'blocked-1', status: 'queued' }),
      task('p', { requesterId: 'blocked-1', status: 'in_progress', lastCompletedStep: 'embed' }),
      task('g', {
        requesterId: 'blocked-1',
        kind: 'generate',
        status: 'in_progress',
        lastCompletedStep: 'critique',
        hasOutline: true,
      }),
    ]);
    h.blocked.add('blocked-1');
    const started = await h.orchestrator.resumeOpen();
    await h.orchestrator.whenResumed();
    expect(started).toBe(0);
    expect(runCuratorMock).not.toHaveBeenCalled();
    expect(runPromptMock).not.toHaveBeenCalled();
    expect(h.tasks.get('q')).toMatchObject({
      status: 'failed',
      error: 'chunk: ACCOUNT_BLOCKED: account blocked',
    });
    expect(h.tasks.get('p')).toMatchObject({
      status: 'failed',
      error: 'extractConcepts: ACCOUNT_BLOCKED: account blocked',
    });
    expect(h.tasks.get('g')).toMatchObject({
      status: 'failed',
      error: 'draftQuestions: ACCOUNT_BLOCKED: account blocked',
    });
    // Each got its terminal event.
    expect(
      h.events
        .filter((e) => e.event.id === 'task:failed')
        .map((e) => e.taskId)
        .sort(),
    ).toEqual(['g', 'p', 'q']);
  });

  it('starts every other queued and in_progress task, at most MAX_CONCURRENT_RUNS at once', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const h = harness([
      ...ids.map((id, i) => task(id, { status: i % 2 === 0 ? 'queued' : 'in_progress' })),
      task('done', { status: 'done' }),
      task('failed', { status: 'failed' }),
      task('review', { status: 'awaiting_review' }),
    ]);
    let active = 0;
    let peak = 0;
    const gates: Array<() => void> = [];
    runCuratorMock.mockImplementation(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => gates.push(resolve));
      active -= 1;
      return { outcome: 'awaiting_review', counts: {} as never };
    });

    const started = await h.orchestrator.resumeOpen();
    expect(started).toBe(5);
    await vi.waitFor(() => expect(active).toBe(MAX_CONCURRENT_RUNS));
    expect(runCuratorMock).toHaveBeenCalledTimes(MAX_CONCURRENT_RUNS);
    // Release them one at a time; the next waiting task starts each time.
    for (let finished = 0; finished < ids.length; finished += 1) {
      await vi.waitFor(() => expect(gates.length).toBeGreaterThan(finished));
      gates[finished]!();
      await vi.waitFor(() =>
        expect(runCuratorMock.mock.calls.length).toBe(
          Math.min(ids.length, MAX_CONCURRENT_RUNS + finished + 1),
        ),
      );
    }
    await h.orchestrator.whenResumed();
    expect(peak).toBe(MAX_CONCURRENT_RUNS);
    expect(ids.every((id) => h.tasks.get(id)!.status === 'awaiting_review')).toBe(true);
    expect(h.tasks.get('done')!.status).toBe('done');
    expect(h.tasks.get('failed')!.status).toBe('failed');
  });

  it('never lets one unreadable task stop the others', async () => {
    const h = harness([task('bad', { requesterId: null }), task('good')]);
    const started = await h.orchestrator.resumeOpen();
    await h.orchestrator.whenResumed();
    expect(started).toBe(1);
    expect(h.tasks.get('bad')).toMatchObject({ status: 'failed' });
    expect(h.tasks.get('good')!.status).toBe('awaiting_review');
  });

  it('does not start a task twice when it is already running here', async () => {
    const h = harness([task('t1', { status: 'in_progress' })]);
    let release: () => void = () => undefined;
    runCuratorMock.mockImplementation(
      () =>
        new Promise(
          (resolve) =>
            (release = () => resolve({ outcome: 'awaiting_review', counts: {} as never })),
        ),
    );
    h.orchestrator.start('t1');
    await vi.waitFor(() => expect(runCuratorMock).toHaveBeenCalledTimes(1));
    expect(await h.orchestrator.resumeOpen()).toBe(0);
    release();
    await h.orchestrator.whenIdle('t1');
    expect(runCuratorMock).toHaveBeenCalledTimes(1);
  });
});
