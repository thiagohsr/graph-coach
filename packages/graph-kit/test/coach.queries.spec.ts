// Integration tests of the queries owned by spec 004 (Coach), against a real FalkorDB (graph layer).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedIds, type QueryParams } from '../src';
import { createTestGraph, type TestGraph } from '../src/testing';
import {
  ADMIN,
  DAY,
  L1,
  L2,
  NOW,
  OWNERSHIP,
  addAgents,
  addConcepts,
  addLearner,
  addMastery,
  addPuzzle,
  addSession,
  cid,
  loadColdStart,
  loadCoverageGap,
  loadCycle,
  loadDiamond,
  loadOwnership,
  loadPassages,
  loadTwoWeakGroups,
  loadWorkedExample,
  revokeShare,
  share,
} from './fixtures/coach.fixture';

let tg: TestGraph;
const q = <T = Record<string, unknown>>(name: string, params: QueryParams) => tg.graph.query<T>(name, params);

beforeAll(async () => {
  tg = await createTestGraph();
});
afterAll(async () => {
  await tg?.dispose();
});
beforeEach(async () => {
  await tg.clear();
});

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
/** The risk formula of the Coach (reconciliation F1), restated here so the graph layer has no dependency on agents. */
const expectedRisk = (score: number, days: number, decayDays = 14) =>
  (1 - score) * Math.min(1 + days / decayDays, 2);

interface Prereq {
  conceptId: string;
  slug: string;
  distance: number;
  score: number;
  attempts: number;
  daysSince: number;
  risk: number;
}
interface WeakRow {
  conceptId: string;
  slug: string;
  name: string;
  score: number;
  attempts: number;
  daysSince: number;
  risk: number;
  weakestPrereq: Prereq | null;
  cyclic: boolean;
}
const weakParams = (learnerId: string, over: Partial<{ depth: number; threshold: number; scopeIds: string[] }> = {}) => ({
  learnerId,
  now: NOW,
  decayDays: 14,
  threshold: over.threshold ?? 0.5,
  depth: over.depth ?? 4,
  scopeIds: over.scopeIds ?? [],
});

describe('query files', () => {
  it('declare owner 004 and the expected modes', () => {
    const names = [
      'recent_decision',
      'weak_concepts_with_weak_prereqs',
      'decayed_or_unseen_concepts',
      'playable_puzzles_covering',
      'intro_puzzles',
      'concept_answer_evidence',
      'record_decision',
      'get_decision',
      'decision_path',
    ];
    const infos = tg.graph.listQueries().filter((i) => names.includes(i.name));
    expect(infos.map((i) => i.name).sort()).toEqual([...names].sort());
    for (const info of infos) {
      expect(info.owner).toBe('004');
      expect(info.mode).toBe(info.name === 'record_decision' ? 'write' : 'read');
    }
  });
});

describe('weak_concepts_with_weak_prereqs', () => {
  it('worked example: two rows, risks equal the formula, indexes points at b-trees', async () => {
    const { learnerId } = await loadWorkedExample(tg);
    const rows = await q<WeakRow>('weak_concepts_with_weak_prereqs', weakParams(learnerId));
    expect(rows.map((r) => r.slug)).toEqual(['b-trees', 'indexes']);
    const [bt, ix] = rows as [WeakRow, WeakRow];
    expect(round4(bt.risk)).toBe(round4(expectedRisk(0.12005, 9)));
    expect(round4(bt.risk)).toBe(1.4456);
    expect(round4(ix.risk)).toBe(round4(expectedRisk(0.2562455, 1)));
    expect(round4(ix.risk)).toBe(0.7969);
    expect(bt.daysSince).toBe(9);
    expect(ix.weakestPrereq).toMatchObject({ slug: 'b-trees', conceptId: cid('b-trees'), distance: 1 });
    expect(round4(ix.weakestPrereq!.risk)).toBe(1.4456);
    expect(bt.weakestPrereq).not.toBeNull();
    expect(bt.weakestPrereq!.risk).toBeLessThan(0.5);
    expect(round4(bt.weakestPrereq!.risk)).toBe(0.3185);
    expect(bt.cyclic).toBe(false);
    expect(ix.cyclic).toBe(false);
  });

  it('returns a concept whose risk equals the threshold', async () => {
    await addLearner(tg, L1);
    await addConcepts(tg, [{ slug: 'edge' }]);
    await addMastery(tg, L1, [{ slug: 'edge', score: 0.5, attempts: 1, daysAgo: 0 }]);
    const rows = await q<WeakRow>('weak_concepts_with_weak_prereqs', weakParams(L1, { threshold: 0.5 }));
    expect(rows.map((r) => r.slug)).toEqual(['edge']);
    expect(rows[0]!.risk).toBe(0.5);
    expect(await q('weak_concepts_with_weak_prereqs', weakParams(L1, { threshold: 0.51 }))).toHaveLength(0);
  });

  it('applies the traversal depth as a filter (depth 1 versus 2 versus 4)', async () => {
    const { learnerId } = await loadWorkedExample(tg);
    const weakest = async (depth: number) => {
      const rows = await q<WeakRow>('weak_concepts_with_weak_prereqs', weakParams(learnerId, { depth }));
      return rows.find((r) => r.slug === 'b-trees')!.weakestPrereq;
    };
    expect((await weakest(1))!.slug).toBe('storage-pages');
    expect(round4((await weakest(1))!.risk)).toBe(0.2818);
    expect((await weakest(2))!.slug).toBe('tables-rows-columns');
    expect(round4((await weakest(4))!.risk)).toBe(0.3185);
  });

  it('diamond: the shared weak prerequisite is returned once with the shortest distance', async () => {
    await loadDiamond(tg);
    const rows = await q<WeakRow>('weak_concepts_with_weak_prereqs', weakParams(L1));
    expect(rows.map((r) => r.slug)).toEqual(['base', 'top']);
    const top = rows.find((r) => r.slug === 'top')!;
    expect(top.weakestPrereq).toMatchObject({ slug: 'base', distance: 2 });
    expect(rows.find((r) => r.slug === 'base')!.weakestPrereq).toBeNull();
  });

  it('cycle: terminates and sets cyclic', async () => {
    await loadCycle(tg);
    const rows = await q<WeakRow>('weak_concepts_with_weak_prereqs', weakParams(L1));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.cyclic)).toBe(true);
  });

  it('never picks an unpractised prerequisite as weakestPrereq', async () => {
    await loadCoverageGap(tg);
    const rows = await q<WeakRow>('weak_concepts_with_weak_prereqs', weakParams(L1));
    expect(rows.map((r) => r.slug)).toEqual(['x']);
    expect(rows[0]!.weakestPrereq).toBeNull();
  });

  it('honours $scopeIds', async () => {
    const { learnerId } = await loadWorkedExample(tg);
    const rows = await q<WeakRow>(
      'weak_concepts_with_weak_prereqs',
      weakParams(learnerId, { scopeIds: [cid('indexes')] }),
    );
    expect(rows.map((r) => r.slug)).toEqual(['indexes']);
  });

  it('ties are broken by fewer attempts, then name', async () => {
    await addLearner(tg, L1);
    await addConcepts(tg, [{ slug: 'm' }, { slug: 'n' }, { slug: 'o' }]);
    await addMastery(tg, L1, [
      { slug: 'm', score: 0.2, attempts: 5, daysAgo: 1 },
      { slug: 'n', score: 0.2, attempts: 2, daysAgo: 1 },
      { slug: 'o', score: 0.2, attempts: 2, daysAgo: 1 },
    ]);
    const rows = await q<WeakRow>('weak_concepts_with_weak_prereqs', weakParams(L1));
    expect(rows.map((r) => r.slug)).toEqual(['n', 'o', 'm']);
  });
});

