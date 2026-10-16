import { describe, expect, it } from 'vitest';
import { runCoach } from './graph';
import type { IntroPuzzleRow, RecentDecisionRow } from './rows';
import { DEFAULT_COACH_SETTINGS } from './settings';
import {
  T,
  WORKED_IDS,
  createStubCoachQueries,
  workedExampleRows,
  type StubCoachQueries,
} from './testing/stubs';

const input = { learnerId: WORKED_IDS.learner, goalText: null, now: T };
const run = (queries: StubCoachQueries) =>
  runCoach({ queries, settings: DEFAULT_COACH_SETTINGS, newId: () => 'run-1' }, input);

const cold: RecentDecisionRow = {
  masteryCount: 0,
  decisionId: null,
  createdAt: null,
  newAnswers: false,
  goalText: null,
};

const concept = (slug: string, questions = 2) => ({
  conceptId: `c-${slug}`,
  slug,
  name: slug.toUpperCase(),
  questions,
});
const intro = (over: Partial<IntroPuzzleRow> = {}): IntroPuzzleRow => ({
  puzzleId: 'p-intro',
  name: 'Tables and Keys',
  rootConcepts: [concept('relational-model', 2)],
  topConcept: concept('tables', 3),
  rootCount: 1,
  conceptCount: 4,
  lastPlayedAt: null,
  playedRecently: false,
  ...over,
});

describe('cold start', () => {
  it('skips the signal queries and selectTarget, sets cold_start, and records a target item', async () => {
    const queries = createStubCoachQueries({
      recentDecision: async () => cold,
      introPuzzles: async () => [intro()],
    });
    const result = await run(queries);
    expect(result.outcome).toBe('recorded');
    expect(queries.callsTo('weakConceptsWithWeakPrereqs')).toHaveLength(0);
    expect(queries.callsTo('decayedOrUnseenConcepts')).toHaveLength(0);
    expect(queries.callsTo('conceptAnswerEvidence')).toHaveLength(0);
    const p = queries.recorded[0]!;
    expect(p.flags).toEqual(['cold_start']);
    expect(p.puzzleId).toBe('p-intro');
    expect(p.evidence).toEqual([
      {
        label: 'Concept',
        nodeId: 'c-relational-model',
        role: 'target',
        reason: 'target: introductory concept with no prerequisites',
        weight: 0.375,
      },
    ]);
    expect(p.summary).toContain('no study history yet');
  });

  it('uses the most tested concept when the puzzle has no root concept', async () => {
    const queries = createStubCoachQueries({
      recentDecision: async () => cold,
      introPuzzles: async () => [intro({ rootConcepts: [], rootCount: 0 })],
    });
    await run(queries);
    expect(queries.recorded[0]!.evidence[0]!.nodeId).toBe('c-tables');
  });

  it('a recently played introductory puzzle also sets repeat', async () => {
    const queries = createStubCoachQueries({
      recentDecision: async () => cold,
      introPuzzles: async () => [intro({ playedRecently: true })],
    });
    await run(queries);
    expect(queries.recorded[0]!.flags).toEqual(['cold_start', 'repeat']);
  });

  it('a cold start with no playable puzzle ends no_content without recording', async () => {
    const queries = createStubCoachQueries({
      recentDecision: async () => cold,
      introPuzzles: async () => [],
    });
    const result = await run(queries);
    expect(result).toEqual({ outcome: 'no_content', decisionId: null, coverageTaskId: null });
    expect(queries.callsTo('recordDecision')).toHaveLength(0);
  });
});

