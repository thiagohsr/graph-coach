// The goal stretch of the Coach graph (T056): resolveGoal, scope, coverage requests, usage. Stub queries and embeddings.
import { describe, expect, it, vi } from 'vitest';
import { ProviderUnavailableError } from '../llm/errors';
import { StubEmbeddingsProvider, stubTokens } from '../llm/stub';
import type { EmbeddingsProvider } from '../llm/types';
import type { CoachDeps } from './deps';
import { coverTaskId, goalId } from './ids';
import { buildCoachGraph, routeAfterCheckRecent, routeAfterRecordDecision, runCoach } from './graph';
import type { GoalConceptRow, PuzzleRow } from './rows';
import { DEFAULT_COACH_SETTINGS } from './settings';
import {
  T,
  WORKED_IDS,
  createRecordingTracer,
  createStubCoachQueries,
  workedExampleRows,
  type StubCoachQueries,
} from './testing/stubs';

const GOAL = 'Learn Zeta  widgets';
const input = { learnerId: WORKED_IDS.learner, goalText: GOAL, now: T };

const ZETA = 'c-zeta';
const nameRow = (over: Partial<GoalConceptRow> = {}): GoalConceptRow => ({
  conceptId: ZETA,
  slug: 'zeta',
  name: 'Zeta',
  score: 1,
  bestChunkId: null,
  via: 'name',
  ...over,
});

const allowed = () => Promise.resolve({ allowed: true as const });
const refused = (reason: 'no_allowance' | 'paused' | 'hourly_limit') => () => Promise.resolve({ allowed: false as const, reason });

function makeDeps(queries: StubCoachQueries, over: Partial<CoachDeps> = {}): CoachDeps {
  return {
    queries,
    settings: DEFAULT_COACH_SETTINGS,
    newId: () => 'run-1',
    embeddings: new StubEmbeddingsProvider(),
    coverageAllowance: allowed,
    ...over,
  };
}

/** The worked example plus a goal concept `Zeta`: the first puzzle query (the target) answers as usual; the goal query covers nothing. */
function goalQueries(over: Parameters<typeof createStubCoachQueries>[0] = {}): StubCoachQueries {
  const rows = workedExampleRows();
  return createStubCoachQueries({
    resolveGoalConcepts: async () => [nameRow()],
    playablePuzzlesCovering: async (p) =>
      p.targetIds.includes(ZETA) ? ([] as PuzzleRow[]) : rows.puzzles,
    ...over,
  });
}