interface DecayedRow {
  conceptId: string;
  slug: string;
  kind: 'unseen' | 'decayed';
  score: number | null;
  attempts: number;
  lastSeen: number | null;
  daysSince: number | null;
  risk: number | null;
  openPrereqs: number;
}
const decayedParams = (userId: string, before: number, over: Partial<{ scopeIds: string[]; limit: number }> = {}) => ({
  userId,
  now: NOW,
  before,
  decayDays: 14,
  depth: 4,
  scopeIds: over.scopeIds ?? [],
  limit: over.limit ?? 50,
});

describe('decayed_or_unseen_concepts', () => {
  it('unseen concepts come before decayed ones; decayed rows carry score, lastSeen, and risk', async () => {
    const { learnerId } = await loadWorkedExample(tg);
    const rows = await q<DecayedRow>('decayed_or_unseen_concepts', decayedParams(learnerId, NOW - 10 * DAY));
    const kinds = rows.map((r) => r.kind);
    const firstDecayed = kinds.indexOf('decayed');
    expect(firstDecayed).toBeGreaterThan(0);
    expect(kinds.slice(0, firstDecayed).every((k) => k === 'unseen')).toBe(true);
    expect(kinds.slice(firstDecayed).every((k) => k === 'decayed')).toBe(true);
    const decayed = rows[firstDecayed]!;
    expect(decayed.score).not.toBeNull();
    expect(decayed.lastSeen).not.toBeNull();
    expect(decayed.risk).not.toBeNull();
    const unseen = rows[0]!;
    expect(unseen).toMatchObject({ score: null, lastSeen: null, daysSince: null, risk: null, attempts: 0 });
  });

  it('orders unseen concepts by fewer unpractised prerequisites', async () => {
    const { learner2Id } = await loadWorkedExample(tg);
    const rows = await q<DecayedRow>('decayed_or_unseen_concepts', decayedParams(learner2Id, NOW - 14 * DAY));
    expect(rows.every((r) => r.kind === 'unseen')).toBe(true);
    expect(rows[0]!.slug).toBe('relational-model');
    expect(rows[0]!.openPrereqs).toBe(0);
    const opens = rows.map((r) => r.openPrereqs);
    expect(opens).toEqual([...opens].sort((a, b) => a - b));
    const indexes = rows.find((r) => r.slug === 'indexes')!;
    // b-trees, sql-where, storage-pages, sql-select, tables-rows-columns, relational-model (all within depth 4)
    expect(indexes.openPrereqs).toBe(6);
  });

  it('a cutoff of now returns the concept practised longest ago first, and excludes concepts without a playable question', async () => {
    await loadDiamond(tg);
    await addPuzzle(tg, {
      id: 'dia-puzzle',
      name: 'Diamond',
      ownerId: L1,
      visibility: 'public',
      questions: [
        { id: 'dia-q1', tests: ['base'] },
        { id: 'dia-q2', tests: ['left'] },
        { id: 'dia-q3', tests: ['top'] },
      ],
    });
    const rows = await q<DecayedRow>('decayed_or_unseen_concepts', decayedParams(L1, NOW));
    expect(rows.map((r) => r.slug)).toEqual(['base', 'left', 'top']); // right has no playable question
    expect(rows.every((r) => r.kind === 'decayed')).toBe(true);
  });

  it('honours $scopeIds and $limit', async () => {
    const { learner2Id } = await loadWorkedExample(tg);
    const scoped = await q<DecayedRow>(
      'decayed_or_unseen_concepts',
      decayedParams(learner2Id, NOW, { scopeIds: [cid('b-trees')] }),
    );
    expect(scoped.map((r) => r.slug)).toEqual(['b-trees']);
    const limited = await q<DecayedRow>('decayed_or_unseen_concepts', decayedParams(learner2Id, NOW, { limit: 2 }));
    expect(limited).toHaveLength(2);
  });
});

interface PuzzleRowT {
  puzzleId: string;
  name: string;
  overlap: number;
  coveredTargetIds: string[];
  targetQuestions: number;
  lastPlayedAt: number | null;
  playedRecently: boolean;
}
const coverParams = (userId: string, targetIds: string[], recentSince = NOW - 3 * DAY) => ({
  userId,
  targetIds,
  recentSince,
  limit: 20,
});

describe('playable_puzzles_covering', () => {
  it('worked example: Storage and B-trees first, Indexes and Query Planning second without target coverage', async () => {
    const { learnerId } = await loadWorkedExample(tg);
    const rows = await q<PuzzleRowT>('playable_puzzles_covering', coverParams(learnerId, [cid('b-trees')]));
    expect(rows.map((r) => r.name)).toEqual([
      'Databases 101: Storage and B-trees',
      'Databases 101: Indexes and Query Planning',
    ]);
    const [first, second] = rows as [PuzzleRowT, PuzzleRowT];
    expect(first.puzzleId).toBe(seedIds.puzzle('storage-and-b-trees'));
    expect(first.coveredTargetIds).toEqual([cid('b-trees')]);
    expect(first.targetQuestions).toBe(4);
    expect(first.overlap).toBe(2); // b-trees + storage-pages
    expect(first.playedRecently).toBe(false);
    expect(first.lastPlayedAt).toBe(NOW - 9 * DAY);
    expect(second.coveredTargetIds).toEqual([]);
    expect(second.overlap).toBe(1);
    expect(second.playedRecently).toBe(true);
  });

  it('a puzzle played after $recentSince sorts after an unplayed one that covers the same target', async () => {
    await addLearner(tg, L1);
    await addConcepts(tg, [{ slug: 't' }]);
    await addPuzzle(tg, { id: 'pa', name: 'A recently played', ownerId: L1, questions: [{ id: 'pa-q', tests: ['t'] }] });
    await addPuzzle(tg, { id: 'pb', name: 'B unplayed', ownerId: L1, questions: [{ id: 'pb-q', tests: ['t'] }] });
    await addSession(tg, {
      id: 'sa',
      learnerId: L1,
      puzzleId: 'pa',
      submittedDaysAgo: 1,
      answers: [{ questionId: 'pa-q', correct: true }],
    });
    const rows = await q<PuzzleRowT>('playable_puzzles_covering', coverParams(L1, [cid('t')]));
    expect(rows.map((r) => r.puzzleId)).toEqual(['pb', 'pa']);
    expect(rows[1]!.playedRecently).toBe(true);
  });

  it('lastPlayedAt ignores unsubmitted sessions', async () => {
    await addLearner(tg, L1);
    await addConcepts(tg, [{ slug: 't' }]);
    await addPuzzle(tg, { id: 'pa', name: 'A', ownerId: L1, questions: [{ id: 'pa-q', tests: ['t'] }] });
    await addSession(tg, { id: 'open', learnerId: L1, puzzleId: 'pa', answers: [] });
    const rows = await q<PuzzleRowT>('playable_puzzles_covering', coverParams(L1, [cid('t')]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ lastPlayedAt: null, playedRecently: false });
  });

  it('draft and rejected questions do not count', async () => {
    await loadOwnership(tg);
    expect(await q('playable_puzzles_covering', coverParams(L1, [cid('hidden')]))).toHaveLength(0);
  });

  it('coverage gap: a neighbour puzzle is returned with empty coveredTargetIds', async () => {
    await loadCoverageGap(tg);
    const rows = await q<PuzzleRowT>('playable_puzzles_covering', coverParams(L1, [cid('x')]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ puzzleId: 'gap-puzzle', coveredTargetIds: [], targetQuestions: 0, overlap: 1 });
  });
});

