import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GraphKit } from '@coach/graph-kit';
import { falkorConnectionFromEnv } from '@coach/graph-kit/testing';
import { MasteryService } from '../src/apps/gameplay/mastery.service';
import { buildGameplayFixture, share, unshare, type Run } from './support/gameplay-fixture';
import { PlayPuzzleDto } from '@coach/types';
import { ACCESS, describeAccessMatrix, describeRoleMatrix, type Actors } from './support/role-matrix';
import { createTestApp, type TestApp, type TestUser } from './support/test-app';

let app: TestApp;
let a: TestUser;
let b: TestUser;
let c: TestUser;
let r: TestUser;
let m: TestUser;
let run: Run;

/** The sorted set of all key names in a JSON body. */
function playKeys(body: unknown): string[] {
  const keys = new Set<string>();
  const walk = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        keys.add(k);
        walk(v);
      }
    }
  };
  walk(body);
  return [...keys].sort();
}

beforeAll(async () => {
  app = await createTestApp();
  a = await app.createUser({ role: 'learner', name: 'Ann' });
  b = await app.createUser({ role: 'learner', name: 'Bea' });
  c = await app.createUser({ role: 'learner', name: 'Cid' });
  r = await app.createUser({ role: 'reviewer', name: 'Rui' });
  m = await app.createUser({ role: 'admin', name: 'Max' });
  run = (text, params) => app.testGraph.cypher(text, params as Record<string, never>);
  await buildGameplayFixture(run, { A: a.id, B: b.id, C: c.id, R: r.id, M: m.id }, { createLearners: false });
});
afterAll(async () => {
  await app?.close();
});

// Keep the helpers referenced for the P2 stories added later (share / unshare are used by US4 tests).
void share;
void unshare;

async function start(user: TestUser, puzzle = 'P1'): Promise<string> {
  const res = await app.http.post(`/puzzles/${puzzle}/sessions`).set(user.auth);
  expect(res.status).toBe(201);
  return res.body.sessionId as string;
}

const submit = (user: TestUser, sessionId: string, answers: unknown[]) =>
  app.http.post(`/sessions/${sessionId}/submit`).set(user.auth).send({ answers });

const ALL_CORRECT = [
  { questionId: 'q1', blank: 0, word: 'index' },
  { questionId: 'q1', blank: 1, word: 'writes' },
  { questionId: 'q2', blank: 0, word: 'B-tree' },
  { questionId: 'q3', blank: 0, word: 'index' },
];

