import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { QueryParams } from '../src';
import { createTestGraph, type TestGraph } from '../src/testing';
import { buildGameplayFixture, DEFAULT_IDS, share, unshare, type Run } from './gameplay.fixture';

const { A, B, C, R, M } = DEFAULT_IDS;
const NOW = 1_760_000_000_000;

let tg: TestGraph;
const run: Run = (text, params) => tg.cypher(text, params as QueryParams);
const q = <T = Record<string, unknown>>(name: string, params: QueryParams) => tg.graph.query<T>(name, params);

beforeAll(async () => {
  tg = await createTestGraph();
});
afterAll(async () => {
  await tg?.dispose();
});
beforeEach(async () => {
  await tg.clear();
  await buildGameplayFixture(run);
});

async function startSession(learner = A, puzzle = 'P1', id = 's1') {
  await q('create_session', { sessionId: id, userId: learner, puzzleId: puzzle, now: NOW } as never);
  return id;
}

const ANSWERS = [
  { questionId: 'q1', blank: 0, word: 'index', correct: true },
  { questionId: 'q1', blank: 1, word: '', correct: false },
  { questionId: 'q2', blank: 0, word: '', correct: false },
  { questionId: 'q3', blank: 0, word: '', correct: false },
];
const MASTERY = [
  { conceptId: 'c-index', before: 0.5, after: 0.3185, attempts: 3 },
  { conceptId: 'c-btree', before: 0.5, after: 0.35, attempts: 1 },
];

describe('list_puzzles', () => {
  it('returns P1 for a learner with origin, access, owner name and counts', async () => {
    const rows = await q<Record<string, unknown>>('list_puzzles', { userId: A });
    const p1 = rows.find((r) => r.id === 'P1')!;
    expect(p1).toMatchObject({
      origin: 'seed',
      access: 'public',
      ownerName: 'Max',
      sourceShared: false,
      sourceId: null,
      questionCount: 3,
      visibility: 'public',
    });
    const concepts = (p1.concepts as Array<{ name: string }>).map((c) => c.name).sort();
    expect(concepts).toEqual(['B-trees', 'Indexes']);
  });

  it('labels the owner as owner', async () => {
    const rows = await q<{ id: string; access: string }>('list_puzzles', { userId: M });
    expect(rows.find((r) => r.id === 'P1')!.access).toBe('owner');
  });

  it('shows private puzzles only to owner and shared users; drafts to nobody; no staff exception', async () => {
    const ids = async (u: string) => (await q<{ id: string }>('list_puzzles', { userId: u })).map((r) => r.id).sort();
    expect(await ids(A)).toEqual(['P1', 'P4', 'P5']);
    expect(await ids(B)).toEqual(['P1', 'P2', 'P4']);
    expect(await ids(M)).toEqual(['P1', 'P4']);
    expect(await ids(R)).toEqual(['P1', 'P4']);
    await share(run, 'P2', A, false);
    expect(await ids(A)).toEqual(['P1', 'P2', 'P4', 'P5']);
    await unshare(run, 'P2', A);
    expect(await ids(A)).toEqual(['P1', 'P4', 'P5']);
  });

  it('sourceShared / sourceId follow canReadSource', async () => {
    const find = async (u: string, id: string) =>
      (await q<{ id: string; access: string; sourceShared: boolean; sourceId: string | null }>('list_puzzles', { userId: u })).find(
        (r) => r.id === id,
      )!;
    expect(await find(B, 'P2')).toMatchObject({ access: 'owner', sourceShared: true, sourceId: 'S2' });
    await share(run, 'P2', A, false);
    expect(await find(A, 'P2')).toMatchObject({ access: 'shared', sourceShared: false, sourceId: null });
    await share(run, 'P2', A, true);
    expect(await find(A, 'P2')).toMatchObject({ access: 'shared', sourceShared: true, sourceId: 'S2' });
    expect(await find(A, 'P4')).toMatchObject({ access: 'public', sourceShared: false, sourceId: null });
  });

  it('access precedence: shared beats public', async () => {
    await share(run, 'P4', A, false);
    const rows = await q<{ id: string; access: string }>('list_puzzles', { userId: A });
    expect(rows.find((r) => r.id === 'P4')!.access).toBe('shared');
  });
});

