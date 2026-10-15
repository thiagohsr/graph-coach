import { describe, expect, it } from 'vitest';
import {
  CuratorStepError,
  stepId,
  type AddStepInput,
  type StepRow,
  type TaskPatch,
  type TaskRow,
  type TaskStatusName,
  type TaskUpdate,
  type Usage,
} from '@coach/agents/curator';
import type { Clock } from '../../common/clock';
import type { CuratorGraph } from './curator.graph-port';
import { TaskEventBus, type TaskBusEvent } from './task-events.bus';
import { TaskRecorder } from './task-recorder';

const ZERO: Usage = { modelCalls: 0, inputTokens: 0, outputTokens: 0, embeddingTokens: 0 };
const USAGE: Usage = { modelCalls: 2, inputTokens: 30, outputTokens: 9, embeddingTokens: 4 };

/** An in-memory stand-in for the graph port that records the order of writes. */
class FakeGraph {
  readonly log: string[] = [];
  readonly steps = new Map<string, AddStepInput>();
  task = {
    status: 'in_progress' as TaskStatusName,
    result: null as TaskRow['result'],
    error: null as string | null,
    lastCompletedStep: null as string | null,
  };

  async loadTask(): Promise<(TaskRow & { steps: StepRow[] }) | null> {
    const steps: StepRow[] = [...this.steps.values()]
      .sort((a, b) => a.order - b.order)
      .map((s) => ({
        stepId: s.id,
        node: s.node,
        status: s.status,
        log: s.log,
        usage: s.usage,
        startedAt: s.startedAt,
        finishedAt: s.finishedAt,
        order: s.order,
      }));
    return { steps } as unknown as TaskRow & { steps: StepRow[] };
  }

  async addStep(input: AddStepInput): Promise<Usage> {
    this.log.push(`addStep:${input.status}`);
    const previous = this.steps.get(input.id);
    this.steps.set(input.id, {
      ...input,
      order: previous?.order ?? input.order,
      startedAt: previous?.startedAt ?? input.startedAt,
    });
    return ZERO;
  }

  async updateTask(
    _id: string,
    expected: readonly TaskStatusName[],
    patch: TaskPatch,
  ): Promise<TaskUpdate | null> {
    this.log.push(`updateTask:${Object.keys(patch).join(',')}`);
    if (!expected.includes(this.task.status)) return null;
    Object.assign(this.task, patch);
    return { taskId: 't1', ...this.task } as TaskUpdate;
  }
}

function setup() {
  const graph = new FakeGraph();
  const bus = new TaskEventBus();
  const events: TaskBusEvent[] = [];
  bus.subscribe('t1', (e) => {
    // The graph write must already have happened when the event arrives.
    events.push({ ...e, payload: { ...(e.payload ?? {}), __writes: graph.log.length } });
  });
  const clock: Clock & { ms: number } = {
    ms: 1_760_000_000_000,
    now() {
      return new Date(this.ms);
    },
  };
  const recorder = new TaskRecorder(graph as unknown as CuratorGraph, bus, clock);
  return { graph, bus, events, clock, recorder };
}