describe('intro_puzzles', () => {
  interface IntroRow {
    puzzleId: string;
    name: string;
    rootConcepts: Array<{ slug: string; questions: number }>;
    topConcept: { slug: string; questions: number };
    rootCount: number;
    conceptCount: number;
    playedRecently: boolean;
  }
  const introParams = (userId: string, recentSince = NOW - 3 * DAY) => ({ userId, recentSince, limit: 20 });

  it('highest share of root concepts first; rootConcepts and topConcept shapes; a puzzle with no root comes last', async () => {
    const { learner2Id } = await loadColdStart(tg);
    const rows = await q<IntroRow>('intro_puzzles', introParams(learner2Id));
    expect(rows).toHaveLength(6);
    expect(rows[0]!.puzzleId).toBe(seedIds.puzzle('tables-and-keys'));
    expect(rows[0]!.rootConcepts.map((c) => c.slug)).toEqual(['relational-model']);
    expect(rows[0]!.rootCount).toBe(1);
    expect(rows[0]!.conceptCount).toBe(4);
    const last = rows[rows.length - 1]!;
    expect(last.rootCount).toBe(0);
    expect(last.rootConcepts).toEqual([]);
    expect(last.topConcept.slug).toBeTruthy();
    expect(last.topConcept.questions).toBeGreaterThanOrEqual(1);
  });

  it('orders rootConcepts by question count', async () => {
    await addLearner(tg, L1);
    await addConcepts(tg, [{ slug: 'r1' }, { slug: 'r2' }, { slug: 'child', prereqs: ['r1'] }]);
    await addPuzzle(tg, {
      id: 'ip',
      name: 'Intro',
      ownerId: L1,
      questions: [
        { id: 'ip-1', tests: ['r2'] },
        { id: 'ip-2', tests: ['r2'] },
        { id: 'ip-3', tests: ['r1'] },
        { id: 'ip-4', tests: ['child'] },
      ],
    });
    const [row] = await q<IntroRow>('intro_puzzles', introParams(L1));
    expect(row!.rootConcepts.map((c) => c.slug)).toEqual(['r2', 'r1']);
    expect(row!.rootConcepts[0]!.questions).toBe(2);
    expect(row!.topConcept.slug).toBe('r2');
  });

  it('recently played puzzles sort later', async () => {
    const { learnerId } = await loadWorkedExample(tg);
    const rows = await q<IntroRow>('intro_puzzles', introParams(learnerId, NOW - 13 * DAY));
    const firstRecent = rows.findIndex((r) => r.playedRecently);
    expect(firstRecent).toBe(2); // transactions and design were never played
    expect(rows.slice(firstRecent).every((r) => r.playedRecently)).toBe(true);
    expect(rows.slice(0, firstRecent).every((r) => !r.playedRecently)).toBe(true);
  });
});

describe('concept_answer_evidence', () => {
  interface EvRow {
    conceptId: string;
    questionId: string;
    sessionId: string;
    submittedAt: number;
    misses: number;
  }

  it('worked example: the learner wrong answers on the given concepts', async () => {
    const { learnerId } = await loadWorkedExample(tg);
    const ix = await q<EvRow>('concept_answer_evidence', { learnerId, conceptIds: [cid('indexes')], limit: 100 });
    expect(ix).toHaveLength(4);
    expect(new Set(ix.map((r) => r.sessionId))).toEqual(new Set([seedIds.session('B'), seedIds.session('C')]));
    expect(ix.every((r) => r.misses === 1)).toBe(true);
    const bt = await q<EvRow>('concept_answer_evidence', { learnerId, conceptIds: [cid('b-trees')], limit: 100 });
    expect(bt).toHaveLength(4);
    expect(bt.every((r) => r.sessionId === seedIds.session('A'))).toBe(true);
    const both = await q<EvRow>('concept_answer_evidence', {
      learnerId,
      conceptIds: [cid('b-trees'), cid('indexes')],
      limit: 100,
    });
    expect(both).toHaveLength(8);
    // another learner has none
    expect(await q('concept_answer_evidence', { learnerId: seedIds.user('learner2'), conceptIds: [cid('indexes')], limit: 100 })).toHaveLength(0);
  });

  it('excludes unsubmitted sessions and counts wrong blanks per question and session', async () => {
    await addLearner(tg, L1);
    await addConcepts(tg, [{ slug: 'c' }]);
    await addPuzzle(tg, { id: 'ep', name: 'EP', ownerId: L1, questions: [{ id: 'eq', tests: ['c'] }] });
    await addSession(tg, {
      id: 'done',
      learnerId: L1,
      puzzleId: 'ep',
      submittedDaysAgo: 2,
      answers: [
        { questionId: 'eq', blank: 0, correct: false },
        { questionId: 'eq', blank: 1, correct: false },
        { questionId: 'eq', blank: 2, correct: true },
      ],
    });
    await addSession(tg, { id: 'open', learnerId: L1, puzzleId: 'ep', answers: [{ questionId: 'eq', blank: 0, correct: false }] });
    const rows = await q<EvRow>('concept_answer_evidence', { learnerId: L1, conceptIds: [cid('c')], limit: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sessionId: 'done', questionId: 'eq', misses: 2 });
  });
});

/** Evidence of the worked example, as the Coach would build it. */
function workedEvidence() {
  return [
    { label: 'Concept', nodeId: cid('b-trees'), role: 'target', reason: 'target: mastery 0.12, last practised 9 days ago, risk 1.45', weight: 0.723 },
    { label: 'Concept', nodeId: cid('indexes'), role: 'driver', reason: 'weak concept that depends on the target: mastery 0.26, risk 0.80', weight: 0.359 },
    { label: 'Concept', nodeId: cid('transactions'), role: 'alternative', reason: 'also considered: risk 0.95', weight: 0.2 },
    { label: 'Concept', nodeId: cid('mvcc'), role: 'alternative', reason: 'also considered: risk 0.50', weight: 0.1 },
    { label: 'Question', nodeId: seedIds.question('indexes-and-planning', 2), role: 'answer', reason: 'missed 2 times', weight: 0.467 },
    { label: 'Question', nodeId: seedIds.question('indexes-and-planning', 3), role: 'answer', reason: 'missed 2 times', weight: 0.467 },
    { label: 'Question', nodeId: seedIds.question('storage-and-b-trees', 3), role: 'answer', reason: 'missed 1 time', weight: 0.233 },
    { label: 'Session', nodeId: seedIds.session('C'), role: 'session', reason: '2 wrong answers on these concepts', weight: 0.333 },
    { label: 'Session', nodeId: seedIds.session('B'), role: 'session', reason: '2 wrong answers on these concepts', weight: 0.333 },
    { label: 'Session', nodeId: seedIds.session('A'), role: 'session', reason: '4 wrong answers on these concepts', weight: 0.5 },
  ];
}

const recordParams = (learnerId: string, over: Record<string, unknown> = {}): QueryParams =>
  ({
    decisionId: 'decision-1',
    learnerId,
    kind: 'recommendation',
    summary: 'Practise B-trees first.',
    flags: ['prerequisite_first'],
    now: NOW,
    modelCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    embeddingTokens: 0,
    llmProvider: '',
    llmModel: '',
    puzzleId: seedIds.puzzle('storage-and-b-trees'),
    goalId: '',
    evidence: workedEvidence(),
    ...over,
  }) as QueryParams;

