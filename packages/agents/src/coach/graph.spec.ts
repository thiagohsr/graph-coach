import { describe, expect, it } from 'vitest';
import { StubEmbeddingsProvider } from '../llm/stub';
import { ZERO_USAGE } from '../llm/usage';
import type { CoachDeps } from './deps';
import { DecisionNotRecordedError, EvidenceMissingError, LearnerNotFoundError } from './errors';
import {
  buildCoachGraph,
  routeAfterCheckRecent,
  routeAfterCollectSignals,
  routeAfterFindPuzzles,
  runCoach,
} from './graph';
import { DEFAULT_COACH_SETTINGS } from './settings';
import {
  T,
  WORKED_IDS,
  createRecordingTracer,
  createStubCoachQueries,
  workedExampleRows,
  type StubCoachQueries,
} from './testing/stubs';

class GraphUnavailableError extends Error {
  constructor() {
    super('FalkorDB is unreachable');
    this.name = 'GraphUnavailableError';
  }
}

const input = { learnerId: WORKED_IDS.learner, goalText: null, now: T };

function makeDeps(queries: StubCoachQueries, over: Partial<CoachDeps> = {}): CoachDeps {
  return { queries, settings: DEFAULT_COACH_SETTINGS, newId: () => 'run-1', embeddings: new StubEmbeddingsProvider(), ...over };
}

const reusable = (over = {}) => ({
  masteryCount: 13,
  decisionId: 'old-decision',
  createdAt: T - 60_000,
  newAnswers: false,
  goalText: null,
  ...over,
});

describe('runCoach, worked example', () => {
  it('records a decision with the expected parameters', async () => {
    const queries = createStubCoachQueries();
    const result = await runCoach(makeDeps(queries), input);
    expect(result).toEqual({ outcome: 'recorded', decisionId: 'run-1', coverageTaskId: null });
    expect(queries.recorded).toHaveLength(1);
    const params = queries.recorded[0]!;
    expect(params).toMatchObject({
      decisionId: 'run-1',
      learnerId: WORKED_IDS.learner,
      kind: 'recommendation',
      flags: ['prerequisite_first'],
      now: T,
      modelCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      embeddingTokens: 0,
      puzzleId: WORKED_IDS.storagePuzzle,
      goalId: '',
    });
    expect(params.summary).toContain('"B-trees"');
    expect(params.evidence[0]).toMatchObject({ nodeId: WORKED_IDS.btrees, role: 'target', weight: 0.723 });
    expect(params.evidence[1]).toMatchObject({ nodeId: WORKED_IDS.indexes, role: 'driver' });
    expect(params.evidence.filter((e) => e.role === 'answer')).toHaveLength(5);
    expect(params.evidence.filter((e) => e.role === 'session')).toHaveLength(3);
  });

  it('passes the documented parameters to the signal queries', async () => {
    const queries = createStubCoachQueries();
    await runCoach(makeDeps(queries), input);
    expect(queries.callsTo('recentDecision')[0]!.params).toEqual({ learnerId: WORKED_IDS.learner, since: T - 10 * 60_000 });
    expect(queries.callsTo('weakConceptsWithWeakPrereqs')[0]!.params).toEqual({
      learnerId: WORKED_IDS.learner, now: T, decayDays: 14, threshold: 0.5, depth: 4, scopeIds: [],
    });
    expect(queries.callsTo('playablePuzzlesCovering')[0]!.params).toEqual({
      userId: WORKED_IDS.learner, targetIds: [WORKED_IDS.btrees], recentSince: T - 3 * 86_400_000, limit: 20,
    });
    expect(queries.callsTo('decayedOrUnseenConcepts')).toHaveLength(0);
    expect(queries.callsTo('introPuzzles')).toHaveLength(0);
  });

  it('gives identical parameters over 20 runs (SC-C01, SC-C04)', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      const queries = createStubCoachQueries();
      await runCoach(makeDeps(queries), input);
      seen.add(JSON.stringify(queries.recorded[0]));
    }
    expect(seen.size).toBe(1);
  });

  it('needs no chat model and stores zero usage (the template path)', async () => {
    const queries = createStubCoachQueries();
    await runCoach(makeDeps(queries), input);
    const p = queries.recorded[0]!;
    expect({ modelCalls: p.modelCalls, inputTokens: p.inputTokens, outputTokens: p.outputTokens, embeddingTokens: p.embeddingTokens }).toEqual(ZERO_USAGE);
  });

  it('sets repeat and coverage_gap flags from the first puzzle row', async () => {
    const rows = workedExampleRows();
    const queries = createStubCoachQueries({
      playablePuzzlesCovering: async () => [{ ...rows.puzzles[1]! }],
    });
    await runCoach(makeDeps(queries), input);
    expect(queries.recorded[0]!.flags).toEqual(['coverage_gap', 'prerequisite_first', 'repeat']);
    expect(queries.recorded[0]!.puzzleId).toBe(WORKED_IDS.indexesPuzzle);
  });
});