describe('resolveGoal', () => {
  it('embeds the goal, queries with the documented parameters, and upserts a deterministic goal', async () => {
    const queries = goalQueries();
    const embeddings = new StubEmbeddingsProvider(64);
    await runCoach(makeDeps(queries, { embeddings }), input);

    expect(embeddings.calls).toEqual([{ texts: ['Learn Zeta  widgets'] }]);
    const [call] = queries.callsTo('resolveGoalConcepts');
    expect(call!.params).toEqual({
      userId: WORKED_IDS.learner,
      embedding: (await new StubEmbeddingsProvider(64).embed([GOAL])).vectors[0],
      k: 20,
      minSimilarity: 0.5,
      goalText: 'learn zeta widgets',
      goalSlugText: 'learn-zeta-widgets',
      limit: 20,
    });
    const [upsert] = queries.callsTo('upsertGoal');
    expect(upsert!.params).toEqual({
      goalId: goalId(WORKED_IDS.learner, 'learn zeta widgets'),
      learnerId: WORKED_IDS.learner,
      text: GOAL,
      now: T,
      targets: [{ conceptId: ZETA, score: 1 }],
      depth: 4,
    });
    expect(queries.recorded[0]!.goalId).toBe(goalId(WORKED_IDS.learner, 'learn zeta widgets'));
  });

  it('passes the scope (targets plus prerequisites) to the signal queries', async () => {
    const queries = goalQueries({
      upsertGoal: async (p) => ({ goalId: p.goalId, targetIds: [ZETA], prerequisiteIds: ['c-zz', 'c-aa'] }),
    });
    await runCoach(makeDeps(queries), input);
    expect((queries.callsTo('weakConceptsWithWeakPrereqs')[0]!.params as { scopeIds: string[] }).scopeIds).toEqual([ZETA, 'c-aa', 'c-zz']);

    // tier 2 and 3 use the same scope
    const empty = goalQueries({ weakConceptsWithWeakPrereqs: async () => [], decayedOrUnseenConcepts: async () => [] });
    await runCoach(makeDeps(empty), input);
    const decayed = empty.callsTo('decayedOrUnseenConcepts');
    expect(decayed).toHaveLength(2);
    for (const c of decayed) expect((c.params as { scopeIds: string[] }).scopeIds).toEqual([ZETA]);
  });

  it('an unmatched goal sets goal_unmatched, is still stored, and behaves as no goal', async () => {
    const queries = createStubCoachQueries();
    const result = await runCoach(makeDeps(queries), input);
    expect(result.outcome).toBe('recorded');
    const recorded = queries.recorded[0]!;
    expect(recorded.flags).toContain('goal_unmatched');
    expect(recorded.flags).toContain('prerequisite_first');
    expect(recorded.summary).toContain('No concept matches your goal');
    expect(recorded.kind).toBe('recommendation');
    // the goal is written with no targets, linked to the decision, and the candidate queries are unscoped
    expect((queries.callsTo('upsertGoal')[0]!.params as { targets: unknown[] }).targets).toEqual([]);
    expect(recorded.goalId).toBe(goalId(WORKED_IDS.learner, 'learn zeta widgets'));
    expect((queries.callsTo('weakConceptsWithWeakPrereqs')[0]!.params as { scopeIds: string[] }).scopeIds).toEqual([]);
    expect(queries.callsTo('playablePuzzlesCovering')).toHaveLength(1);
    expect(queries.callsTo('createCoverTask')).toHaveLength(0);
    expect(result.coverageTaskId).toBeNull();
  });

  it('merges rows per concept and keeps the highest score; only passage rows give passage evidence', async () => {
    const queries = goalQueries({
      resolveGoalConcepts: async () => [
        nameRow({ conceptId: 'c-bt', slug: 'b-trees', name: 'B-trees', score: 1, via: 'name' }),
        nameRow({ conceptId: 'c-bt', slug: 'b-trees', name: 'B-trees', score: 0.82, bestChunkId: 'chunk-1', via: 'passage' }),
        nameRow({ conceptId: 'c-ix', slug: 'indexes', name: 'Indexes', score: 1, via: 'name' }),
      ],
    });
    await runCoach(makeDeps(queries), input);
    const targets = (queries.callsTo('upsertGoal')[0]!.params as { targets: Array<{ conceptId: string; score: number }> }).targets;
    // highest score per concept (the name match beats the 0.82 passage); ties by name
    expect(targets).toEqual([
      { conceptId: 'c-bt', score: 1 },
      { conceptId: 'c-ix', score: 1 },
    ]);
    const passages = queries.recorded[0]!.evidence.filter((e) => e.role === 'passage');
    expect(passages).toEqual([
      { label: 'Chunk', nodeId: 'chunk-1', role: 'passage', reason: 'matched the goal (similarity 0.82)', weight: 0.41 },
    ]);

    const nameOnly = goalQueries();
    await runCoach(makeDeps(nameOnly), input);
    expect(nameOnly.recorded[0]!.evidence.filter((e) => e.role === 'passage')).toEqual([]);
  });

  it('no goal text means no embedding call and no goal queries', async () => {
    const embeddings = new StubEmbeddingsProvider();
    const queries = createStubCoachQueries();
    await runCoach(makeDeps(queries, { embeddings }), { ...input, goalText: null });
    await runCoach(makeDeps(queries, { embeddings }), { ...input, goalText: '   ' });
    expect(embeddings.calls).toEqual([]);
    expect(queries.callsTo('resolveGoalConcepts')).toHaveLength(0);
    expect(queries.callsTo('upsertGoal')).toHaveLength(0);
    expect(queries.recorded.every((r) => r.goalId === '')).toBe(true);
  });

  it('a goal with no candidate in its scope targets the goal concept', async () => {
    const queries = goalQueries({
      weakConceptsWithWeakPrereqs: async () => [],
      decayedOrUnseenConcepts: async () => [],
      playablePuzzlesCovering: async () => [],
    });
    const result = await runCoach(makeDeps(queries), input);
    expect(result.outcome).toBe('recorded');
    const recorded = queries.recorded[0]!;
    expect(recorded.evidence[0]).toMatchObject({ nodeId: ZETA, role: 'target', reason: 'target: concept of your goal' });
    expect(recorded.summary).toContain('Your goal points to "Zeta"');
  });

  it('routes to resolveGoal only for a non-blank goal that is not reused', () => {
    const base = { outcome: null } as never;
    expect(routeAfterCheckRecent({ ...(base as object), goalText: 'learn x', outcome: null } as never)).toBe('resolveGoal');
    expect(routeAfterCheckRecent({ ...(base as object), goalText: '  ', outcome: null } as never)).toBe('collectSignals');
    expect(routeAfterCheckRecent({ ...(base as object), goalText: null, outcome: null } as never)).toBe('collectSignals');
    expect(routeAfterCheckRecent({ ...(base as object), goalText: 'learn x', outcome: 'reused' } as never)).toBe('reuse');
  });

  it('reuse is skipped when the goal text changes and kept when only spacing and case differ', async () => {
    const recent = (goalText: string | null) => async () => ({
      masteryCount: 13,
      decisionId: 'old-decision',
      createdAt: T - 60_000,
      newAnswers: false,
      goalText,
    });
    const changed = goalQueries({ recentDecision: recent('learn something else') });
    expect((await runCoach(makeDeps(changed), input)).outcome).toBe('recorded');
    expect(changed.callsTo('resolveGoalConcepts')).toHaveLength(1);

    const embeddings = new StubEmbeddingsProvider();
    const same = goalQueries({ recentDecision: recent('learn zeta WIDGETS') });
    expect((await runCoach(makeDeps(same, { embeddings }), input)).outcome).toBe('reused');
    expect(embeddings.calls).toEqual([]);
    expect(same.calls.map((c) => c.name)).toEqual(['recentDecision']);

    const goalDropped = goalQueries({ recentDecision: recent('learn zeta widgets') });
    expect((await runCoach(makeDeps(goalDropped), { ...input, goalText: null })).outcome).toBe('recorded');
  });
});