describe('record_decision, get_decision, recent_decision', () => {
  it('writes the Decision, MADE, FOR, RECOMMENDED, and one BECAUSE per evidence item', async () => {
    const { learnerId } = await loadTwoWeakGroups(tg);
    const rows = await q<{ decisionId: string; becauseCount: number; linkedPuzzle: boolean }>(
      'record_decision',
      recordParams(learnerId),
    );
    expect(rows).toEqual([{ decisionId: 'decision-1', becauseCount: 10, linkedPuzzle: true }]);
    expect(await tg.count('Decision')).toBe(1);
    expect(await tg.countEdges('MADE')).toBe(1);
    expect(await tg.countEdges('FOR')).toBe(1);
    expect(await tg.countEdges('RECOMMENDED')).toBe(1);
    expect(await tg.countEdges('BECAUSE')).toBe(10);
    const target = await tg.cypher<{ role: string; reason: string; weight: number }>(
      `MATCH (:Decision {id: 'decision-1'})-[b:BECAUSE]->(:Concept {id: $id}) RETURN b.role AS role, b.reason AS reason, b.weight AS weight`,
      { id: cid('b-trees') },
    );
    expect(target).toEqual([
      { role: 'target', reason: 'target: mastery 0.12, last practised 9 days ago, risk 1.45', weight: 0.723 },
    ]);
    const d = await tg.cypher<{ flags: string[]; createdAt: number }>(
      `MATCH (d:Decision {id: 'decision-1'}) RETURN d.flags AS flags, d.createdAt AS createdAt`,
    );
    expect(d).toEqual([{ flags: ['prerequisite_first'], createdAt: NOW }]);
    // SC-C02: no decision without a BECAUSE edge
    const orphans = await tg.cypher<{ c: number }>(`MATCH (d:Decision) WHERE NOT (d)-[:BECAUSE]->() RETURN count(d) AS c`);
    expect(orphans[0]!.c).toBe(0);
  });

  it('stores the chat provider and model of the run next to the usage numbers', async () => {
    const { learnerId } = await loadWorkedExample(tg);
    await q('record_decision', recordParams(learnerId, { llmProvider: 'openrouter', llmModel: 'openai/gpt-4o-mini' }));
    const rows = await tg.cypher<Record<string, string>>(
      `MATCH (d:Decision) RETURN d.llmProvider AS llmProvider, d.llmModel AS llmModel`,
    );
    expect(rows).toEqual([{ llmProvider: 'openrouter', llmModel: 'openai/gpt-4o-mini' }]);
  });

  it('stores the usage numbers exactly as passed, zeros included', async () => {
    const { learnerId } = await loadWorkedExample(tg);
    await q('record_decision', recordParams(learnerId, { decisionId: 'zero' }));
    await q(
      'record_decision',
      recordParams(learnerId, { decisionId: 'used', modelCalls: 2, inputTokens: 31, outputTokens: 7, embeddingTokens: 5 }),
    );
    const rows = await tg.cypher<Record<string, number>>(
      `MATCH (d:Decision) RETURN d.id AS id, d.modelCalls AS modelCalls, d.inputTokens AS inputTokens,
              d.outputTokens AS outputTokens, d.embeddingTokens AS embeddingTokens ORDER BY id`,
    );
    expect(rows).toEqual([
      { id: 'used', modelCalls: 2, inputTokens: 31, outputTokens: 7, embeddingTokens: 5 },
      { id: 'zero', modelCalls: 0, inputTokens: 0, outputTokens: 0, embeddingTokens: 0 },
    ]);
  });

  it('unknown evidence ids create nothing and return no row', async () => {
    const { learnerId } = await loadWorkedExample(tg);
    const rows = await q('record_decision', recordParams(learnerId, {
      evidence: [{ label: 'Concept', nodeId: 'no-such-concept', role: 'target', reason: 'x', weight: 0.5 }],
    }));
    expect(rows).toEqual([]);
    expect(await tg.count('Decision')).toBe(0);
    expect(await tg.countEdges('MADE')).toBe(0);
    expect(await tg.countEdges('FOR')).toBe(0);
  });

  it('an empty $puzzleId creates no RECOMMENDED edge; a goal creates TOWARD', async () => {
    const { learnerId } = await loadWorkedExample(tg);
    await tg.cypher(`CREATE (:Goal {id: 'goal-1', text: 'learn b-trees', active: true, createdAt: 1})`);
    const rows = await q<{ linkedPuzzle: boolean }>(
      'record_decision',
      recordParams(learnerId, { puzzleId: '', goalId: 'goal-1' }),
    );
    expect(rows[0]!.linkedPuzzle).toBe(false);
    expect(await tg.countEdges('RECOMMENDED')).toBe(0);
    expect(await tg.countEdges('TOWARD')).toBe(1);
  });

  it('outside the goal stretch (empty $goalId) creates no Goal node and no TOWARD edge (decision 20)', async () => {
    const { learnerId } = await loadWorkedExample(tg);
    const rows = await q<{ decisionId: string }>('record_decision', recordParams(learnerId, { goalId: '' }));
    expect(rows).toHaveLength(1);
    expect(await tg.count('Goal')).toBe(0);
    expect(await tg.countEdges('TOWARD')).toBe(0);
    // an id that matches no Goal behaves the same: the query never creates a Goal
    await q('record_decision', recordParams(learnerId, { decisionId: 'decision-2', goalId: 'no-such-goal' }));
    expect(await tg.count('Decision')).toBe(2);
    expect(await tg.count('Goal')).toBe(0);
    expect(await tg.countEdges('TOWARD')).toBe(0);
  });

  it('get_decision returns target, alternatives ordered by weight, owner, and puzzle', async () => {
    const { learnerId } = await loadTwoWeakGroups(tg);
    await q('record_decision', recordParams(learnerId));
    const [row] = await q<Record<string, unknown>>('get_decision', { decisionId: 'decision-1' });
    expect(row).toMatchObject({
      id: 'decision-1',
      kind: 'recommendation',
      summary: 'Practise B-trees first.',
      createdAt: NOW,
      flags: ['prerequisite_first'],
      ownerId: learnerId,
      puzzleId: seedIds.puzzle('storage-and-b-trees'),
      puzzleName: 'Databases 101: Storage and B-trees',
      targetConceptId: cid('b-trees'),
      targetName: 'B-trees',
      coverageTaskId: null,
    });
    expect(row!.alternatives).toEqual([
      { conceptId: cid('transactions'), name: 'Transactions' },
      { conceptId: cid('mvcc'), name: 'Multi-version concurrency control' },
    ]);
    expect(await q('get_decision', { decisionId: 'missing' })).toEqual([]);
  });

  it('recent_decision: masteryCount, window, and newAnswers', async () => {
    const { learnerId, learner2Id } = await loadWorkedExample(tg);
    const none = await q<Record<string, unknown>>('recent_decision', { learnerId, since: NOW - 10 * 60_000 });
    expect(none).toEqual([{ masteryCount: 13, decisionId: null, createdAt: null, newAnswers: false, goalText: null }]);
    const cold = await q<{ masteryCount: number }>('recent_decision', { learnerId: learner2Id, since: NOW });
    expect(cold[0]!.masteryCount).toBe(0);
    expect(await q('recent_decision', { learnerId: 'nobody', since: 0 })).toEqual([]);

    await q('record_decision', recordParams(learnerId, { now: NOW - 5 * 60_000 }));
    const inside = await q<Record<string, unknown>>('recent_decision', { learnerId, since: NOW - 10 * 60_000 });
    expect(inside[0]).toMatchObject({ masteryCount: 13, decisionId: 'decision-1', createdAt: NOW - 5 * 60_000, newAnswers: false });
    const outside = await q<Record<string, unknown>>('recent_decision', { learnerId, since: NOW - 60_000 });
    expect(outside[0]).toMatchObject({ decisionId: null });

    await addSession(tg, {
      id: 'later',
      learnerId,
      puzzleId: seedIds.puzzle('storage-and-b-trees'),
      submittedDaysAgo: 0,
      answers: [{ questionId: seedIds.question('storage-and-b-trees', 3), correct: true }],
    });
    const after = await q<Record<string, unknown>>('recent_decision', { learnerId, since: NOW - 10 * 60_000 });
    expect(after[0]).toMatchObject({ decisionId: 'decision-1', newAnswers: true });
  });

  it('recent_decision reports the goal text through TOWARD', async () => {
    const { learnerId } = await loadWorkedExample(tg);
    await tg.cypher(`CREATE (:Goal {id: 'goal-1', text: 'learn b-trees', active: true, createdAt: 1})`);
    await q('record_decision', recordParams(learnerId, { goalId: 'goal-1' }));
    const rows = await q<{ goalText: string | null }>('recent_decision', { learnerId, since: NOW - 60_000 });
    expect(rows[0]!.goalText).toBe('learn b-trees');
  });
});

interface PathRowT {
  part: string;
  fromLabel: string;
  fromId: string;
  fromData: Record<string, unknown>;
  type: string;
  toLabel: string;
  toId: string;
  toData: Record<string, unknown>;
  role: string | null;
  reason: string;
  weight: number | null;
}