describe('runCoach, reuse', () => {
  it('a reusable recent decision ends reused and calls no other query', async () => {
    const queries = createStubCoachQueries({ recentDecision: async () => reusable() });
    const result = await runCoach(makeDeps(queries), input);
    expect(result).toEqual({ outcome: 'reused', decisionId: 'old-decision', coverageTaskId: null });
    expect(queries.calls.map((c) => c.name)).toEqual(['recentDecision']);
  });

  it('new answers, a changed goal, or a zero reuse window prevent reuse', async () => {
    const newAnswers = createStubCoachQueries({ recentDecision: async () => reusable({ newAnswers: true }) });
    expect((await runCoach(makeDeps(newAnswers), input)).outcome).toBe('recorded');

    const changedGoal = createStubCoachQueries({ recentDecision: async () => reusable() });
    expect((await runCoach(makeDeps(changedGoal), { ...input, goalText: 'learn indexes' })).outcome).toBe('recorded');

    const sameGoal = createStubCoachQueries({ recentDecision: async () => reusable({ goalText: 'Learn  Indexes' }) });
    expect((await runCoach(makeDeps(sameGoal), { ...input, goalText: ' learn indexes ' })).outcome).toBe('reused');

    const noReuse = createStubCoachQueries({ recentDecision: async () => reusable() });
    const deps = makeDeps(noReuse, { settings: { ...DEFAULT_COACH_SETTINGS, coachReuseMinutes: 0 } });
    expect((await runCoach(deps, input)).outcome).toBe('recorded');
  });

  it('a missing Learner node throws LearnerNotFoundError', async () => {
    const queries = createStubCoachQueries({ recentDecision: async () => null });
    await expect(runCoach(makeDeps(queries), input)).rejects.toBeInstanceOf(LearnerNotFoundError);
  });
});

describe('runCoach, failures', () => {
  it('a graph error propagates and nothing is recorded', async () => {
    const queries = createStubCoachQueries({
      weakConceptsWithWeakPrereqs: async () => {
        throw new GraphUnavailableError();
      },
    });
    await expect(runCoach(makeDeps(queries), input)).rejects.toThrow(GraphUnavailableError);
    expect(queries.callsTo('recordDecision')).toHaveLength(0);
  });

  it('record_decision returning no row throws DecisionNotRecordedError', async () => {
    const queries = createStubCoachQueries({ recordDecision: async () => null });
    await expect(runCoach(makeDeps(queries), input)).rejects.toBeInstanceOf(DecisionNotRecordedError);
  });

  it('a puzzle that was not linked, or no BECAUSE edge, is DecisionNotRecordedError', async () => {
    const unlinked = createStubCoachQueries({
      recordDecision: async (p) => ({ decisionId: p.decisionId, becauseCount: 3, linkedPuzzle: false }),
    });
    await expect(runCoach(makeDeps(unlinked), input)).rejects.toBeInstanceOf(DecisionNotRecordedError);
    const none = createStubCoachQueries({
      recordDecision: async (p) => ({ decisionId: p.decisionId, becauseCount: 0, linkedPuzzle: true }),
    });
    await expect(runCoach(makeDeps(none), input)).rejects.toBeInstanceOf(DecisionNotRecordedError);
  });

  it('exports EvidenceMissingError for the empty-evidence refusal', () => {
    expect(new EvidenceMissingError().name).toBe('EvidenceMissingError');
  });
});