describe('requestCoverage and the allowance', () => {
  it('with an allowed check, create_cover_task runs after record_decision and the flag is set', async () => {
    const queries = goalQueries();
    const coverageAllowance = vi.fn(allowed);
    const result = await runCoach(makeDeps(queries, { coverageAllowance }), input);

    const order = queries.calls.map((c) => c.name);
    expect(order.indexOf('createCoverTask')).toBeGreaterThan(order.indexOf('recordDecision'));
    expect(order.filter((n) => n === 'createCoverTask')).toHaveLength(1);
    expect(queries.callsTo('createCoverTask')[0]!.params).toEqual({
      taskId: coverTaskId(WORKED_IDS.learner, [ZETA]),
      learnerId: WORKED_IDS.learner,
      decisionId: 'run-1',
      conceptIds: [ZETA],
      now: T,
    });
    const recorded = queries.recorded[0]!;
    expect(recorded.flags).toEqual(expect.arrayContaining(['coverage_requested', 'coverage_gap']));
    expect(recorded.flags).not.toContain('coverage_not_requested');
    expect(recorded.kind).toBe('recommendation');
    expect(recorded.summary).toContain('No puzzle covers "Zeta" yet, so I requested new puzzles for it.');
    expect(result).toEqual({ outcome: 'recorded', decisionId: 'run-1', coverageTaskId: coverTaskId(WORKED_IDS.learner, [ZETA]) });
    // the allowance is only ever read: one call, no arguments
    expect(coverageAllowance).toHaveBeenCalledTimes(1);
    expect(coverageAllowance).toHaveBeenCalledWith();
  });

  it.each([
    ['no_allowance', 'no puzzle-creation allowance left'],
    ['paused', 'puzzle creation is paused'],
    ['hourly_limit', 'hourly limit'],
  ] as const)('with %s no task is created, the flags say so, and the summary names the reason', async (reason, phrase) => {
    const queries = goalQueries();
    const coverageAllowance = vi.fn(refused(reason));
    const result = await runCoach(makeDeps(queries, { coverageAllowance }), input);
    expect(queries.callsTo('createCoverTask')).toHaveLength(0);
    const recorded = queries.recorded[0]!;
    expect(recorded.flags).toEqual(expect.arrayContaining(['coverage_not_requested', 'coverage_gap']));
    expect(recorded.flags).not.toContain('coverage_requested');
    expect(recorded.kind).toBe('recommendation');
    expect(recorded.summary).toContain(phrase);
    expect(result.coverageTaskId).toBeNull();
    expect(coverageAllowance).toHaveBeenCalledTimes(1);
  });

  it('a missing coverageAllowance behaves as no allowance', async () => {
    const queries = goalQueries();
    await runCoach(makeDeps(queries, { coverageAllowance: undefined }), input);
    expect(queries.callsTo('createCoverTask')).toHaveLength(0);
    expect(queries.recorded[0]!.flags).toContain('coverage_not_requested');
  });

  it('no puzzle plus an allowed task gives kind coverage_request and no RECOMMENDED puzzle', async () => {
    const queries = goalQueries({ playablePuzzlesCovering: async () => [], introPuzzles: async () => [] });
    const result = await runCoach(makeDeps(queries), input);
    const recorded = queries.recorded[0]!;
    expect(recorded.kind).toBe('coverage_request');
    expect(recorded.puzzleId).toBe('');
    expect(recorded.flags).toEqual(expect.arrayContaining(['no_puzzle', 'coverage_gap', 'coverage_requested']));
    expect(result.coverageTaskId).not.toBeNull();
  });

  it('no puzzle and a refusal stays a recommendation', async () => {
    const queries = goalQueries({ playablePuzzlesCovering: async () => [], introPuzzles: async () => [] });
    await runCoach(makeDeps(queries, { coverageAllowance: refused('paused') }), input);
    expect(queries.recorded[0]!.kind).toBe('recommendation');
    expect(queries.callsTo('createCoverTask')).toHaveLength(0);
  });

  it('a goal whose concepts are all covered requests nothing and reads no allowance', async () => {
    const rows = workedExampleRows();
    const coverageAllowance = vi.fn(allowed);
    const queries = goalQueries({
      playablePuzzlesCovering: async (p) =>
        p.targetIds.includes(ZETA) ? [{ ...rows.puzzles[0]!, coveredTargetIds: [ZETA] }] : rows.puzzles,
    });
    await runCoach(makeDeps(queries, { coverageAllowance }), input);
    expect(coverageAllowance).not.toHaveBeenCalled();
    expect(queries.callsTo('createCoverTask')).toHaveLength(0);
    expect(queries.recorded[0]!.flags).not.toContain('coverage_requested');
    expect(queries.recorded[0]!.flags).not.toContain('coverage_gap');
  });

  it('without a goal no second puzzle query and no allowance read happen', async () => {
    const coverageAllowance = vi.fn(allowed);
    const queries = createStubCoachQueries();
    await runCoach(makeDeps(queries, { coverageAllowance }), { ...input, goalText: null });
    expect(queries.callsTo('playablePuzzlesCovering')).toHaveLength(1);
    expect(coverageAllowance).not.toHaveBeenCalled();
  });

  it('routeAfterRecordDecision requests coverage only for coverage_requested with missing concepts', () => {
    expect(routeAfterRecordDecision({ flags: ['coverage_requested'], missingConceptIds: ['c'] } as never)).toBe('requestCoverage');
    expect(routeAfterRecordDecision({ flags: ['coverage_not_requested'], missingConceptIds: ['c'] } as never)).toBe('end');
    expect(routeAfterRecordDecision({ flags: [], missingConceptIds: [] } as never)).toBe('end');
  });

  it('a cover task the graph refuses to link fails the run', async () => {
    const queries = goalQueries({ createCoverTask: async () => null });
    await expect(runCoach(makeDeps(queries), input)).rejects.toMatchObject({ name: 'DecisionNotRecordedError' });
  });
});