describe('decision_path', () => {
  const path = (decisionId: string, learnerId: string, userId = learnerId) =>
    q<PathRowT>('decision_path', { decisionId, learnerId, userId, depth: 4 });

  it('returns a row for every part of the worked example', async () => {
    const { learnerId } = await loadTwoWeakGroups(tg);
    await q('record_decision', recordParams(learnerId));
    const rows = await path('decision-1', learnerId);
    const count = (part: string) => rows.filter((r) => r.part === part).length;
    expect(count('made')).toBe(1);
    expect(count('for')).toBe(1);
    expect(count('recommended')).toBe(1);
    expect(count('because')).toBe(10);
    expect(count('chain')).toBe(1);
    expect(count('tests')).toBeGreaterThanOrEqual(3);
    expect(count('passage')).toBe(0);
    const chain = rows.find((r) => r.part === 'chain')!;
    expect(chain).toMatchObject({ fromId: cid('b-trees'), toId: cid('indexes'), type: 'PREREQUISITE_OF' });
    const answered = rows.filter((r) => r.part === 'answered');
    expect(answered.length).toBeGreaterThanOrEqual(3);
    expect(answered.every((r) => /^\d+ of \d+ blanks wrong$/.test(r.reason))).toBe(true);
    for (const row of rows) {
      expect(row.reason.length).toBeGreaterThan(0);
      if (row.part !== 'because') {
        expect(row.role).toBeNull();
        expect(row.weight).toBeNull();
      }
    }
    const because = rows.filter((r) => r.part === 'because');
    expect(because.find((r) => r.role === 'target')).toMatchObject({ toLabel: 'Concept', toId: cid('b-trees'), weight: 0.723 });
    const session = because.find((r) => r.toId === seedIds.session('C'))!;
    expect(session.toData).toMatchObject({ puzzleName: 'Databases 101: Indexes and Query Planning', puzzleId: seedIds.puzzle('indexes-and-planning') });
    const learner = rows.find((r) => r.part === 'for')!;
    expect(learner.toData).toEqual({ displayName: 'Demo Learner' });
  });

  it('returns nothing for another learner id', async () => {
    const { learnerId, learner2Id } = await loadWorkedExample(tg);
    await q('record_decision', recordParams(learnerId));
    expect(await path('decision-1', learner2Id)).toEqual([]);
  });

  it('never exposes answers, distractors, or submitted words', async () => {
    await addLearner(tg, L1, 'Main');
    await addAgents(tg);
    await addConcepts(tg, [{ slug: 'c' }]);
    await addPuzzle(tg, { id: 'sp', name: 'SP', ownerId: L1, questions: [{ id: 'sq', tests: ['c'] }] });
    await addSession(tg, {
      id: 'ss',
      learnerId: L1,
      puzzleId: 'sp',
      submittedDaysAgo: 1,
      answers: [{ questionId: 'sq', correct: false }],
    });
    await q('record_decision', {
      decisionId: 'd-safe', learnerId: L1, kind: 'recommendation', summary: 's', flags: [], now: NOW,
      modelCalls: 0, inputTokens: 0, outputTokens: 0, embeddingTokens: 0, llmProvider: '', llmModel: '', puzzleId: 'sp', goalId: '',
      evidence: [
        { label: 'Concept', nodeId: cid('c'), role: 'target', reason: 'target', weight: 0.5 },
        { label: 'Question', nodeId: 'sq', role: 'answer', reason: 'missed 1 time', weight: 0.2 },
        { label: 'Session', nodeId: 'ss', role: 'session', reason: '1 wrong answer on these concepts', weight: 0.2 },
      ],
    });
    const rows = await path('d-safe', L1);
    const text = JSON.stringify(rows);
    expect(text).not.toContain('secret-sq');
    expect(text).not.toContain('decoy-sq');
    expect(text).not.toMatch(/"(answers|distractors|word)"/);
    expect(rows.find((r) => r.toId === 'sq' && r.part === 'because')!.toData).toMatchObject({ sentence: 'Sentence of sq with a ___.' });
  });

  it('the general branch never returns a passage edge; the passage branch follows canReadSource of the viewer', async () => {
    await addLearner(tg, L1, 'Main');
    await addLearner(tg, L2, 'Other');
    await addAgents(tg);
    await addConcepts(tg, [{ slug: 'c' }]);
    await addPuzzle(tg, { id: 'pp', name: 'PP', ownerId: L1, questions: [{ id: 'pq', tests: ['c'] }] });
    await tg.cypher(
      `MATCH (o:Learner {id: $owner}), (p:Puzzle {id: 'pp'})
       CREATE (o)-[:OWNS]->(s:Source {id: 'src', title: 'My notes', kind: 'text', createdAt: 1})
       CREATE (s)-[:HAS_CHUNK]->(:Chunk {id: 'chunk-1', position: 0, text: 'Chunk text about c.'})
       CREATE (s)-[:YIELDED]->(p)`,
      { owner: L1 },
    );
    await q('record_decision', {
      decisionId: 'd-pass', learnerId: L1, kind: 'recommendation', summary: 's', flags: [], now: NOW,
      modelCalls: 0, inputTokens: 0, outputTokens: 0, embeddingTokens: 0, llmProvider: '', llmModel: '', puzzleId: 'pp', goalId: '',
      evidence: [
        { label: 'Concept', nodeId: cid('c'), role: 'target', reason: 'target', weight: 0.5 },
        { label: 'Chunk', nodeId: 'chunk-1', role: 'passage', reason: 'matched the goal (similarity 0.82)', weight: 0.4 },
      ],
    });
    const own = await path('d-pass', L1, L1);
    expect(own.filter((r) => r.part === 'because').every((r) => r.toLabel !== 'Chunk')).toBe(true);
    const passage = own.filter((r) => r.part === 'passage');
    expect(passage).toHaveLength(1);
    expect(passage[0]).toMatchObject({ toLabel: 'Chunk', toId: 'chunk-1', role: 'passage', toData: { excerpt: 'Chunk text about c.', sourceTitle: 'My notes' } });
    // an admin (or anyone) who neither owns the source nor has it shared with the source gets the rest, without the chunk
    const other = await path('d-pass', L1, L2);
    expect(other.filter((r) => r.part === 'passage')).toEqual([]);
    expect(JSON.stringify(other)).not.toContain('Chunk text');
    expect(other.filter((r) => r.part !== 'passage')).toEqual(own.filter((r) => r.part !== 'passage'));
    // shared with the source: visible; play-only share: not
    await share(tg, 'pp', L2, false);
    expect((await path('d-pass', L1, L2)).filter((r) => r.part === 'passage')).toHaveLength(0);
    await share(tg, 'pp', L2, true);
    expect((await path('d-pass', L1, L2)).filter((r) => r.part === 'passage')).toHaveLength(1);
  });

  it('loadPassages: a learner with source access sees the excerpt; an admin viewer and a revoked share do not', async () => {
    await loadPassages(tg);
    await q('record_decision', {
      decisionId: 'd-passages', learnerId: L1, kind: 'recommendation', summary: 's', flags: [], now: NOW,
      modelCalls: 0, inputTokens: 0, outputTokens: 0, embeddingTokens: 0, llmProvider: '', llmModel: '', puzzleId: 'pass-puzzle', goalId: '',
      evidence: [
        { label: 'Concept', nodeId: cid('topic'), role: 'target', reason: 'target', weight: 0.5 },
        { label: 'Chunk', nodeId: 'pass-chunk', role: 'passage', reason: 'matched the goal (similarity 0.82)', weight: 0.4 },
      ],
    });
    const passages = async (viewer: string) => (await path('d-passages', L1, viewer)).filter((r) => r.part === 'passage');
    expect(await passages(L1)).toHaveLength(1);
    expect((await passages(L1))[0]!.toData).toEqual({ excerpt: 'A passage about the topic.', sourceTitle: 'Owner notes' });
    expect(await passages(ADMIN)).toEqual([]);
    expect(await passages(L2)).toHaveLength(1); // the source owner
    await share(tg, 'pass-puzzle', L1, false);
    expect(await passages(L1)).toEqual([]);
    await revokeShare(tg, 'pass-puzzle', L1);
    expect(await passages(L1)).toEqual([]);
    const rest = (await path('d-passages', L1, ADMIN)).map((r) => r.part).sort();
    expect(rest).toEqual((await path('d-passages', L1, L1)).map((r) => r.part).filter((p) => p !== 'passage').sort());
  });

  it('chain rows are deduplicated on a diamond', async () => {
    await loadDiamond(tg);
    await tg.cypher(`CREATE (:Decision {id: 'dd', kind: 'recommendation', summary: 's', createdAt: 1, flags: []})`);
    await tg.cypher(
      `MATCH (d:Decision {id: 'dd'}), (l:Learner {id: $l}), (ag:Agent {name: 'Coach'}), (t:Concept {id: $base}), (x:Concept {id: $top})
       CREATE (ag)-[:MADE]->(d), (d)-[:FOR]->(l),
              (d)-[:BECAUSE {role: 'target', reason: 't', weight: 0.5}]->(t),
              (d)-[:BECAUSE {role: 'driver', reason: 'd', weight: 0.4}]->(x)`,
      { l: L1, base: cid('base'), top: cid('top') },
    );
    const rows = await path('dd', L1);
    const chain = rows.filter((r) => r.part === 'chain');
    expect(chain).toHaveLength(4); // base-left, base-right, left-top, right-top, each once
    expect(new Set(chain.map((r) => `${r.fromId}>${r.toId}`)).size).toBe(4);
  });
});