describe('S1: play and submit', () => {
  it('GET /puzzles lists P1 for a learner', async () => {
    const res = await app.http.get('/puzzles').set(a.auth);
    expect(res.status).toBe(200);
    const p1 = res.body.find((p: { id: string }) => p.id === 'P1');
    expect(p1).toMatchObject({ origin: 'seed', access: 'public', ownerName: 'Max', questionCount: 3, sourceShared: false });
    expect('sourceId' in p1).toBe(false);
  });

  it('GET /puzzles/P1/play is answer-free, uncached, and reshuffled', async () => {
    const orders = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      const res = await app.http.get('/puzzles/P1/play').set(a.auth);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(playKeys(res.body)).toEqual(['blanks', 'id', 'name', 'order', 'origin', 'questions', 'sentence', 'wordBank']);
      expect(res.body.origin).toBe('seed');
      expect(res.body.questions).toHaveLength(3);
      expect([...res.body.wordBank].sort()).toEqual(['B-tree', 'cache', 'heap', 'index', 'writes']);
      expect(JSON.stringify(res.body)).not.toMatch(/secretdraft|secretrejected/);
      orders.add(JSON.stringify(res.body.wordBank));
    }
    expect(orders.size).toBeGreaterThan(1);
  });

  it('start -> 201 and submit grades on the server (case and padding ignored)', async () => {
    const sessionId = await start(a);
    const res = await submit(a, sessionId, [{ questionId: 'q1', blank: 0, word: '  INDEX ' }]);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ sessionId, score: 10, maxScore: 40 });
    expect(res.body.puzzle).toEqual({ id: 'P1', name: 'Databases 101', origin: 'seed' });
    expect(typeof res.body.submittedAt).toBe('string');
    expect(res.body.questions).toHaveLength(3);
  });

  it('a repeated answer word is solvable from the single bank entry (score 20)', async () => {
    const sessionId = await start(a);
    const res = await submit(a, sessionId, [
      { questionId: 'q1', blank: 0, word: 'index' },
      { questionId: 'q3', blank: 0, word: 'index' },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.score).toBe(20);
  });

  it('empty answers score 0', async () => {
    const sessionId = await start(a);
    const res = await submit(a, sessionId, []);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ score: 0, maxScore: 40 });
  });

  it('a second submit answers 409 and changes nothing', async () => {
    const sessionId = await start(a);
    expect((await submit(a, sessionId, [{ questionId: 'q2', blank: 0, word: 'B-tree' }])).status).toBe(200);
    const edges = await app.testGraph.countEdges('ANSWERED');
    const [before] = await run(`MATCH (s:Session {id: $id}) RETURN s.score AS score, s.submittedAt AS at`, { id: sessionId });
    const res = await submit(a, sessionId, ALL_CORRECT);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SESSION_ALREADY_SUBMITTED');
    expect(await app.testGraph.countEdges('ANSWERED')).toBe(edges);
    const [after] = await run(`MATCH (s:Session {id: $id}) RETURN s.score AS score, s.submittedAt AS at`, { id: sessionId });
    expect(after).toEqual(before);
  });

  it('an unknown question answers 422 with the issue path and leaves the session unsubmitted', async () => {
    const sessionId = await start(a);
    const res = await submit(a, sessionId, [{ questionId: 'nope', blank: 0, word: 'x' }]);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.issues[0].path).toBe('answers.0.questionId');
    const [row] = await run(`MATCH (s:Session {id: $id}) RETURN s.submittedAt AS at`, { id: sessionId });
    expect((row as { at: unknown }).at).toBeNull();
    expect((await submit(a, sessionId, [])).status).toBe(200);
  });

  it('schema failures answer 422 (extra key, long word) and a malformed id answers 422', async () => {
    const sessionId = await start(a);
    const extra = await app.http.post(`/sessions/${sessionId}/submit`).set(a.auth).send({ answers: [], correct: true });
    expect(extra.status).toBe(422);
    const long = await submit(a, sessionId, [{ questionId: 'q1', blank: 0, word: 'x'.repeat(101) }]);
    expect(long.status).toBe(422);
    const badId = await app.http.get(`/puzzles/${'x'.repeat(65)}/play`).set(a.auth);
    expect(badId.status).toBe(422);
  });

  it('a draft or unplayable puzzle answers 404 on play and start', async () => {
    expect((await app.http.get('/puzzles/P3/play').set(b.auth)).status).toBe(404);
    expect((await app.http.post('/puzzles/P2/sessions').set(a.auth)).status).toBe(404);
    expect((await app.http.get('/puzzles/nope/play').set(a.auth)).status).toBe(404);
  });

  describeRoleMatrix(() => app, [
    { method: 'GET', path: '/puzzles', allowed: ['learner', 'reviewer', 'admin'] },
    { method: 'GET', path: '/puzzles/P1/play', allowed: ['learner', 'reviewer', 'admin'] },
    { method: 'POST', path: '/puzzles/P1/sessions', allowed: ['learner', 'reviewer', 'admin'] },
    { method: 'POST', path: '/sessions/none/submit', body: { answers: [] }, allowed: ['learner', 'reviewer', 'admin'] },
    { method: 'GET', path: '/sessions/none', allowed: ['learner', 'reviewer', 'admin'] },
    { method: 'GET', path: '/me/mastery', allowed: ['learner', 'reviewer', 'admin'] },
  ]);
});