describe('play_puzzle', () => {
  it('returns exactly id, name, origin, questions, words with no answers', async () => {
    const rows = await q<Record<string, unknown>>('play_puzzle', { puzzleId: 'P1', userId: A });
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(Object.keys(row).sort()).toEqual(['id', 'name', 'origin', 'questions', 'words']);
    const questions = row.questions as Array<Record<string, unknown>>;
    for (const question of questions) expect(Object.keys(question).sort()).toEqual(['blanks', 'id', 'order', 'sentence']);
    expect(questions.map((x) => [x.id, x.blanks])).toEqual([
      ['q1', 2],
      ['q2', 1],
      ['q3', 1],
    ]);
    const words = row.words as string[];
    expect([...words].sort()).toEqual(['B-tree', 'cache', 'heap', 'index', 'writes']);
    expect(JSON.stringify(row)).not.toMatch(/secretdraft|secretrejected/);
  });

  it('returns zero rows for unknown, draft, and unplayable puzzles', async () => {
    expect(await q('play_puzzle', { puzzleId: 'nope', userId: A })).toHaveLength(0);
    expect(await q('play_puzzle', { puzzleId: 'P3', userId: B })).toHaveLength(0);
    expect(await q('play_puzzle', { puzzleId: 'P2', userId: A })).toHaveLength(0);
    expect(await q('play_puzzle', { puzzleId: 'P2', userId: M })).toHaveLength(0);
    expect(await q('play_puzzle', { puzzleId: 'P2', userId: B })).toHaveLength(1);
  });
});

describe('create_session / get_session / puzzle_answer_key / learner_mastery', () => {
  it('create_session creates PLAYED and OF with startedAt and no submittedAt; two calls make two sessions', async () => {
    const rows = await q<{ sessionId: string }>('create_session', { sessionId: 's1', userId: A, puzzleId: 'P1', now: NOW });
    expect(rows).toEqual([{ sessionId: 's1' }]);
    await startSession(A, 'P1', 's2');
    expect(await tg.count('Session')).toBe(2);
    expect(await tg.countEdges('PLAYED')).toBe(2);
    expect(await tg.countEdges('OF')).toBe(2);
    const [s] = await tg.cypher<{ p: Record<string, unknown> }>(`MATCH (s:Session {id: 's1'}) RETURN properties(s) AS p`);
    expect(s!.p).toEqual({ id: 's1', startedAt: NOW });
  });

  it('create_session refuses an unplayable puzzle', async () => {
    expect(await q('create_session', { sessionId: 'x', userId: A, puzzleId: 'P2', now: NOW })).toHaveLength(0);
    expect(await q('create_session', { sessionId: 'x', userId: A, puzzleId: 'P3', now: NOW })).toHaveLength(0);
    expect(await tg.count('Session')).toBe(0);
  });

  it('get_session returns the owner a fresh session and nothing to others', async () => {
    await startSession();
    const rows = await q<Record<string, unknown>>('get_session', { sessionId: 's1', learnerId: A });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sessionId: 's1',
      puzzleId: 'P1',
      puzzleName: 'Databases 101',
      puzzleOrigin: 'seed',
      startedAt: NOW,
      submittedAt: null,
      answers: [],
      masteryChanges: [],
    });
    expect(await q('get_session', { sessionId: 'nope', learnerId: A })).toHaveLength(0);
    expect(await q('get_session', { sessionId: 's1', learnerId: B })).toHaveLength(0);
    expect(await q('get_session', { sessionId: 's1', learnerId: M })).toHaveLength(0);
  });

  it('puzzle_answer_key lists approved questions in order with answers and concepts', async () => {
    const rows = await q<{ questionId: string; order: number; sentence: string; answers: string[]; concepts: Array<{ id: string }> }>(
      'puzzle_answer_key',
      { puzzleId: 'P1' },
    );
    expect(rows.map((r) => r.questionId)).toEqual(['q1', 'q2', 'q3']);
    expect(rows[0]!.answers).toEqual(['index', 'writes']);
    expect(rows[0]!.sentence).toContain('___');
    expect(rows[1]!.concepts.map((c) => c.id).sort()).toEqual(['c-btree', 'c-index']);
    expect(rows[2]!.concepts).toEqual([]);
  });

  it('learner_mastery is empty for a new learner, honours the filter, and is isolated', async () => {
    expect(await q('learner_mastery', { learnerId: A, conceptIds: null })).toHaveLength(0);
    await q('upsert_mastery', {
      learnerId: A,
      rows: [
        { conceptId: 'c-index', score: 0.4, attempts: 2, lastSeen: NOW },
        { conceptId: 'c-sql', score: 0.6, attempts: 1, lastSeen: NOW },
      ],
    });
    const all = await q<{ conceptId: string }>('learner_mastery', { learnerId: A, conceptIds: null });
    expect(all.map((r) => r.conceptId)).toEqual(['c-index', 'c-sql']);
    const some = await q<{ conceptId: string }>('learner_mastery', { learnerId: A, conceptIds: ['c-sql'] });
    expect(some.map((r) => r.conceptId)).toEqual(['c-sql']);
    expect(await q('learner_mastery', { learnerId: B, conceptIds: null })).toHaveLength(0);
  });
});