describe('TaskRecorder', () => {
  it('writes the step to the graph before it publishes', async () => {
    const s = setup();
    await s.recorder.begin('t1', 'chunk');
    expect(s.graph.log).toEqual(['addStep:active']);
    expect(s.events).toHaveLength(1);
    expect(s.events[0]!.payload!.__writes).toBe(1);
  });

  it('begin stores an active step with payload.stepId and payload.order and an event id <order>:a', async () => {
    const s = setup();
    const handle = await s.recorder.begin('t1', 'chunk');
    expect(handle).toMatchObject({
      taskId: 't1',
      node: 'chunk',
      order: 1,
      attempt: 1,
      stepId: stepId('t1', 'chunk', 1),
    });
    expect(s.events[0]).toMatchObject({
      id: '1:a',
      node: 'chunk',
      status: 'active',
      payload: {
        stepId: stepId('t1', 'chunk', 1),
        order: 1,
        attempt: 1,
        startedAt: '2025-10-09T08:53:20.000Z',
      },
    });
    expect(s.events[0]!.payload!.usage).toBeUndefined();
    expect(s.graph.steps.get(stepId('t1', 'chunk', 1))).toMatchObject({
      status: 'active',
      order: 1,
      finishedAt: null,
      usage: ZERO,
    });
  });

  it('numbers the steps in order and gives their events the ids of the stream contract', async () => {
    const s = setup();
    const a = await s.recorder.begin('t1', 'chunk');
    await s.recorder.complete(a, '3 chunks', ZERO);
    const b = await s.recorder.begin('t1', 'embed');
    s.recorder.progress(b, '1 of 3');
    s.recorder.progress(b, '2 of 3');
    await s.recorder.complete(b, '3 chunks embedded', USAGE, { chunks: 3 });
    expect(s.events.map((e) => e.id)).toEqual(['1:a', '1:z', '2:a', '2:a:1', '2:a:2', '2:z']);
    expect(b.order).toBe(2);
  });

  it('complete stores the step with its usage, sets lastCompletedStep, and puts the usage and counts in the event', async () => {
    const s = setup();
    const handle = await s.recorder.begin('t1', 'embed');
    s.clock.ms += 250;
    await s.recorder.complete(handle, '3 chunks embedded', USAGE, { chunks: 3 });
    expect(s.graph.steps.get(handle.stepId)).toMatchObject({
      status: 'complete',
      log: '3 chunks embedded',
      usage: USAGE,
      finishedAt: s.clock.ms,
    });
    expect(s.graph.task.lastCompletedStep).toBe('embed');
    expect(s.graph.log).toEqual([
      'addStep:active',
      'addStep:complete',
      'updateTask:lastCompletedStep',
    ]);
    const done = s.events.at(-1)!;
    expect(done).toMatchObject({ id: '1:z', status: 'complete', log: '3 chunks embedded' });
    expect(done.payload).toMatchObject({
      usage: USAGE,
      counts: { chunks: 3 },
      finishedAt: '2025-10-09T08:53:20.250Z',
    });
  });

  it('fail stores the error step with the usage spent so far and publishes it', async () => {
    const s = setup();
    const handle = await s.recorder.begin('t1', 'extractConcepts');
    await s.recorder.fail(
      handle,
      new CuratorStepError('extractConcepts', 'PROVIDER_UNAVAILABLE', 'down'),
      USAGE,
    );
    expect(s.graph.steps.get(handle.stepId)).toMatchObject({
      status: 'error',
      usage: USAGE,
      log: 'PROVIDER_UNAVAILABLE: down',
    });
    expect(s.graph.task.lastCompletedStep).toBeNull();
    expect(s.events.at(-1)).toMatchObject({
      id: '1:z',
      status: 'error',
      payload: { usage: USAGE },
    });
  });

  it('reuses an active or complete step of the current attempt (left by a crash or a re-run)', async () => {
    const s = setup();
    const first = await s.recorder.begin('t1', 'chunk');
    await s.recorder.complete(first, 'done', USAGE);
    const again = await s.recorder.begin('t1', 'chunk');
    expect(again.stepId).toBe(first.stepId);
    expect(again).toMatchObject({ order: 1, attempt: 1, startedAt: first.startedAt });
    expect(s.graph.steps.size).toBe(1);
    expect(s.graph.steps.get(first.stepId)!.status).toBe('active');
  });

  it('starts a new attempt, with a new step at the next position, only after an error step', async () => {
    const s = setup();
    const first = await s.recorder.begin('t1', 'embed');
    await s.recorder.fail(
      first,
      new CuratorStepError('embed', 'PROVIDER_UNAVAILABLE', 'down'),
      ZERO,
    );
    const second = await s.recorder.begin('t1', 'embed');
    expect(second.attempt).toBe(2);
    expect(second.order).toBe(2);
    expect(second.stepId).toBe(stepId('t1', 'embed', 2));
    expect(second.stepId).not.toBe(first.stepId);
    expect(s.graph.steps.size).toBe(2);
    expect(s.graph.steps.get(first.stepId)!.status).toBe('error');
    expect(s.events.at(-1)).toMatchObject({ id: '2:a', payload: { attempt: 2, order: 2 } });
  });

  describe('setTaskStatus and the terminal task event', () => {
    for (const [status, patch, expectedStatus] of [
      ['awaiting_review', { status: 'awaiting_review' }, 'complete'],
      ['done', { status: 'done', result: 'nothing_usable' }, 'complete'],
      ['failed', { status: 'failed', error: 'embed: PROVIDER_UNAVAILABLE: down' }, 'error'],
    ] as const) {
      it(`emits node "task" for ${status}`, async () => {
        const s = setup();
        const changed = await s.recorder.setTaskStatus('t1', ['in_progress'], patch);
        expect(changed).toBe(true);
        expect(s.events).toHaveLength(1);
        expect(s.events[0]).toMatchObject({
          id: `task:${status}`,
          node: 'task',
          status: expectedStatus,
          payload: { taskId: 't1', taskStatus: status },
        });
      });
    }

    it('carries the result, the last completed step, and the error in the payload', async () => {
      const s = setup();
      s.graph.task.lastCompletedStep = 'validate';
      await s.recorder.setTaskStatus('t1', ['in_progress'], {
        status: 'done',
        result: 'nothing_usable',
      });
      expect(s.events[0]!.payload).toMatchObject({
        result: 'nothing_usable',
        lastCompletedStep: 'validate',
        error: null,
      });
    });

    it('does not emit for in_progress, and not when the expected status did not match', async () => {
      const s = setup();
      expect(await s.recorder.setTaskStatus('t1', ['in_progress'], { status: 'in_progress' })).toBe(
        true,
      );
      expect(s.events).toHaveLength(0);
      expect(
        await s.recorder.setTaskStatus('t1', ['queued'], { status: 'failed', error: 'x' }),
      ).toBe(false);
      expect(s.events).toHaveLength(0);
    });
  });
});