describe('S2: review the result', () => {
  it('review has an item per blank, questions in order, and the folded mastery', async () => {
    const sessionId = await start(b);
    const res = await submit(b, sessionId, [{ questionId: 'q1', blank: 0, word: 'index' }]);
    expect(res.status).toBe(200);
    expect(res.body.review).toHaveLength(4);
    for (const item of res.body.review) {
      expect(Object.keys(item).sort()).toEqual(['blank', 'correct', 'expected', 'questionId', 'submitted']);
    }
    expect(res.body.review[1]).toMatchObject({ questionId: 'q1', blank: 1, submitted: null, expected: 'writes', correct: false });
    expect(res.body.questions.map((q: { id: string }) => q.id)).toEqual(['q1', 'q2', 'q3']);
    const mastery = res.body.mastery as Array<{ name: string; before: number; after: number }>;
    expect(mastery.map((x) => x.name)).toEqual(['B-trees', 'Indexes']);
    expect(mastery[0]!.before).toBe(0.5);
    expect(mastery[0]!.after).toBeCloseTo(0.35);
    expect(mastery[1]!.after).toBeCloseTo(0.3185);
  });

  it('GET /sessions/:id returns a body deep-equal to the submit response', async () => {
    const sessionId = await start(b);
    const posted = await submit(b, sessionId, [{ questionId: 'q1', blank: 0, word: 'index' }]);
    const got = await app.http.get(`/sessions/${sessionId}`).set(b.auth);
    expect(got.status).toBe(200);
    expect(got.body).toEqual(posted.body);
  });

  it('an unsubmitted session answers 409 and an unknown id answers 404', async () => {
    const sessionId = await start(b);
    const pending = await app.http.get(`/sessions/${sessionId}`).set(b.auth);
    expect(pending.status).toBe(409);
    expect(pending.body.error.code).toBe('SESSION_NOT_SUBMITTED');
    const unknown = await app.http.get('/sessions/does-not-exist').set(b.auth);
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('NOT_FOUND');
  });
});