describe('record_answers', () => {
  const call = (overrides: Record<string, unknown> = {}) =>
    q<{ sessionId: string; answersWritten: number; conceptsUpdated: number }>('record_answers', {
      sessionId: 's1',
      learnerId: A,
      answers: ANSWERS,
      mastery: MASTERY,
      score: 10,
      maxScore: 40,
      now: NOW + 5,
      ...overrides,
    } as never);

  it('writes answers, score, mastery and CHANGED_MASTERY in one call', async () => {
    await startSession();
    const rows = await call();
    expect(rows).toEqual([{ sessionId: 's1', answersWritten: 4, conceptsUpdated: 2 }]);
    expect(await tg.countEdges('ANSWERED')).toBe(4);
    const [s] = await tg.cypher<{ score: number; maxScore: number; submittedAt: number }>(
      `MATCH (s:Session {id: 's1'}) RETURN s.score AS score, s.maxScore AS maxScore, s.submittedAt AS submittedAt`,
    );
    expect(s).toEqual({ score: 10, maxScore: 40, submittedAt: NOW + 5 });
    const hm = await tg.cypher(
      `MATCH (:Learner {id: $A})-[h:HAS_MASTERY]->(c:Concept) RETURN c.id AS id, h.score AS score, h.attempts AS attempts, h.lastSeen AS lastSeen ORDER BY id`,
      { A },
    );
    expect(hm).toEqual([
      { id: 'c-btree', score: 0.35, attempts: 1, lastSeen: NOW + 5 },
      { id: 'c-index', score: 0.3185, attempts: 3, lastSeen: NOW + 5 },
    ]);
    const cm = await tg.cypher(
      `MATCH (:Session {id: 's1'})-[d:CHANGED_MASTERY]->(c:Concept) RETURN c.id AS id, d.before AS before, d.after AS after ORDER BY id`,
    );
    expect(cm).toEqual([
      { id: 'c-btree', before: 0.5, after: 0.35 },
      { id: 'c-index', before: 0.5, after: 0.3185 },
    ]);
    const edge = await tg.cypher(`MATCH (:Session {id: 's1'})-[r:ANSWERED]->(q:Question {id: 'q1'}) RETURN r.blank AS blank, r.word AS word, r.correct AS correct ORDER BY blank`);
    expect(edge).toEqual([
      { blank: 0, word: 'index', correct: true },
      { blank: 1, word: '', correct: false },
    ]);
  });

  it('a second call returns zero rows and changes nothing', async () => {
    await startSession();
    await call();
    expect(await call({ score: 40 })).toHaveLength(0);
    expect(await tg.countEdges('ANSWERED')).toBe(4);
    const [s] = await tg.cypher<{ score: number }>(`MATCH (s:Session {id: 's1'}) RETURN s.score AS score`);
    expect(s!.score).toBe(10);
  });

  it("another learner's id returns zero rows and writes nothing", async () => {
    await startSession();
    expect(await call({ learnerId: B })).toHaveLength(0);
    expect(await tg.countEdges('ANSWERED')).toBe(0);
    expect(await tg.countEdges('HAS_MASTERY')).toBe(0);
  });

  it('an empty $mastery still submits the session', async () => {
    await startSession();
    const rows = await call({ mastery: [] });
    expect(rows).toEqual([{ sessionId: 's1', answersWritten: 4, conceptsUpdated: 0 }]);
    expect(await tg.countEdges('HAS_MASTERY')).toBe(0);
    expect(await tg.countEdges('CHANGED_MASTERY')).toBe(0);
  });

  it('a run-time failure after the first clauses leaves nothing behind (atomic, path A)', async () => {
    await startSession();
    await expect(
      call({ answers: [{ questionId: 'q1', blank: { bad: 1 }, word: 'x', correct: true }] }),
    ).rejects.toThrow();
    expect(await tg.countEdges('ANSWERED')).toBe(0);
    expect(await tg.countEdges('HAS_MASTERY')).toBe(0);
    expect(await tg.countEdges('CHANGED_MASTERY')).toBe(0);
    const [s] = await tg.cypher<{ submittedAt: number | null }>(`MATCH (s:Session {id: 's1'}) RETURN s.submittedAt AS submittedAt`);
    expect(s!.submittedAt).toBeNull();
  });

  it('get_session after record_answers returns answers, mastery changes, and totals in order', async () => {
    await startSession();
    await call();
    const [row] = await q<{
      answers: Array<Record<string, unknown>>;
      masteryChanges: Array<Record<string, unknown>>;
      score: number;
      maxScore: number;
      submittedAt: number;
    }>('get_session', { sessionId: 's1', learnerId: A });
    expect(row!.answers).toEqual([
      { questionId: 'q1', order: 1, blank: 0, word: 'index', correct: true },
      { questionId: 'q1', order: 1, blank: 1, word: '', correct: false },
      { questionId: 'q2', order: 2, blank: 0, word: '', correct: false },
      { questionId: 'q3', order: 3, blank: 0, word: '', correct: false },
    ]);
    expect(row!.masteryChanges).toEqual([
      { conceptId: 'c-btree', name: 'B-trees', before: 0.5, after: 0.35 },
      { conceptId: 'c-index', name: 'Indexes', before: 0.5, after: 0.3185 },
    ]);
    expect([row!.score, row!.maxScore, row!.submittedAt]).toEqual([10, 40, NOW + 5]);
  });
});