describe('goal usage and tracing', () => {
  it('embeds with label and trace, reads vectors[0], and stores one model call of embedding tokens only', async () => {
    const tracer = createRecordingTracer();
    const stub = new StubEmbeddingsProvider(64, { tracer });
    const seen: Array<{ label?: string; trace?: unknown }> = [];
    const embeddings: EmbeddingsProvider = {
      name: stub.name,
      model: stub.model,
      dimension: stub.dimension,
      embed: (texts, options) => {
        seen.push({ ...(options?.label ? { label: options.label } : {}), trace: options?.trace });
        return stub.embed(texts, options);
      },
    };
    const queries = goalQueries();
    await runCoach(makeDeps(queries, { embeddings, tracer }), input);

    expect(seen).toHaveLength(1);
    expect(seen[0]!.label).toBe('coach.resolveGoal');
    expect(seen[0]!.trace).toMatchObject({ node: 'resolveGoal' });
    expect(queries.recorded[0]).toMatchObject({
      modelCalls: 1,
      inputTokens: 0,
      outputTokens: 0,
      embeddingTokens: stubTokens(GOAL),
    });
    // the provider reports its own call under the resolveGoal step; the Coach never records one
    expect(tracer.callsTo('recordCall')).toHaveLength(1);
    expect(tracer.callsTo('startStep').map((c) => c.args[1])).toContain('resolveGoal');
    expect(JSON.stringify(tracer.calls)).not.toContain('Zeta');
  });

  it('uses the first vector the provider returns', async () => {
    const vector = new Array<number>(64).fill(0);
    vector[3] = 1;
    const embeddings: EmbeddingsProvider = {
      name: 'stub',
      model: 'fixed',
      dimension: 64,
      embed: async () => ({
        vectors: [vector],
        usage: { modelCalls: 1, inputTokens: 0, outputTokens: 0, embeddingTokens: 7 },
        usageReported: true,
      }),
    };
    const queries = goalQueries();
    await runCoach(makeDeps(queries, { embeddings }), input);
    expect((queries.callsTo('resolveGoalConcepts')[0]!.params as { embedding: number[] }).embedding).toEqual(vector);
    expect(queries.recorded[0]!.embeddingTokens).toBe(7);
  });

  it('a failing embeddings provider fails the run and records nothing', async () => {
    const embeddings: EmbeddingsProvider = {
      name: 'stub',
      model: 'down',
      dimension: 64,
      embed: async () => {
        throw new ProviderUnavailableError('down', { provider: 'stub' });
      },
    };
    const queries = goalQueries();
    await expect(runCoach(makeDeps(queries, { embeddings }), input)).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(queries.callsTo('recordDecision')).toHaveLength(0);
    expect(queries.callsTo('upsertGoal')).toHaveLength(0);
  });

  it('a missing embeddings provider fails a run that has a goal, not one without', async () => {
    const queries = goalQueries();
    await expect(runCoach(makeDeps(queries, { embeddings: undefined }), input)).rejects.toBeInstanceOf(ProviderUnavailableError);
    const plain = createStubCoachQueries();
    await expect(runCoach(makeDeps(plain, { embeddings: undefined }), { ...input, goalText: null })).resolves.toMatchObject({ outcome: 'recorded' });
  });

  it('the graph still builds and invokes through buildCoachGraph', async () => {
    const queries = goalQueries();
    const state = await buildCoachGraph(makeDeps(queries)).invoke(input);
    expect(state.goal?.goalId).toBe(goalId(WORKED_IDS.learner, 'learn zeta widgets'));
    expect(state.missingConceptIds).toEqual([ZETA]);
    expect(state.flags).toContain('coverage_requested');
  });
});