describe('ownership (canPlay) in the Coach queries', () => {
  const ids = (rows: Array<{ puzzleId: string }>) => rows.map((r) => r.puzzleId).sort();
  const covering = async (userId: string, slugs: string[]) =>
    ids(await q<PuzzleRowT>('playable_puzzles_covering', coverParams(userId, slugs.map(cid))));
  const intro = async (userId: string) =>
    ids(await q<{ puzzleId: string }>('intro_puzzles', { userId, recentSince: NOW - 3 * DAY, limit: 20 }));
  const candidates = async (userId: string) =>
    (await q<DecayedRow>('decayed_or_unseen_concepts', decayedParams(userId, NOW))).map((r) => r.slug).sort();

  beforeEach(async () => {
    await loadOwnership(tg);
  });

  it('another learner private published puzzle is never returned', async () => {
    expect(await covering(L1, ['priv'])).toEqual([]);
    expect(await covering(L1, ['lonely'])).toEqual([]);
    expect(await intro(L1)).not.toContain(OWNERSHIP.otherPrivate);
    expect(await intro(L1)).not.toContain(OWNERSHIP.unsharedOnly);
  });

  it('the owner gets their own private published puzzle', async () => {
    expect(await covering(L1, ['mine'])).toEqual([OWNERSHIP.mainPrivate]);
    expect(await covering(L2, ['mine'])).toEqual([]);
    expect(await covering(L2, ['priv'])).toEqual([OWNERSHIP.otherPrivate]);
    expect(await intro(L1)).toContain(OWNERSHIP.mainPrivate);
  });

  it('a puzzle shared with the learner is returned, with or without the source, and not after revocation', async () => {
    expect(await covering(L1, ['shared'])).toEqual([OWNERSHIP.publicPuzzle, OWNERSHIP.sharedPrivate].sort());
    expect(await intro(L1)).toContain(OWNERSHIP.sharedPrivate);
    expect(await candidates(L1)).toContain('shared');
    await share(tg, OWNERSHIP.sharedPrivate, L1, true);
    expect(await covering(L1, ['shared'])).toContain(OWNERSHIP.sharedPrivate);
    await revokeShare(tg, OWNERSHIP.sharedPrivate, L1);
    expect(await covering(L1, ['shared'])).toEqual([OWNERSHIP.publicPuzzle]);
    expect(await intro(L1)).not.toContain(OWNERSHIP.sharedPrivate);
  });

  it('draft puzzles and draft or rejected questions are excluded; public puzzles are included', async () => {
    expect(await covering(L1, ['drafty'])).toEqual([]);
    expect(await intro(L1)).not.toContain(OWNERSHIP.draftPuzzle);
    expect(await intro(L1)).toContain(OWNERSHIP.publicPuzzle);
    expect(await covering(L1, ['hidden'])).toEqual([]);
  });

  it('a concept tested only by an unshared private puzzle is not a tier 2 candidate', async () => {
    const list = await candidates(L1);
    expect(list).toEqual(['mine', 'shared']);
    expect(list).not.toContain('priv');
    expect(list).not.toContain('lonely');
    expect(list).not.toContain('drafty');
    expect(list).not.toContain('hidden');
  });

  it('the three queries take only the learner id as identity (no role, no see-all)', () => {
    const infos = tg.graph.listQueries();
    for (const name of ['playable_puzzles_covering', 'intro_puzzles', 'decayed_or_unseen_concepts']) {
      const params = infos.find((i) => i.name === name)!.params;
      expect(params).toContain('userId');
      expect(params.filter((p) => /role|seeAll|admin|staff/i.test(p))).toEqual([]);
    }
  });
});

// ---- Goal stretch (T055): resolve_goal_concepts, upsert_goal, create_cover_task ----

const DIM = 64;
/** A unit-length vector of the stub dimension from its first components. */
const vec = (...head: number[]): number[] => {
  const v = new Array<number>(DIM).fill(0);
  head.forEach((x, i) => {
    v[i] = x;
  });
  return v;
};

interface GoalRow {
  conceptId: string;
  slug: string;
  name: string;
  score: number;
  bestChunkId: string | null;
  via: 'passage' | 'name';
}

const resolveParams = (over: Record<string, unknown> = {}): QueryParams =>
  ({
    userId: L1,
    embedding: vec(1),
    k: 20,
    minSimilarity: 0.5,
    goalText: 'nothing relevant',
    goalSlugText: 'nothing-relevant',
    limit: 20,
    ...over,
  }) as QueryParams;

async function addChunk(
  sourceId: string,
  chunkId: string,
  embedding: number[],
  mentions: string[],
  text = `Text of ${chunkId}.`,
): Promise<void> {
  await tg.cypher(
    `MATCH (s:Source {id: $sourceId})
     CREATE (s)-[:HAS_CHUNK]->(k:Chunk {id: $chunkId, position: 0, text: $text, embedding: vecf32($embedding)})
     WITH k
     UNWIND $mentions AS slug
     MATCH (c:Concept {id: slug})
     CREATE (k)-[:MENTIONS]->(c)`,
    { sourceId, chunkId, text, embedding, mentions: mentions.map(cid) },
  );
}

async function addSource(sourceId: string, ownerId: string, puzzleId?: string): Promise<void> {
  await tg.cypher(`MATCH (o:Learner {id: $ownerId}) CREATE (o)-[:OWNS]->(:Source {id: $sourceId, title: $sourceId, kind: 'text', createdAt: 1})`, {
    ownerId,
    sourceId,
  });
  if (puzzleId) {
    await tg.cypher(`MATCH (s:Source {id: $sourceId}), (p:Puzzle {id: $puzzleId}) CREATE (s)-[:YIELDED]->(p)`, { sourceId, puzzleId });
  }
}