describe('S3: be remembered', () => {
  const fold = (start: number, ones: number) => {
    let p = start;
    for (let i = 0; i < ones; i += 1) p = p + 0.3 * (1 - p);
    return p;
  };

  it('mastery accumulates over sessions, is private, and is read from the graph alone', async () => {
    // c plays P1 twice; the learner starts with no mastery.
    expect((await app.http.get('/me/mastery').set(c.auth)).body).toEqual([]);

    const first = await submit(c, await start(c), [{ questionId: 'q1', blank: 0, word: 'index' }]);
    expect(first.status).toBe(200);
    const afterOne = await app.http.get('/me/mastery').set(c.auth);
    expect(afterOne.status).toBe(200);
    const byName = (rows: Array<{ name: string }>, name: string) => rows.find((x) => x.name === name)! as never as {
      score: number;
      attempts: number;
      lastSeen: string;
    };
    expect(byName(afterOne.body, 'Indexes').attempts).toBe(3);
    expect(byName(afterOne.body, 'B-trees').attempts).toBe(1);
    for (const change of first.body.mastery as Array<{ name: string; after: number }>) {
      expect(byName(afterOne.body, change.name).score).toBeCloseTo(change.after);
    }

    const second = await submit(c, await start(c), ALL_CORRECT);
    expect(second.status).toBe(200);
    expect(second.body.score).toBe(40);
    const sessions = await run(`MATCH (:Learner {id: $id})-[:PLAYED]->(s:Session) RETURN count(s) AS n`, { id: c.id });
    expect((sessions[0] as { n: number }).n).toBe(2);

    const afterTwo = await app.http.get('/me/mastery').set(c.auth);
    expect(byName(afterTwo.body, 'Indexes').attempts).toBe(6);
    expect(byName(afterTwo.body, 'B-trees').attempts).toBe(2);
    expect(byName(afterTwo.body, 'Indexes').score).toBeCloseTo(fold(0.3185, 3));
    expect(byName(afterTwo.body, 'B-trees').score).toBeCloseTo(fold(0.35, 1));

    // Survives a restart: a fresh graph connection and a fresh service see the same body.
    const graph = await GraphKit.create({ ...falkorConnectionFromEnv(), graphName: app.testGraph.name });
    try {
      const fresh = new MasteryService(graph, { get: async () => 0.3 as never }, app.clock);
      expect(await fresh.list(c.id)).toEqual(afterTwo.body);
    } finally {
      await graph.close();
    }

    // Another learner sees nothing of it (the reviewer has not played).
    const mine = await app.http.get('/me/mastery').set(r.auth);
    expect(mine.body).toEqual([]);
  });

  it('a puzzle whose only question tests no concept submits with mastery: []', async () => {
    await run(
      `MATCH (m:Learner {id: $M})
       CREATE (m)-[:OWNS]->(p:Puzzle {id: 'P6', name: 'No concept', status: 'published', visibility: 'public', origin: 'seed'})
       CREATE (p)-[:CONTAINS {order: 1}]->(:Question {id: 'q10', sentence: 'Plain ___.', status: 'approved', answers: ['word']})`,
      { M: m.id },
    );
    const res = await submit(r, await start(r, 'P6'), [{ questionId: 'q10', blank: 0, word: 'word' }]);
    expect(res.status).toBe(200);
    expect(res.body.mastery).toEqual([]);
    expect(res.body.score).toBe(10);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// S4: fair play
// ---------------------------------------------------------------------------------------------------------------

/** A private published puzzle owned by `ownerId`, one question, plus a started and a submitted session of the owner. */
async function arrangePrivate(app_: TestApp, actors: Actors, tag: string) {
  const puzzle = `PX-${tag}`;
  await run(
    `MATCH (o:Learner {id: $owner})
     CREATE (o)-[:OWNS]->(p:Puzzle {id: $puzzle, name: $puzzle, status: 'published', visibility: 'private', origin: 'upload'})
     CREATE (p)-[:CONTAINS {order: 1}]->(:Question {id: $question, sentence: 'Matrix ___.', status: 'approved', answers: ['word']})`,
    { owner: actors.owner.id, puzzle, question: `qx-${tag}` },
  );
  await run(`MATCH (p:Puzzle {id: $puzzle}), (l:Learner {id: $l}) MERGE (p)-[sh:SHARED_WITH]->(l) SET sh.withSource = false, sh.at = 1`, {
    puzzle,
    l: actors.shared.id,
  });
  await run(`MATCH (p:Puzzle {id: $puzzle}), (l:Learner {id: $l}) MERGE (p)-[sh:SHARED_WITH]->(l) SET sh.withSource = true, sh.at = 1`, {
    puzzle,
    l: actors.sharedWithSource.id,
  });
  const open = await app_.http.post(`/puzzles/${puzzle}/sessions`).set(actors.owner.auth);
  const done = await app_.http.post(`/puzzles/${puzzle}/sessions`).set(actors.owner.auth);
  await app_.http.post(`/sessions/${done.body.sessionId}/submit`).set(actors.owner.auth).send({ answers: [] });
  return { puzzle, openSession: open.body.sessionId as string, doneSession: done.body.sessionId as string };
}

describe('S4: fair play (shared preset matrix)', () => {
  describeAccessMatrix(() => app, (a_, actors) => arrangePrivate(a_, actors, 'm'), [
    { name: 'GET play', request: (x) => ({ method: 'GET', path: `/puzzles/${x.puzzle}/play` }), expect: ACCESS.ownerAndShared },
    {
      name: 'POST start',
      request: (x) => ({ method: 'POST', path: `/puzzles/${x.puzzle}/sessions` }),
      expect: { owner: 201, shared: 201, sharedWithSource: 201, otherLearner: 404, reviewer: 404, admin: 404 },
    },
    {
      name: 'POST submit (session of the owner)',
      request: (x) => ({ method: 'POST', path: `/sessions/${x.openSession}/submit`, body: { answers: [] } }),
      expect: { otherLearner: 404, reviewer: 404, admin: 404, shared: 404, sharedWithSource: 404, owner: 200 },
    },
    {
      name: 'GET result (session of the owner)',
      request: (x) => ({ method: 'GET', path: `/sessions/${x.doneSession}` }),
      expect: ACCESS.ownerOnly,
    },
  ]);
});

describe('S4: fair play (fixture P2, P3)', () => {
  const list = async (u: TestUser) => (await app.http.get('/puzzles').set(u.auth)).body as Array<Record<string, unknown>>;

  it('owner and shared user open P2; everyone else gets the same 404 as for an unknown id', async () => {
    await share(run, 'P2', a.id, false);
    try {
      expect((await app.http.get('/puzzles/P2/play').set(b.auth)).status).toBe(200);
      expect((await app.http.get('/puzzles/P2/play').set(a.auth)).status).toBe(200);
      expect((await app.http.post('/puzzles/P2/sessions').set(b.auth)).status).toBe(201);
      expect((await app.http.post('/puzzles/P2/sessions').set(a.auth)).status).toBe(201);
      const unknown = await app.http.get('/puzzles/nope/play').set(c.auth);
      for (const u of [c, r, m]) {
        const play = await app.http.get('/puzzles/P2/play').set(u.auth);
        expect(play.status).toBe(404);
        expect(play.body).toEqual(unknown.body);
        expect((await app.http.post('/puzzles/P2/sessions').set(u.auth)).status).toBe(404);
      }
      // S4.4: lists
      expect((await list(b)).find((p) => p.id === 'P2')).toMatchObject({ access: 'owner' });
      expect((await list(a)).find((p) => p.id === 'P2')).toMatchObject({ access: 'shared', ownerName: 'Bea', sourceShared: false });
      for (const u of [c, r, m]) expect((await list(u)).some((p) => p.id === 'P2')).toBe(false);
    } finally {
      await unshare(run, 'P2', a.id);
    }
  });

  it('sourceId is present if and only if sourceShared is true, for every user', async () => {
    await share(run, 'P2', a.id, false);
    try {
      for (const u of [a, b, c, r, m]) {
        for (const item of await list(u)) {
          expect('sourceId' in item, `${u.name} on ${String(item.id)}`).toBe(item.sourceShared === true);
        }
      }
      expect((await list(r)).find((p) => p.id === 'P4')).toMatchObject({ sourceShared: true, sourceId: 'S4' });
      expect('sourceId' in (await list(a)).find((p) => p.id === 'P2')!).toBe(false);
    } finally {
      await unshare(run, 'P2', a.id);
    }
  });

  it('a session started while shared survives a revoked share', async () => {
    await share(run, 'P2', a.id, false);
    const sessionId = await start(a, 'P2');
    await unshare(run, 'P2', a.id);
    expect((await list(a)).some((p) => p.id === 'P2')).toBe(false);
    expect((await app.http.get('/puzzles/P2/play').set(a.auth)).status).toBe(404);
    expect((await app.http.post('/puzzles/P2/sessions').set(a.auth)).status).toBe(404);
    const res = await submit(a, sessionId, [{ questionId: 'q6', blank: 0, word: 'language' }]);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ score: 10, maxScore: 10 });
    expect(res.body.mastery.map((x: { name: string }) => x.name)).toEqual(['SQL']);
    expect((await app.http.get(`/sessions/${sessionId}`).set(a.auth)).status).toBe(200);
  });

  it("another user cannot submit or read a learner's session", async () => {
    const sessionId = await start(a);
    for (const u of [b, c, r, m]) {
      const res = await submit(u, sessionId, []);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
    const [open] = await run(`MATCH (s:Session {id: $id}) RETURN s.submittedAt AS at`, { id: sessionId });
    expect((open as { at: unknown }).at).toBeNull();
    expect((await submit(a, sessionId, [])).status).toBe(200);
    for (const u of [b, c, r, m]) expect((await app.http.get(`/sessions/${sessionId}`).set(u.auth)).status).toBe(404);
  });

  it('a draft puzzle is absent from lists and answers 404 for all five users', async () => {
    for (const u of [a, b, c, r, m]) {
      expect((await list(u)).some((p) => p.id === 'P3')).toBe(false);
      expect((await app.http.get('/puzzles/P3/play').set(u.auth)).status).toBe(404);
      expect((await app.http.post('/puzzles/P3/sessions').set(u.auth)).status).toBe(404);
    }
  });

  it('a blocked account gets 403 ACCOUNT_BLOCKED from the guard; mastery is private to its owner', async () => {
    const blocked = await app.createUser({ role: 'learner' });
    await app.setStatus(blocked.id, 'blocked');
    const res = await app.http.get('/puzzles').set(blocked.auth);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_BLOCKED');
    const fresh = await app.createUser({ role: 'reviewer' });
    expect((await app.http.get('/me/mastery').set(fresh.auth)).body).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// S5: see where a question came from
// ---------------------------------------------------------------------------------------------------------------

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();
const passagesOf = (body: { review: Array<{ passage?: unknown }> }) => body.review.filter((i) => i.passage);
const withoutPassages = (body: { review: Array<Record<string, unknown>> }) => ({
  ...body,
  review: body.review.map(({ passage: _passage, ...rest }) => rest),
});

describe('S5: where a question came from (source access matrix)', () => {
  let actors: Actors;
  let puzzle = '';
  describeAccessMatrix(
    () => app,
    async (a_, got) => {
      actors = got;
      puzzle = 'PS-src';
      await run(
        `MATCH (o:Learner {id: $owner})
         CREATE (o)-[:OWNS]->(s:Source {id: 'SS-src', kind: 'upload', title: 'Src'})
         CREATE (s)-[:HAS_CHUNK]->(ch:Chunk {id: 'ch-ss', position: 1, text: $text})
         CREATE (o)-[:OWNS]->(p:Puzzle {id: $puzzle, name: 'Src puzzle', status: 'published', visibility: 'private', origin: 'upload'})
         CREATE (s)-[:YIELDED]->(p)
         CREATE (p)-[:CONTAINS {order: 1}]->(q:Question {id: 'qs-src', sentence: 'Grounded ___.', status: 'approved', answers: ['word']})
         CREATE (q)-[:GROUNDED_IN]->(ch)`,
        { owner: got.owner.id, puzzle, text: 'Grounded in the passage the word appears here.' },
      );
      await share(run, puzzle, got.shared.id, false);
      await share(run, puzzle, got.sharedWithSource.id, true);
      void a_;
    },
    [],
  );

  it('each actor submits their own session; only the owner and the shared-with-source user see a passage', async () => {
    const expected: Record<keyof Actors, { start: number; passage: boolean }> = {
      owner: { start: 201, passage: true },
      shared: { start: 201, passage: false },
      sharedWithSource: { start: 201, passage: true },
      otherLearner: { start: 404, passage: false },
      reviewer: { start: 404, passage: false },
      admin: { start: 404, passage: false },
    };
    for (const [name, want] of Object.entries(expected) as Array<[keyof Actors, (typeof expected)[keyof Actors]]>) {
      const started = await app.http.post(`/puzzles/${puzzle}/sessions`).set(actors[name].auth);
      expect(started.status, name).toBe(want.start);
      if (want.start !== 201) continue;
      const res = await submit(actors[name], started.body.sessionId, []);
      expect(res.status, name).toBe(200);
      expect(passagesOf(res.body).length > 0, name).toBe(want.passage);
    }
  });
});

describe('S5: where a question came from', () => {
  it('owner sees a passage with chunk, source, and a bounded excerpt of the real chunk text; GET returns the same', async () => {
    const sessionId = await start(b, 'P2');
    const res = await submit(b, sessionId, [{ questionId: 'q6', blank: 0, word: 'wrong' }]);
    expect(res.status).toBe(200);
    const [item] = passagesOf(res.body) as Array<{ passage: { chunkId: string; sourceId: string; excerpt: string } }>;
    expect(item!.passage.chunkId).toBe('ch-1');
    expect(item!.passage.sourceId).toBe('S2');
    expect(item!.passage.excerpt.length).toBeLessThanOrEqual(281);
    expect(Object.keys(item!.passage).sort()).toEqual(['chunkId', 'excerpt', 'sourceId']);
    const [chunk] = await run(`MATCH (ch:Chunk {id: 'ch-1'}) RETURN ch.text AS text`);
    const body = item!.passage.excerpt.replace(/…$/, '');
    expect(collapse((chunk as { text: string }).text)).toContain(body);
    expect((await app.http.get(`/sessions/${sessionId}`).set(b.auth)).body).toEqual(res.body);
  });

  it('a seed puzzle result has no passage key anywhere', async () => {
    const res = await submit(a, await start(a), [{ questionId: 'q1', blank: 0, word: 'index' }]);
    expect(playKeys(res.body)).not.toContain('passage');
  });

  it('prompt-made puzzle P5 is labelled prompt everywhere and never carries a passage', async () => {
    const listed = (await app.http.get('/puzzles').set(a.auth)).body.find((p: { id: string }) => p.id === 'P5');
    expect(listed).toMatchObject({ origin: 'prompt', sourceShared: true, sourceId: 'S5' });
    const play = await app.http.get('/puzzles/P5/play').set(a.auth);
    expect(play.body.origin).toBe('prompt');
    const res = await submit(a, await start(a, 'P5'), [{ questionId: 'q8', blank: 0, word: 'rows' }]);
    expect(res.body.puzzle.origin).toBe('prompt');
    expect(playKeys(res.body)).not.toContain('passage');
  });

  it('a share without the source gives no passage; widening and revoking take effect on the same session', async () => {
    await share(run, 'P2', a.id, false);
    try {
      const sessionId = await start(a, 'P2');
      const first = await submit(a, sessionId, [{ questionId: 'q6', blank: 0, word: 'wrong' }]);
      expect(first.status).toBe(200);
      expect(passagesOf(first.body)).toHaveLength(0);

      await share(run, 'P2', a.id, true);
      const widened = await app.http.get(`/sessions/${sessionId}`).set(a.auth);
      expect(passagesOf(widened.body)).toHaveLength(1);
      const second = await submit(a, await start(a, 'P2'), [{ questionId: 'q6', blank: 0, word: 'wrong' }]);
      expect(passagesOf(second.body)).toHaveLength(1);

      await unshare(run, 'P2', a.id);
      const revoked = await app.http.get(`/sessions/${sessionId}`).set(a.auth);
      expect(revoked.status).toBe(200);
      expect(passagesOf(revoked.body)).toHaveLength(0);
      expect(revoked.body).toEqual(withoutPassages(widened.body));
    } finally {
      await unshare(run, 'P2', a.id);
    }
  });

  it('public puzzle P4: a player who is not the source owner gets no passage, the owner does', async () => {
    const res = await submit(a, await start(a, 'P4'), [{ questionId: 'q7', blank: 0, word: 'x' }]);
    expect(passagesOf(res.body)).toHaveLength(0);
    const own = await submit(r, await start(r, 'P4'), [{ questionId: 'q7', blank: 0, word: 'x' }]);
    expect(passagesOf(own.body)).toHaveLength(1);
  });

  it('the play payload never carries passage, chunk, excerpt, or source keys', async () => {
    const play = await app.http.get('/puzzles/P2/play').set(b.auth);
    expect(play.status).toBe(200);
    expect(playKeys(play.body).filter((k) => /passage|chunk|excerpt|source/i.test(k))).toEqual([]);
  });

  it('a failing grounding query leaves submit working without passages', async () => {
    const graph = app.app.get(GraphKit);
    const original = graph.query.bind(graph);
    (graph as unknown as { query: unknown }).query = async (name: string, ...rest: unknown[]) => {
      if (name === 'question_grounding') throw new Error('stubbed failure');
      return (original as (n: string, ...r: unknown[]) => Promise<unknown>)(name, ...rest);
    };
    try {
      const res = await submit(b, await start(b, 'P2'), [{ questionId: 'q6', blank: 0, word: 'wrong' }]);
      expect(res.status).toBe(200);
      expect(passagesOf(res.body)).toHaveLength(0);
    } finally {
      (graph as unknown as { query: unknown }).query = original;
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Polish
// ---------------------------------------------------------------------------------------------------------------

describe('SC-G01: answer-free sweep', () => {
  const ALLOWED = ['blanks', 'id', 'name', 'order', 'origin', 'questions', 'sentence', 'wordBank'];

  it('every playable puzzle of a, b, r, m is strict, key-restricted, deduplicated, and not the answers in order', async () => {
    await share(run, 'P2', a.id, false);
    try {
      for (const u of [a, b, r, m]) {
        const listed = (await app.http.get('/puzzles').set(u.auth)).body as Array<{ id: string }>;
        expect(listed.length).toBeGreaterThan(0);
        for (const { id } of listed) {
          const res = await app.http.get(`/puzzles/${id}/play`).set(u.auth);
          expect(res.status, `${u.name} ${id}`).toBe(200);
          PlayPuzzleDto.parse(res.body);
          expect(playKeys(res.body).filter((k) => !ALLOWED.includes(k))).toEqual([]);
          const bank = res.body.wordBank as string[];
          expect(new Set(bank.map((w) => w.toLowerCase())).size).toBe(bank.length);
          const rows = await run(
            `MATCH (:Puzzle {id: $id})-[c:CONTAINS]->(q:Question {status: 'approved'}) RETURN q.answers AS answers ORDER BY c.order`,
            { id },
          );
          const inOrder = (rows as Array<{ answers: string[] }>).flatMap((x) => x.answers);
          // A one-word bank cannot differ from its single answer; larger banks also carry distractors.
          if (bank.length > 1) expect(bank).not.toEqual(inOrder);
        }
      }
    } finally {
      await unshare(run, 'P2', a.id);
    }
  });
});

describe('input hardening', () => {
  const rejected = async (body: unknown) => {
    const sessionId = await start(c);
    const res = await app.http.post(`/sessions/${sessionId}/submit`).set(c.auth).send(body as object);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.issues.length).toBeGreaterThan(0);
    const [row] = await run(`MATCH (s:Session {id: $id}) RETURN s.submittedAt AS at`, { id: sessionId });
    expect((row as { at: unknown }).at).toBeNull();
  };

  it('rejects an over-long word, too many answers, duplicates, out-of-range blank, and extra keys', async () => {
    await rejected({ answers: [{ questionId: 'q1', blank: 0, word: 'x'.repeat(101) }] });
    await rejected({ answers: Array.from({ length: 501 }, () => ({ questionId: 'q1', blank: 0, word: 'a' })) });
    await rejected({
      answers: [
        { questionId: 'q1', blank: 0, word: 'a' },
        { questionId: 'q1', blank: 0, word: 'b' },
      ],
    });
    await rejected({ answers: [{ questionId: 'q1', blank: 5, word: 'a' }] });
    await rejected({ answers: [{ questionId: 'q1', blank: 0, word: 'a', correct: true }] });
    await rejected({ answers: [], score: 40 });
  });

  it('a non-JSON body is a 400 VALIDATION_FAILED', async () => {
    const sessionId = await start(c);
    const res = await app.http
      .post(`/sessions/${sessionId}/submit`)
      .set(c.auth)
      .set('Content-Type', 'application/json')
      .send('{not json');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('a 65-character path id is 422', async () => {
    expect((await app.http.get(`/sessions/${'x'.repeat(65)}`).set(c.auth)).status).toBe(422);
    expect((await app.http.post(`/puzzles/${'x'.repeat(65)}/sessions`).set(c.auth)).status).toBe(422);
  });
});

// SC-G03: submitting a 10-question puzzle takes under 500 ms (median of 5). Opt-in: set RUN_PERF=1 in the environment.
describe('SC-G03: submit latency', () => {
  it.skipIf(!process.env.RUN_PERF)('median of 5 submit round trips on a 10-question puzzle is under 500 ms', async () => {
    const words = Array.from({ length: 10 }, (_, i) => `term${i}`);
    await run(
      `MATCH (m:Learner {id: $M})
       CREATE (m)-[:OWNS]->(p:Puzzle {id: 'PPERF', name: 'Perf', status: 'published', visibility: 'public', origin: 'seed'})
       WITH p
       UNWIND range(0, 9) AS i
       CREATE (p)-[:CONTAINS {order: i + 1}]->(:Question {id: 'pq' + toString(i), sentence: 'Fill ___ ' + toString(i) + '.',
                                    status: 'approved', answers: [$words[i]]})`,
      { M: m.id, words },
    );
    const times: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const sessionId = await start(a, 'PPERF');
      const answers = words.map((word, q) => ({ questionId: `pq${q}`, blank: 0, word }));
      const t0 = performance.now();
      const res = await submit(a, sessionId, answers);
      times.push(performance.now() - t0);
      expect(res.status).toBe(200);
      expect(res.body.score).toBe(100);
    }
    const median = [...times].sort((x, y) => x - y)[2]!;
    expect(median).toBeLessThan(500);
  });
});
