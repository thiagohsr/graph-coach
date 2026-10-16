import type { AgentEvent, StepDto } from '@coach/types';
import { describe, expect, it, vi } from 'vitest';
import {
  diagramSteps,
  initialPipelineState,
  logLines,
  pipelineReducer,
  type PipelineAction,
  type PipelineState,
} from './pipeline-state';

const T0 = '2026-10-15T10:00:00.000Z';

function step(
  node: string,
  stepId: string,
  order: number,
  status: AgentEvent['status'],
  log?: string,
  attempt = 1,
): AgentEvent {
  return {
    node,
    status,
    ...(log ? { log } : {}),
    payload: {
      stepId,
      order,
      attempt,
      startedAt: T0,
      ...(status !== 'active' ? { finishedAt: T0 } : {}),
    },
  };
}

function run(actions: PipelineAction[], from: PipelineState = initialPipelineState): PipelineState {
  return actions.reduce(pipelineReducer, from);
}

const stepEvent = (event: AgentEvent): PipelineAction => ({ type: 'STEP_EVENT', event });

describe('pipelineReducer', () => {
  it('upserts STEP_EVENT by stepId and orders the log by payload.order', () => {
    const state = run([
      stepEvent(step('embed', 's2', 2, 'active', 'embedding')),
      stepEvent(step('chunk', 's1', 1, 'active', 'splitting')),
      stepEvent(step('chunk', 's1', 1, 'complete', 'done chunking')),
    ]);
    expect(Object.keys(state.steps).sort()).toEqual(['s1', 's2']);
    expect(state.steps.s1?.status).toBe('complete');
    expect(logLines('ingest', state).map((l) => l.text)).toEqual([
      'Chunk: splitting',
      'Chunk: done chunking',
      'Embed: embedding',
    ]);
  });

  it('appends distinct log lines of one step and drops a repeated line', () => {
    const state = run([
      stepEvent(step('chunk', 's1', 1, 'active', 'one')),
      stepEvent(step('chunk', 's1', 1, 'active', 'two')),
      stepEvent(step('chunk', 's1', 1, 'active', 'two')),
    ]);
    expect(state.steps.s1?.lines).toEqual(['one', 'two']);
  });

  it('is unchanged by replaying the same events after a second OPENED', () => {
    const events = [
      stepEvent(step('chunk', 's1', 1, 'complete', 'chunked')),
      stepEvent(step('embed', 's2', 2, 'active', 'embedding')),
    ];
    const once = run([{ type: 'OPENED' }, ...events]);
    const twice = run([
      { type: 'OPENED' },
      ...events,
      { type: 'DROPPED' },
      { type: 'OPENED' },
      ...events,
    ]);
    expect(twice).toEqual(once);
  });

  it('keeps a second attempt of a node as a separate step and shows the latest in the diagram', () => {
    const state = run([
      stepEvent(step('draftQuestions', 's5', 5, 'complete', 'first')),
      stepEvent(step('draftQuestions', 's9', 9, 'active', 'second', 2)),
    ]);
    expect(Object.keys(state.steps)).toHaveLength(2);
    const draft = diagramSteps('ingest', state).find((s) => s.node === 'draftQuestions');
    expect(draft).toMatchObject({ status: 'active', stepId: 's9' });
    expect(logLines('ingest', state).map((l) => l.text)).toEqual([
      'Draft questions: first',
      'Draft questions (attempt 2): second',
    ]);
  });

  it('ignores a step event without a stepId', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const state = pipelineReducer(
      initialPipelineState,
      stepEvent({ node: 'chunk', status: 'active', payload: {} }),
    );
    expect(state).toBe(initialPipelineState);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('does not let a late active event undo a finished step', () => {
    const state = run([
      stepEvent(step('chunk', 's1', 1, 'complete')),
      stepEvent(step('chunk', 's1', 1, 'active')),
    ]);
    expect(state.steps.s1?.status).toBe('complete');
  });

  it('lists the seven ingest steps with unseen ones pending', () => {
    const state = run([
      stepEvent(step('chunk', 's1', 1, 'complete')),
      stepEvent(step('embed', 's2', 2, 'active')),
    ]);
    expect(diagramSteps('ingest', state).map((s) => `${s.node}:${s.status}`)).toEqual([
      'chunk:complete',
      'embed:active',
      'extractConcepts:pending',
      'linkPrerequisites:pending',
      'draftQuestions:pending',
      'validate:pending',
      'publish:pending',
    ]);
  });

  it('lists the six generate steps with their labels', () => {
    const items = diagramSteps('generate', initialPipelineState);
    expect(items.map((s) => s.label)).toEqual([
      'Plan',
      'Write',
      'Critique',
      'Rewrite',
      'Validate',
      'Publish',
    ]);
    expect(items.every((s) => s.status === 'pending')).toBe(true);
  });

  it('shows a refine step that had nothing to do as complete from its own event, and infers nothing for a step without one', () => {
    const state = run([
      stepEvent(step('outline', 's1', 1, 'complete')),
      stepEvent(step('draftQuestions', 's2', 2, 'complete')),
      stepEvent(step('refine', 's4', 4, 'complete', 'no draft was sent back')),
    ]);
    const items = diagramSteps('generate', state);
    expect(items.map((s) => `${s.label}:${s.status}`)).toEqual([
      'Plan:complete',
      'Write:complete',
      'Critique:pending', // no event of its own, so it stays pending even though a later step finished
      'Rewrite:complete',
      'Validate:pending',
      'Publish:pending',
    ]);
    expect(logLines('generate', state).map((l) => l.text)).toContain(
      'Rewrite: no draft was sent back',
    );
  });

  it('chooses the list from the task kind, not from the events that arrived', () => {
    const state = run([stepEvent(step('chunk', 's1', 1, 'complete'))]);
    // A generate task shows its own six steps; the stray ingest node is added by its order with the raw name.
    const items = diagramSteps('generate', state);
    expect(
      items.filter((s) =>
        ['outline', 'draftQuestions', 'critique', 'refine', 'validate', 'publish'].includes(s.node),
      ),
    ).toHaveLength(6);
    expect(items.find((s) => s.node === 'chunk')?.label).toBe('chunk');
    // An ingest task with no events shows its seven steps.
    expect(diagramSteps('ingest', initialPipelineState).map((s) => s.label)).toEqual([
      'Chunk',
      'Embed',
      'Extract concepts',
      'Link prerequisites',
      'Draft questions',
      'Validate',
      'Publish',
    ]);
  });

  it('places an unexpected node by its order, labelled with the raw name', () => {
    const state = run([
      stepEvent(step('chunk', 's1', 1, 'complete')),
      stepEvent(step('mystery', 's2', 2, 'active')),
      stepEvent(step('embed', 's3', 3, 'active')),
    ]);
    const items = diagramSteps('ingest', state);
    expect(items.map((s) => s.node).slice(0, 3)).toEqual(['chunk', 'mystery', 'embed']);
    expect(items[1]?.label).toBe('mystery');
  });

  it('reads taskStatus from TASK_EVENT and closes the transport', () => {
    const state = run([
      { type: 'OPENED' },
      {
        type: 'TASK_EVENT',
        event: { node: 'task', status: 'complete', payload: { taskStatus: 'awaiting_review' } },
      },
    ]);
    expect(state.taskStatus).toBe('awaiting_review');
    expect(state.transport).toBe('closed');
  });

  it('upserts SNAPSHOT steps by stepId so a snapshot followed by a replay has no duplicates', () => {
    const dto: StepDto[] = [
      {
        stepId: 's1',
        order: 1,
        node: 'chunk',
        status: 'complete',
        log: 'a\nb',
        startedAt: T0,
        finishedAt: T0,
      },
      { stepId: 's2', order: 2, node: 'embed', status: 'active', startedAt: T0 },
    ];
    const state = run([
      { type: 'SNAPSHOT', steps: dto },
      stepEvent(step('chunk', 's1', 1, 'complete', 'a')),
      stepEvent(step('chunk', 's1', 1, 'complete', 'b')),
      stepEvent(step('embed', 's2', 2, 'active')),
      { type: 'SNAPSHOT', steps: dto },
    ]);
    expect(Object.keys(state.steps)).toEqual(['s1', 's2']);
    expect(state.steps.s1?.lines).toEqual(['a', 'b']);
  });

  it('moves to reconnecting, then polling after three DROPPED in a row; OPENED resets the count', () => {
    let state = run([{ type: 'DROPPED' }]);
    expect(state).toMatchObject({ failures: 1, transport: 'reconnecting' });
    state = run([{ type: 'DROPPED' }, { type: 'DROPPED' }], state);
    expect(state).toMatchObject({ failures: 3, transport: 'polling' });
    state = run([{ type: 'OPENED' }], state);
    expect(state).toMatchObject({ failures: 0, transport: 'live' });
  });

  it('RESET returns the initial state', () => {
    const state = run([
      stepEvent(step('chunk', 's1', 1, 'active', 'x')),
      { type: 'DROPPED' },
      { type: 'RESET' },
    ]);
    expect(state).toEqual(initialPipelineState);
  });
});

describe('a run with a top-up round (reconciliation N)', () => {
  const firstPass = [
    stepEvent(step('outline', 'a1', 1, 'complete', '5 concepts')),
    stepEvent(step('draftQuestions', 'a2', 2, 'complete', '7 drafts')),
    stepEvent(step('critique', 'a3', 3, 'complete', '7 reviewed')),
    stepEvent(step('refine', 'a4', 4, 'complete', 'Nothing to rewrite')),
    stepEvent(step('validate', 'a5', 5, 'complete', '3 drafts kept, 4 discarded (no_blank 4)')),
  ];
  const statusOf = (state: PipelineState, node: string) =>
    diagramSteps('generate', state).find((i) => i.node === node)?.status;

  it('shows no "Top up" item in a run that did not use one', () => {
    const state = run(firstPass);
    expect(diagramSteps('generate', state).map((i) => i.label)).not.toContain('Top up');
  });

  it('adds "Top up" between Validate and Publish once a round starts, active while the round runs', () => {
    const state = run([
      ...firstPass,
      stepEvent(step('topUp', 'b1', 6, 'active', 'Round 1: asking for 2 (2 new)')),
    ]);
    expect(diagramSteps('generate', state).map((i) => i.label)).toEqual([
      'Plan',
      'Write',
      'Critique',
      'Rewrite',
      'Validate',
      'Top up',
      'Publish',
    ]);
    expect(statusOf(state, 'topUp')).toBe('active');
  });

  it('does not turn a completed first-pass step back to active when the round re-runs critique and validate', () => {
    const state = run([
      ...firstPass,
      stepEvent(step('topUp', 'b1', 6, 'complete', 'Round 1: asking for 2 (2 new), 2 drafted')),
      stepEvent(step('critique', 'b2', 7, 'active', 'Top-up round 1: reviewing')),
      stepEvent(step('validate', 'b4', 9, 'active')),
    ]);
    expect(state.steps.a3?.status).toBe('complete');
    expect(state.steps.a5?.status).toBe('complete');
    expect(statusOf(state, 'critique')).toBe('complete');
    expect(statusOf(state, 'validate')).toBe('complete');
    expect(statusOf(state, 'topUp')).toBe('active');
  });

  it('completes "Top up" when the round validate completes and keeps both rounds in the log', () => {
    const state = run([
      ...firstPass,
      stepEvent(step('topUp', 'b1', 6, 'complete', 'Round 1: asking for 2 (2 new), 2 drafted')),
      stepEvent(step('critique', 'b2', 7, 'complete', 'Top-up round 1: 2 reviewed: 2 passed')),
      stepEvent(step('refine', 'b3', 8, 'complete', 'Top-up round 1: Nothing to rewrite')),
      stepEvent(step('validate', 'b4', 9, 'complete', 'Top-up round 1: asked for 2, kept 2')),
    ]);
    expect(statusOf(state, 'topUp')).toBe('complete');
    const texts = logLines('generate', state).map((l) => l.text);
    expect(texts).toContain('Validate: Top-up round 1: asked for 2, kept 2');
    expect(texts).toContain('Top up: Round 1: asking for 2 (2 new), 2 drafted');
    // Not shown as attempt 2: a repeated node is only a new attempt after an error.
    expect(texts.every((t) => !t.includes('attempt'))).toBe(true);
  });

  it('shows "Top up" as error when a round step fails', () => {
    const state = run([
      ...firstPass,
      stepEvent(step('topUp', 'b1', 6, 'error', 'INVALID_MODEL_OUTPUT: bad')),
    ]);
    expect(statusOf(state, 'topUp')).toBe('error');
    expect(statusOf(state, 'validate')).toBe('complete');
  });

  it('does not count a top-up round as a second attempt when it arrives in a snapshot', () => {
    const dto: StepDto[] = [
      { stepId: 'a3', order: 3, node: 'critique', status: 'complete', startedAt: T0 },
      { stepId: 'b1', order: 4, node: 'topUp', status: 'complete', startedAt: T0 },
      { stepId: 'b2', order: 5, node: 'critique', status: 'complete', log: 'x', startedAt: T0 },
    ];
    const state = run([{ type: 'SNAPSHOT', steps: dto }]);
    expect(state.steps.b2?.attempt).toBe(1);
    expect(logLines('generate', state).map((l) => l.text)).toContain('Critique: x');
  });
});