describe('sparse content', () => {
  it('no covering row falls back to intro_puzzles with coverage_gap', async () => {
    const queries = createStubCoachQueries({
      playablePuzzlesCovering: async () => [],
      introPuzzles: async () => [intro()],
    });
    await run(queries);
    const p = queries.recorded[0]!;
    expect(p.flags).toEqual(['coverage_gap', 'prerequisite_first']);
    expect(p.puzzleId).toBe('p-intro');
    expect(p.summary).toContain('"Tables and Keys"');
  });

  it('a covering row that does not test the target sets coverage_gap', async () => {
    const [first] = workedExampleRows().puzzles;
    const queries = createStubCoachQueries({
      playablePuzzlesCovering: async () => [{ ...first!, coveredTargetIds: [] }],
    });
    await run(queries);
    expect(queries.recorded[0]!.flags).toEqual(['coverage_gap', 'prerequisite_first']);
  });

  it('a target with no puzzle anywhere records a decision with no_puzzle, coverage_gap, and no RECOMMENDED', async () => {
    const queries = createStubCoachQueries({
      playablePuzzlesCovering: async () => [],
      introPuzzles: async () => [],
    });
    const result = await run(queries);
    expect(result.outcome).toBe('recorded');
    const p = queries.recorded[0]!;
    expect(p.puzzleId).toBe('');
    expect(p.flags).toEqual(['coverage_gap', 'no_puzzle', 'prerequisite_first']);
    expect(p.summary).toContain('No playable puzzle covers it yet.');
    expect(p.evidence.length).toBeGreaterThan(0);
  });

  it('no target and no puzzle ends no_content without recording', async () => {
    const queries = createStubCoachQueries({
      weakConceptsWithWeakPrereqs: async () => [],
      decayedOrUnseenConcepts: async () => [],
    });
    const result = await run(queries);
    expect(result.outcome).toBe('no_content');
    expect(queries.callsTo('decayedOrUnseenConcepts')).toHaveLength(2); // tier 2, then tier 3
    expect(queries.callsTo('playablePuzzlesCovering')).toHaveLength(0);
    expect(queries.callsTo('recordDecision')).toHaveLength(0);
  });

  it('tier 2 and tier 3 targets set unseen, decayed, and all_mastered', async () => {
    const row = (kind: 'unseen' | 'decayed') => ({
      conceptId: 'c-x',
      slug: 'x',
      name: 'X',
      kind,
      score: kind === 'unseen' ? null : 0.6,
      attempts: kind === 'unseen' ? 0 : 3,
      lastSeen: kind === 'unseen' ? null : T - 20 * 86_400_000,
      daysSince: kind === 'unseen' ? null : 20,
      risk: kind === 'unseen' ? null : 0.9,
      openPrereqs: 0,
    });
    const covers = { ...workedExampleRows().puzzles[0]!, coveredTargetIds: ['c-x'] };
    const base = {
      weakConceptsWithWeakPrereqs: async () => [],
      playablePuzzlesCovering: async () => [covers],
    };

    const unseen = createStubCoachQueries({
      ...base,
      decayedOrUnseenConcepts: async () => [row('unseen')],
    });
    await run(unseen);
    expect(unseen.recorded[0]!.flags).toEqual(['unseen']);
    expect(unseen.recorded[0]!.evidence[0]!.reason).toBe('target: never practised');

    const decayed = createStubCoachQueries({
      ...base,
      decayedOrUnseenConcepts: async () => [row('decayed')],
    });
    await run(decayed);
    expect(decayed.recorded[0]!.flags).toEqual(['decayed']);

    let call = 0;
    const mastered = createStubCoachQueries({
      ...base,
      decayedOrUnseenConcepts: async () => (call++ === 0 ? [] : [row('decayed')]),
    });
    await run(mastered);
    expect(mastered.recorded[0]!.flags).toEqual(['all_mastered']);
    expect(
      mastered
        .callsTo('decayedOrUnseenConcepts')
        .map((c) => (c.params as { before: number }).before),
    ).toEqual([T - 14 * 86_400_000, T]);
  });

  it('all rows played recently sets repeat', async () => {
    const [first] = workedExampleRows().puzzles;
    const queries = createStubCoachQueries({
      playablePuzzlesCovering: async () => [{ ...first!, playedRecently: true }],
    });
    await run(queries);
    expect(queries.recorded[0]!.flags).toEqual(['prerequisite_first', 'repeat']);
  });
});