describe('upsert_mastery', () => {
  const rows = (score: number, attempts: number) => ({
    learnerId: A,
    rows: [{ conceptId: 'c-index', score, attempts, lastSeen: NOW }],
  });

  it('creates, updates in place, and is idempotent', async () => {
    const first = await q<Record<string, unknown>>('upsert_mastery', rows(0.4, 2));
    expect(first).toEqual([{ conceptId: 'c-index', name: 'Indexes', score: 0.4, attempts: 2, lastSeen: NOW }]);
    await q('upsert_mastery', rows(0.4, 2));
    expect(await tg.countEdges('HAS_MASTERY')).toBe(1);
    await q('upsert_mastery', rows(0.7, 3));
    expect(await tg.countEdges('HAS_MASTERY')).toBe(1);
    const [row] = await q<{ score: number; attempts: number }>('learner_mastery', { learnerId: A, conceptIds: null });
    expect(row).toMatchObject({ score: 0.7, attempts: 3 });
  });

  it('writes nothing for an unknown concept and does not touch other learners', async () => {
    const none = await q('upsert_mastery', { learnerId: A, rows: [{ conceptId: 'c-nope', score: 1, attempts: 1, lastSeen: NOW }] });
    expect(none).toHaveLength(0);
    await q('upsert_mastery', rows(0.4, 2));
    expect(await q('learner_mastery', { learnerId: B, conceptIds: null })).toHaveLength(0);
    expect(await q('learner_mastery', { learnerId: C, conceptIds: null })).toHaveLength(0);
  });
});