describe('resolve_goal_concepts', () => {
  beforeEach(async () => {
    await addLearner(tg, L1, 'Main');
    await addLearner(tg, L2, 'Other');
    await addAgents(tg);
    await addConcepts(tg, [
      { slug: 'quokka' },
      { slug: 'wombat' },
      { slug: 'numbat' },
      { slug: 'dingo' },
      { slug: 'koala' },
      { slug: 'echidna' },
      { slug: 'zeta-widget' },
    ]);
    await addPuzzle(tg, { id: 'pz-public', name: 'Public', ownerId: L2, visibility: 'public', questions: [{ id: 'qz-public', tests: ['numbat'] }] });
    await addPuzzle(tg, { id: 'pz-play', name: 'Play only', ownerId: L2, visibility: 'private', questions: [{ id: 'qz-play', tests: ['dingo'] }] });
    await addPuzzle(tg, { id: 'pz-src', name: 'With source', ownerId: L2, visibility: 'private', questions: [{ id: 'qz-src', tests: ['koala'] }] });
    // own source: the nearest chunk (similarity 1) and a farther one (similarity 0.6)
    await addSource('src-own', L1);
    await addChunk('src-own', 'own-near', vec(1), ['quokka']);
    await addChunk('src-own', 'own-mid', vec(0.6, 0.8), ['quokka', 'wombat']);
    await addChunk('src-own', 'own-far', vec(0, 0, 1), ['echidna']);
    // sources of another learner: public puzzle, play-only share, share with the source
    await addSource('src-public', L2, 'pz-public');
    await addChunk('src-public', 'public-chunk', vec(1), ['numbat']);
    await addSource('src-play', L2, 'pz-play');
    await addChunk('src-play', 'play-chunk', vec(1), ['dingo']);
    await share(tg, 'pz-play', L1, false);
    await addSource('src-shared', L2, 'pz-src');
    await addChunk('src-shared', 'shared-chunk', vec(1), ['koala']);
    await share(tg, 'pz-src', L1, true);
  });

  const resolve = (over: Record<string, unknown> = {}) => q<GoalRow>('resolve_goal_concepts', resolveParams(over));
  const slugs = (rows: GoalRow[], via?: string) => rows.filter((r) => !via || r.via === via).map((r) => r.slug);

  it('passage branch: only chunks the learner may read, above the similarity threshold, nearest concept first', async () => {
    const rows = await resolve();
    expect(rows.every((r) => r.via === 'passage')).toBe(true);
    // own chunks and the chunk of a source shared with withSource true; not the public puzzle's or the play-only share's source
    expect(slugs(rows).sort()).toEqual(['koala', 'quokka', 'wombat']);
    expect(slugs(rows)).not.toContain('numbat');
    expect(slugs(rows)).not.toContain('dingo');
    // below the threshold (similarity 0) is not returned
    expect(slugs(rows)).not.toContain('echidna');
    // score is a similarity (1 - cosine distance), so the nearest chunk ranks first
    const quokka = rows.find((r) => r.slug === 'quokka')!;
    const wombat = rows.find((r) => r.slug === 'wombat')!;
    expect(quokka.score).toBeCloseTo(1, 4);
    expect(wombat.score).toBeCloseTo(0.6, 3);
    expect(rows.findIndex((r) => r.slug === 'quokka')).toBeLessThan(rows.findIndex((r) => r.slug === 'wombat'));
    expect(rows.map((r) => r.score)).toEqual([...rows.map((r) => r.score)].sort((a, b) => b - a));
  });

  it('one row per concept with its best chunk', async () => {
    const rows = await resolve();
    expect(slugs(rows).filter((s) => s === 'quokka')).toHaveLength(1);
    expect(rows.find((r) => r.slug === 'quokka')!.bestChunkId).toBe('own-near');
    expect(rows.find((r) => r.slug === 'wombat')!.bestChunkId).toBe('own-mid');
    expect(rows.find((r) => r.slug === 'koala')!.bestChunkId).toBe('shared-chunk');
  });

  it('the threshold is a similarity: raising it drops the farther concept', async () => {
    expect(slugs(await resolve({ minSimilarity: 0.9 })).sort()).toEqual(['koala', 'quokka']);
    expect(slugs(await resolve({ minSimilarity: 0.0 }))).toContain('echidna');
  });

  it('a revoked share or a play-only share removes the chunk; another learner sees only their own', async () => {
    await share(tg, 'pz-src', L1, false);
    expect(slugs(await resolve())).not.toContain('koala');
    await share(tg, 'pz-src', L1, true);
    await revokeShare(tg, 'pz-src', L1);
    expect(slugs(await resolve())).not.toContain('koala');
    // L2 owns the other sources, not src-own
    const forL2 = slugs(await resolve({ userId: L2 }));
    expect(forL2.sort()).toEqual(['dingo', 'koala', 'numbat']);
  });

  it('name branch: a concept whose name or slug occurs in the goal is returned with via name even without a chunk', async () => {
    const rows = await resolve({
      embedding: vec(0, 0, 0, 1),
      goalText: 'i want to learn about the zeta-widget design',
      goalSlugText: 'i-want-to-learn-about-the-zeta-widget-design',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ slug: 'zeta-widget', via: 'name', bestChunkId: null, score: 1 });
    const byName = await resolve({
      embedding: vec(0, 0, 0, 1),
      goalText: 'practise echidna facts',
      goalSlugText: 'practise-echidna-facts',
    });
    expect(slugs(byName, 'name')).toEqual(['echidna']);
  });

  it('declares owner 004, mode read, and the access-free parameters', () => {
    const info = tg.graph.listQueries().find((i) => i.name === 'resolve_goal_concepts')!;
    expect(info.owner).toBe('004');
    expect(info.mode).toBe('read');
    expect(info.params).toContain('userId');
  });
});

describe('upsert_goal', () => {
  const upsert = (over: Record<string, unknown> = {}) =>
    q<{ goalId: string; targetIds: string[]; prerequisiteIds: string[] }>('upsert_goal', {
      goalId: 'goal-1',
      learnerId: L1,
      text: 'learn the top',
      now: NOW,
      targets: [{ conceptId: cid('top'), score: 0.8 }],
      depth: 4,
      ...over,
    } as QueryParams);

  beforeEach(async () => {
    await loadDiamond(tg);
  });

  it('writes the goal, HAS_GOAL, TARGETS with the score, and returns the scope with upstream prerequisites', async () => {
    const [row] = await upsert();
    expect(row!.goalId).toBe('goal-1');
    expect(row!.targetIds).toEqual([cid('top')]);
    expect([...row!.prerequisiteIds].sort()).toEqual([cid('base'), cid('left'), cid('right')].sort());
    expect(await tg.count('Goal')).toBe(1);
    expect(await tg.countEdges('HAS_GOAL')).toBe(1);
    const targets = await tg.cypher<{ id: string; score: number }>(
      `MATCH (:Goal {id: 'goal-1'})-[r:TARGETS]->(c:Concept) RETURN c.id AS id, r.score AS score`,
    );
    expect(targets).toEqual([{ id: cid('top'), score: 0.8 }]);
    const goal = await tg.cypher<{ text: string; active: boolean; createdAt: number }>(
      `MATCH (g:Goal {id: 'goal-1'}) RETURN g.text AS text, g.active AS active, g.createdAt AS createdAt`,
    );
    expect(goal).toEqual([{ text: 'learn the top', active: true, createdAt: NOW }]);
  });

  it('applies the depth as a filter', async () => {
    const [row] = await upsert({ depth: 1 });
    expect([...row!.prerequisiteIds].sort()).toEqual([cid('left'), cid('right')].sort());
  });

  it('is idempotent on the same id', async () => {
    await upsert();
    await upsert({ now: NOW + 1000 });
    expect(await tg.count('Goal')).toBe(1);
    expect(await tg.countEdges('HAS_GOAL')).toBe(1);
    expect(await tg.countEdges('TARGETS')).toBe(1);
    const goal = await tg.cypher<{ createdAt: number }>(`MATCH (g:Goal {id: 'goal-1'}) RETURN g.createdAt AS createdAt`);
    expect(goal[0]!.createdAt).toBe(NOW);
  });

  it('a new goal makes the previous one inactive', async () => {
    await upsert();
    await upsert({ goalId: 'goal-2', text: 'learn the base', targets: [{ conceptId: cid('base'), score: 1 }] });
    const rows = await tg.cypher<{ id: string; active: boolean }>(`MATCH (g:Goal) RETURN g.id AS id, g.active AS active ORDER BY id`);
    expect(rows).toEqual([
      { id: 'goal-1', active: false },
      { id: 'goal-2', active: true },
    ]);
    // returning to the first goal reactivates it and deactivates the second
    await upsert();
    const again = await tg.cypher<{ id: string; active: boolean }>(`MATCH (g:Goal) RETURN g.id AS id, g.active AS active ORDER BY id`);
    expect(again).toEqual([
      { id: 'goal-1', active: true },
      { id: 'goal-2', active: false },
    ]);
  });

  it('empty targets still write the goal but return no row', async () => {
    expect(await upsert({ targets: [] })).toEqual([]);
    expect(await tg.count('Goal')).toBe(1);
    expect(await tg.countEdges('HAS_GOAL')).toBe(1);
    expect(await tg.countEdges('TARGETS')).toBe(0);
  });

  it('a target without prerequisites returns an empty prerequisite list', async () => {
    const [row] = await upsert({ targets: [{ conceptId: cid('base'), score: 1 }] });
    expect(row!.prerequisiteIds).toEqual([]);
  });
});