describe('runCoach, usage-only tracing', () => {
  it('opens one run, one step per executed node, ends ok, never records a call, and hands over no text', async () => {
    const tracer = createRecordingTracer();
    const queries = createStubCoachQueries();
    await runCoach(makeDeps(queries, { tracer }), { ...input, goalText: 'learn about storage engines' });
    expect(tracer.callsTo('startRun')).toHaveLength(1);
    expect(tracer.callsTo('startRun')[0]!.args).toEqual([{ id: 'run-1', kind: 'coach', userId: WORKED_IDS.learner }]);
    const nodes = ['resolveGoal', 'collectSignals', 'selectTarget', 'findPuzzles', 'explain', 'recordDecision'];
    expect(tracer.callsTo('startStep').map((c) => c.args[1])).toEqual(nodes);
    expect(tracer.callsTo('endStep')).toHaveLength(nodes.length);
    expect(tracer.callsTo('endRun')).toHaveLength(1);
    expect(tracer.callsTo('endRun')[0]!.args[1]).toEqual({ ok: true });
    expect(tracer.callsTo('recordCall')).toHaveLength(0);
    const text = JSON.stringify(tracer.calls);
    for (const forbidden of ['B-trees', 'Indexes', 'Databases 101', 'storage engines', 'Practise', queries.recorded[0]!.summary]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('a reused decision opens no run', async () => {
    const tracer = createRecordingTracer();
    const queries = createStubCoachQueries({ recentDecision: async () => reusable() });
    await runCoach(makeDeps(queries, { tracer }), input);
    expect(tracer.calls).toEqual([]);
  });

  it('closes the run with ok false when a node throws', async () => {
    const tracer = createRecordingTracer();
    const queries = createStubCoachQueries({ recordDecision: async () => null });
    await expect(runCoach(makeDeps(queries, { tracer }), input)).rejects.toBeInstanceOf(DecisionNotRecordedError);
    expect(tracer.callsTo('endRun')[0]!.args[1]).toEqual({ ok: false });
  });

  it('a tracer that throws on every call changes neither the outcome nor the stored usage', async () => {
    const tracer = createRecordingTracer();
    tracer.failWith = new Error('tracer is down');
    const warnings: string[] = [];
    const queries = createStubCoachQueries();
    const result = await runCoach(
      makeDeps(queries, { tracer, logger: { warn: (event) => void warnings.push(event) } }),
      input,
    );
    expect(result.outcome).toBe('recorded');
    const baseline = createStubCoachQueries();
    await runCoach(makeDeps(baseline), input);
    expect(queries.recorded[0]).toEqual(baseline.recorded[0]);
    expect(warnings).toContain('coach.tracer_failed');
  });
});

describe('routers', () => {
  const state = (over: Record<string, unknown>) => over as never;
  it('route after checkRecent, collectSignals, and findPuzzles', () => {
    expect(routeAfterCheckRecent(state({ outcome: 'reused' }))).toBe('reuse');
    expect(routeAfterCheckRecent(state({ outcome: null }))).toBe('collectSignals');
    expect(routeAfterCollectSignals(state({ recent: { masteryCount: 0 } }))).toBe('coldStart');
    expect(routeAfterCollectSignals(state({ recent: { masteryCount: 3 } }))).toBe('select');
    expect(routeAfterFindPuzzles(state({ puzzle: null, selection: null }))).toBe('noContent');
    expect(routeAfterFindPuzzles(state({ puzzle: null, selection: {} }))).toBe('explain');
  });

  it('drops a cyclic row and logs coach.prerequisite_cycle with the concept id only (T068)', async () => {
    const rows = workedExampleRows();
    const warnings: Array<[string, object | undefined]> = [];
    const queries = createStubCoachQueries({
      weakConceptsWithWeakPrereqs: async () => rows.weak.map((w) => (w.conceptId === WORKED_IDS.indexes ? { ...w, cyclic: true } : w)),
    });
    const result = await runCoach(makeDeps(queries, { logger: { warn: (e, d) => void warnings.push([e, d]) } }), input);
    expect(result.outcome).toBe('recorded');
    expect(warnings).toEqual([['coach.prerequisite_cycle', { conceptId: WORKED_IDS.indexes }]]);
  });

  it('builds a graph that can be invoked twice', async () => {
    const graph = buildCoachGraph(makeDeps(createStubCoachQueries()));
    expect((await graph.invoke(input)).outcome).toBe('recorded');
    expect((await graph.invoke(input)).outcome).toBe('recorded');
  });
});