type ListRow = { id: string; access: string; ownerName: string; sourceShared: boolean; sourceId: string | null };
const CALLERS = { A, B, C, R, M } as const;
const listFor = (u: string) => q<ListRow>('list_puzzles', { userId: u });
const canOpen = async (u: string, puzzle: string) => ({
  list: (await listFor(u)).some((r) => r.id === puzzle),
  play: (await q('play_puzzle', { puzzleId: puzzle, userId: u })).length === 1,
  start: (await q('create_session', { sessionId: `probe-${u}-${puzzle}`, userId: u, puzzleId: puzzle, now: NOW })).length === 1,
});
const ALL_OK = { list: true, play: true, start: true };
const NONE = { list: false, play: false, start: false };

describe('US4: access rule (canPlay) as a table', () => {
  it('without a share: P1 and P4 for everyone, P2 only for its owner B, P3 (draft) for nobody', async () => {
    const expected: Record<string, Record<string, boolean>> = {
      P1: { A: true, B: true, C: true, R: true, M: true },
      P4: { A: true, B: true, C: true, R: true, M: true },
      P2: { A: false, B: true, C: false, R: false, M: false },
      P3: { A: false, B: false, C: false, R: false, M: false },
    };
    for (const [puzzle, who] of Object.entries(expected)) {
      for (const [name, id] of Object.entries(CALLERS)) {
        expect(await canOpen(id, puzzle), `${name} on ${puzzle}`).toEqual(who[name] ? ALL_OK : NONE);
      }
    }
    expect(await tg.count('Session')).toBe(
      Object.values(expected).reduce((n, who) => n + Object.values(who).filter(Boolean).length, 0),
    );
  });

  it('a share opens P2 to A with access shared; source fields follow withSource; unshare closes it again', async () => {
    await share(run, 'P2', A, false);
    expect(await canOpen(A, 'P2')).toEqual(ALL_OK);
    expect(await canOpen(R, 'P2')).toEqual(NONE);
    expect(await canOpen(M, 'P2')).toEqual(NONE);
    expect((await listFor(A)).find((r) => r.id === 'P2')).toMatchObject({
      access: 'shared',
      ownerName: 'Bea',
      sourceShared: false,
      sourceId: null,
    });
    await share(run, 'P2', A, true);
    expect((await listFor(A)).find((r) => r.id === 'P2')).toMatchObject({ sourceShared: true, sourceId: 'S2' });
    expect((await listFor(B)).find((r) => r.id === 'P2')).toMatchObject({ access: 'owner', sourceShared: true, sourceId: 'S2' });
    await unshare(run, 'P2', A);
    expect(await canOpen(A, 'P2')).toEqual({ ...NONE, start: false });
  });

  it('sourceId is never set while sourceShared is false, for any caller', async () => {
    await share(run, 'P2', A, false);
    for (const id of Object.values(CALLERS)) {
      for (const row of await listFor(id)) {
        if (!row.sourceShared) expect(row.sourceId, `${id} on ${row.id}`).toBeNull();
        else expect(row.sourceId).not.toBeNull();
      }
    }
    for (const id of [A, B, C, M]) {
      expect((await listFor(id)).find((r) => r.id === 'P4')).toMatchObject({ sourceShared: false, sourceId: null });
    }
    expect((await listFor(R)).find((r) => r.id === 'P4')).toMatchObject({ access: 'owner', sourceShared: true, sourceId: 'S4' });
  });

  it('access precedence: owner, then shared, then public', async () => {
    expect((await listFor(R)).find((r) => r.id === 'P4')!.access).toBe('owner');
    await share(run, 'P4', A, false);
    expect((await listFor(A)).find((r) => r.id === 'P4')!.access).toBe('shared');
  });

  it('get_session and record_answers refuse a non-owner without writing', async () => {
    await startSession(A, 'P1', 's1');
    for (const id of [B, C, R, M]) {
      expect(await q('get_session', { sessionId: 's1', learnerId: id })).toHaveLength(0);
      const rows = await q('record_answers', {
        sessionId: 's1',
        learnerId: id,
        answers: ANSWERS,
        mastery: MASTERY,
        score: 10,
        maxScore: 40,
        now: NOW + 1,
      } as never);
      expect(rows).toHaveLength(0);
    }
    expect(await tg.countEdges('ANSWERED')).toBe(0);
    expect(await tg.countEdges('HAS_MASTERY')).toBe(0);
  });

  it('a session started while shared survives a revoked share', async () => {
    await share(run, 'P2', A, false);
    await startSession(A, 'P2', 'sx');
    await unshare(run, 'P2', A);
    expect(await q('get_session', { sessionId: 'sx', learnerId: A })).toHaveLength(1);
    const rows = await q('record_answers', {
      sessionId: 'sx',
      learnerId: A,
      answers: [{ questionId: 'q6', blank: 0, word: 'language', correct: true }],
      mastery: [],
      score: 10,
      maxScore: 10,
      now: NOW + 1,
    } as never);
    expect(rows).toHaveLength(1);
  });
});