describe('create_cover_task', () => {
  beforeEach(async () => {
    await loadDiamond(tg);
    await q('record_decision', {
      decisionId: 'dec-cover', learnerId: L1, kind: 'coverage_request', summary: 's', flags: ['coverage_gap'], now: NOW,
      modelCalls: 0, inputTokens: 0, outputTokens: 0, embeddingTokens: 0, llmProvider: '', llmModel: '', puzzleId: '', goalId: '',
      evidence: [{ label: 'Concept', nodeId: cid('top'), role: 'target', reason: 'target', weight: 0.5 }],
    });
  });

  const create = (over: Record<string, unknown> = {}) =>
    q<{ taskId: string; status: string; concerns: number }>('create_cover_task', {
      taskId: 'task-cover-1',
      learnerId: L1,
      decisionId: 'dec-cover',
      conceptIds: [cid('top'), cid('left')],
      now: NOW,
      ...over,
    } as QueryParams);

  it('creates a queued cover task with both REQUESTED edges, ASSIGNED_TO the Curator, and CONCERNS per concept', async () => {
    expect(await create()).toEqual([{ taskId: 'task-cover-1', status: 'queued', concerns: 2 }]);
    const task = await tg.cypher<{ kind: string; status: string; createdAt: number }>(
      `MATCH (t:Task {id: 'task-cover-1'}) RETURN t.kind AS kind, t.status AS status, t.createdAt AS createdAt`,
    );
    expect(task).toEqual([{ kind: 'cover', status: 'queued', createdAt: NOW }]);
    expect(await tg.countEdges('REQUESTED')).toBe(2);
    const requesters = await tg.cypher<{ label: string }>(`MATCH (r)-[:REQUESTED]->(:Task {id: 'task-cover-1'}) RETURN labels(r)[0] AS label ORDER BY label`);
    expect(requesters).toEqual([{ label: 'Decision' }, { label: 'Learner' }]);
    const assigned = await tg.cypher<{ name: string }>(`MATCH (:Task {id: 'task-cover-1'})-[:ASSIGNED_TO]->(a:Agent) RETURN a.name AS name`);
    expect(assigned).toEqual([{ name: 'Curator' }]);
    const concerns = await tg.cypher<{ id: string }>(`MATCH (:Task {id: 'task-cover-1'})-[:CONCERNS]->(c:Concept) RETURN c.id AS id ORDER BY id`);
    expect(concerns.map((c) => c.id)).toEqual([cid('top'), cid('left')].sort());
    // get_decision reads the task back
    const [decision] = await q<{ coverageTaskId: string | null }>('get_decision', { decisionId: 'dec-cover' });
    expect(decision!.coverageTaskId).toBe('task-cover-1');
  });

  it('a second call creates nothing new and returns the task unchanged', async () => {
    await create();
    await tg.cypher(`MATCH (t:Task {id: 'task-cover-1'}) SET t.status = 'running'`);
    const second = await create({ now: NOW + 5000 });
    expect(second).toEqual([{ taskId: 'task-cover-1', status: 'running', concerns: 2 }]);
    expect(await tg.count('Task')).toBe(1);
    expect(await tg.countEdges('REQUESTED')).toBe(2);
    expect(await tg.countEdges('ASSIGNED_TO')).toBe(1);
    expect(await tg.countEdges('CONCERNS')).toBe(2);
    expect(await tg.count('Agent')).toBe(2);
  });

  it('creates nothing for a decision that is not for this learner', async () => {
    await addLearner(tg, L2, 'Other');
    expect(await create({ learnerId: L2 })).toEqual([]);
    expect(await tg.count('Task')).toBe(0);
  });
});

describe('goal and task parts of decision_path and get_decision (T061)', () => {
  const baseDecision = (over: Record<string, unknown>) =>
    ({
      learnerId: L1, summary: 's', now: NOW, modelCalls: 0, inputTokens: 0, outputTokens: 0, embeddingTokens: 0, llmProvider: '', llmModel: '', puzzleId: '',
      evidence: [{ label: 'Concept', nodeId: cid('top'), role: 'target', reason: 'target', weight: 0.5 }],
      ...over,
    }) as QueryParams;

  it('TOWARD, TARGETS, REQUESTED, and CONCERNS rows; get_decision lists the task and goal concepts', async () => {
    await loadDiamond(tg);
    await q('upsert_goal', {
      goalId: 'goal-x', learnerId: L1, text: 'learn the top', now: NOW,
      targets: [{ conceptId: cid('top'), score: 1 }], depth: 4,
    } as QueryParams);
    await q('record_decision', baseDecision({ decisionId: 'dec-goal', kind: 'coverage_request', flags: ['coverage_gap', 'coverage_requested'], goalId: 'goal-x' }));
    await q('create_cover_task', {
      taskId: 'task-x', learnerId: L1, decisionId: 'dec-goal', conceptIds: [cid('top')], now: NOW,
    } as QueryParams);

    const rows = await q<PathRowT>('decision_path', { decisionId: 'dec-goal', learnerId: L1, userId: L1, depth: 4 });
    const part = (p: string) => rows.filter((r) => r.part === p);
    expect(part('toward')).toHaveLength(1);
    expect(part('toward')[0]).toMatchObject({ type: 'TOWARD', toLabel: 'Goal', toId: 'goal-x', toData: { text: 'learn the top' } });
    expect(part('targets')[0]).toMatchObject({ fromLabel: 'Goal', toLabel: 'Concept', toId: cid('top') });
    expect(part('requested')[0]).toMatchObject({ type: 'REQUESTED', toLabel: 'Task', toId: 'task-x', toData: { kind: 'cover', status: 'queued' } });
    expect(part('concerns')[0]).toMatchObject({ fromLabel: 'Task', toLabel: 'Concept', toId: cid('top') });

    const [decision] = await q<{ coverageTaskId: string; coverageConcepts: unknown[]; goalConcepts: unknown[] }>('get_decision', { decisionId: 'dec-goal' });
    expect(decision!.coverageTaskId).toBe('task-x');
    expect(decision!.coverageConcepts).toEqual([{ conceptId: cid('top'), name: 'TOP' }]);
    expect(decision!.goalConcepts).toEqual([{ conceptId: cid('top'), name: 'TOP' }]);
  });

  it('a decision without goal or task has empty lists and no goal or task rows', async () => {
    await loadDiamond(tg);
    await q('record_decision', baseDecision({ decisionId: 'dec-plain', kind: 'recommendation', flags: [], goalId: '' }));
    const [plain] = await q<{ coverageTaskId: string | null; coverageConcepts: unknown[]; goalConcepts: unknown[] }>('get_decision', { decisionId: 'dec-plain' });
    expect(plain).toMatchObject({ coverageTaskId: null, coverageConcepts: [], goalConcepts: [] });
    const rows = await q<PathRowT>('decision_path', { decisionId: 'dec-plain', learnerId: L1, userId: L1, depth: 4 });
    expect(rows.filter((r) => ['toward', 'targets', 'requested', 'concerns'].includes(r.part))).toEqual([]);
  });
});