describe('US5: question_grounding', () => {
  const submitSession = async (learner: string, puzzle: string, id: string, question: string) => {
    await startSession(learner, puzzle, id);
    await q('record_answers', {
      sessionId: id,
      learnerId: learner,
      answers: [{ questionId: question, blank: 0, word: '', correct: false }],
      mastery: [],
      score: 0,
      maxScore: 10,
      now: NOW + 1,
    } as never);
  };
  const grounding = (sessionId: string, userId: string) =>
    q<{ questionId: string; chunkId: string; sourceId: string; text: string }>('question_grounding', { sessionId, userId });

  it('returns nothing while the session is unsubmitted', async () => {
    await startSession(B, 'P2', 'u1');
    expect(await grounding('u1', B)).toHaveLength(0);
  });

  it('returns the lowest-position chunk to the source owner and nobody else', async () => {
    await submitSession(B, 'P2', 'b1', 'q6');
    const rows = await grounding('b1', B);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ questionId: 'q6', chunkId: 'ch-1', sourceId: 'S2' });
    expect(rows[0]!.text.startsWith('first chunk')).toBe(true);
    expect(await grounding('b1', A)).toHaveLength(0);
    expect(await grounding('b1', M)).toHaveLength(0);
    expect(await grounding('b1', R)).toHaveLength(0);
  });

  it('a shared user gets a passage only with withSource, and loses it when the share is revoked', async () => {
    await share(run, 'P2', A, false);
    await submitSession(A, 'P2', 'a1', 'q6');
    expect(await grounding('a1', A)).toHaveLength(0);
    await share(run, 'P2', A, true);
    expect(await grounding('a1', A)).toHaveLength(1);
    await unshare(run, 'P2', A);
    expect(await grounding('a1', A)).toHaveLength(0);
  });

  it('public puzzle: the source owner gets a passage, other players do not', async () => {
    await submitSession(A, 'P4', 'a4', 'q7');
    expect(await grounding('a4', A)).toHaveLength(0);
    await submitSession(R, 'P4', 'r4', 'q7');
    expect(await grounding('r4', R)).toHaveLength(1);
  });

  it('no GROUNDED_IN (seed, prompt-made) gives no rows, even for the owner', async () => {
    await submitSession(A, 'P1', 'a-seed', 'q2');
    expect(await grounding('a-seed', A)).toHaveLength(0);
    await submitSession(A, 'P5', 'a5', 'q8');
    expect(await grounding('a5', A)).toHaveLength(0);
    const p5 = (await listFor(A)).find((r) => r.id === 'P5')!;
    expect(p5).toMatchObject({ origin: 'prompt', sourceShared: true, sourceId: 'S5' });
  });
});
