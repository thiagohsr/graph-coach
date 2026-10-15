import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { COACH_FLAGS } from '@coach/agents/coach';
import { GraphKit, GraphUnavailableError, seedIds } from '@coach/graph-kit';
import { CoachFlag } from '@coach/types';
import {
  addAgents,
  addConcepts,
  addMastery,
  addPuzzle,
  cid,
  revokeShare,
  share,
  signInSeeded,
} from './support/coach-fixture';
import { describeAccessMatrix } from './support/role-matrix';
import { createTestApp, type TestApp, type TestUser } from './support/test-app';

const MINUTE = 60_000;

describe('Coach flag list', () => {
  it('the agents package repeats the CoachFlag list of @coach/types exactly', () => {
    expect([...COACH_FLAGS].sort()).toEqual([...CoachFlag.options].sort());
  });
});
const recommend = (app: TestApp, user: TestUser, body: unknown = {}) =>
  app.http.post('/coach/recommendations').set(user.auth).send(body as object);

const decisionCount = async (app: TestApp): Promise<number> =>
  (await app.testGraph.cypher<{ c: number }>('MATCH (d:Decision) RETURN count(d) AS c'))[0]!.c;

describe('Coach: the seeded weak-prerequisite scenario (S1, S2)', () => {
  let app: TestApp;
  let learner: TestUser;
  let learner2: TestUser;
  let first: { decisionId: string };

  beforeAll(async () => {
    app = await createTestApp();
    await app.testGraph.loadSeed({ now: app.clock.now() });
    learner = await signInSeeded(app, 'learner');
    learner2 = await signInSeeded(app, 'learner2');
  });
  afterAll(async () => {
    await app?.close();
  });

  it('401 UNAUTHENTICATED without a token', async () => {
    const res = await app.http.post('/coach/recommendations').send({});
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('403 ACCOUNT_BLOCKED for a blocked user, and no decision is created', async () => {
    const blocked = await app.createUser({ role: 'learner' });
    await app.setStatus(blocked.id, 'blocked');
    const res = await recommend(app, blocked);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_BLOCKED');
    expect(await decisionCount(app)).toBe(0);
  });

  it('422 VALIDATION_FAILED for a 2-character goal and for an unknown field', async () => {
    const short = await recommend(app, learner, { goal: 'ab' });
    expect(short.status).toBe(422);
    expect(short.body.error.code).toBe('VALIDATION_FAILED');
    const unknown = await recommend(app, learner, { learnerId: learner2.id });
    expect(unknown.status).toBe(422);
    expect(unknown.body.error.code).toBe('VALIDATION_FAILED');
    expect(await decisionCount(app)).toBe(0);
  });

  it('acceptance: the Coach targets the weak prerequisite b-trees and recommends Storage and B-trees', async () => {
    const res = await recommend(app, learner);
    expect(res.status).toBe(201);
    expect(res.body.target).toEqual({ conceptId: seedIds.concept('b-trees'), name: 'B-trees' });
    expect(res.body.puzzle).toEqual({
      id: seedIds.puzzle('storage-and-b-trees'),
      name: 'Databases 101: Storage and B-trees',
    });
    expect(res.body.flags).toEqual(['prerequisite_first']);
    expect(res.body.alternatives).toEqual([]);
    expect(res.body.reused).toBe(false);
    expect('coverageGap' in res.body).toBe(false);
    expect(res.body.summary).toContain('"B-trees"');
    expect(res.body.summary).toContain('"Indexes"');
    first = res.body;

    // a Decision with BECAUSE edges is stored; usage is stored on it and zero on the template path
    const stored = await app.testGraph.cypher<Record<string, unknown>>(
      `MATCH (d:Decision {id: $id})-[b:BECAUSE]->(n)
       RETURN d.modelCalls AS modelCalls, d.inputTokens AS inputTokens, d.outputTokens AS outputTokens,
              d.embeddingTokens AS embeddingTokens, count(b) AS because`,
      { id: first.decisionId },
    );
    expect(stored).toEqual([{ modelCalls: 0, inputTokens: 0, outputTokens: 0, embeddingTokens: 0, because: 10 }]);
    const orphans = await app.testGraph.cypher<{ c: number }>(
      'MATCH (d:Decision) WHERE NOT (d)-[:BECAUSE]->() RETURN count(d) AS c',
    );
    expect(orphans[0]!.c).toBe(0);
  });

  it('records a usage-only trace: one coach run, no model call', async () => {
    const runs = app.tracer.runs.filter((r) => r.id === first.decisionId);
    expect(runs).toEqual([{ id: first.decisionId, kind: 'coach', userId: learner.id, ok: true, ended: true }]);
    expect(app.tracer.calls).toEqual([]);
  });

  it('a second call returns the same decision with reused true', async () => {
    const res = await recommend(app, learner);
    expect(res.status).toBe(201);
    expect(res.body.decisionId).toBe(first.decisionId);
    expect(res.body.reused).toBe(true);
    expect(res.body.target).toEqual({ conceptId: seedIds.concept('b-trees'), name: 'B-trees' });
    expect(await decisionCount(app)).toBe(1);
  });

  it('GET /decisions/:id returns the stored decision to its learner', async () => {
    const res = await app.http.get(`/decisions/${first.decisionId}`).set(learner.auth);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: first.decisionId,
      kind: 'recommendation',
      flags: ['prerequisite_first'],
      target: { name: 'B-trees' },
      puzzle: { name: 'Databases 101: Storage and B-trees' },
    });
    expect(typeof res.body.createdAt).toBe('string');
    expect(new Date(res.body.createdAt).getTime()).toBe(app.clock.now().getTime());
  });

  it('GET /decisions/:id/path: the target, the driver, the PREREQUISITE_OF edge, the questions, and sessions A, B, C', async () => {
    const started = Date.now();
    const res = await app.http.get(`/decisions/${first.decisionId}/path`).set(learner.auth);
    const elapsed = Date.now() - started;
    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(2000); // SC-C03

    const { nodes, edges, steps } = res.body as {
      nodes: Array<{ id: string; label: string; title: string; props: Record<string, unknown> }>;
      edges: Array<{ from: string; to: string; type: string; reason?: string; role?: string; weight?: number }>;
      steps: string[];
    };
    const ids = new Set(nodes.map((n) => n.id));
    expect(ids.has(seedIds.concept('b-trees'))).toBe(true);
    expect(ids.has(seedIds.concept('indexes'))).toBe(true);
    for (const key of ['A', 'B', 'C'] as const) expect(ids.has(seedIds.session(key))).toBe(true);
    expect(ids.has(seedIds.puzzle('storage-and-b-trees'))).toBe(true);
    expect(nodes.every((n) => n.title.length > 0)).toBe(true);

    const because = edges.filter((e) => e.type === 'BECAUSE');
    expect(because.length).toBeGreaterThanOrEqual(1);
    expect(because.find((e) => e.role === 'target')).toMatchObject({ to: seedIds.concept('b-trees'), weight: 0.723 });
    expect(because.find((e) => e.role === 'driver')).toMatchObject({ to: seedIds.concept('indexes'), weight: 0.359 });
    expect(edges).toContainEqual(
      expect.objectContaining({ from: seedIds.concept('b-trees'), to: seedIds.concept('indexes'), type: 'PREREQUISITE_OF' }),
    );
    expect(edges.every((e) => typeof e.reason === 'string' && e.reason.length > 0)).toBe(true);
    expect(edges.filter((e) => e.type !== 'BECAUSE').every((e) => e.role === undefined && e.weight === undefined)).toBe(true);
    expect(because.filter((e) => e.role === 'answer')).toHaveLength(5);
    expect(because.filter((e) => e.role === 'session')).toHaveLength(3);

    expect(steps.slice(0, 4)).toEqual([
      'The Coach recommended the puzzle "Databases 101: Storage and B-trees".',
      'B-trees — target: mastery 0.12, last practised 9 days ago, risk 1.45.',
      'Indexes — weak concept that depends on the target: mastery 0.26, risk 0.80.',
      'B-trees is a prerequisite of Indexes.',
    ]);
    expect(steps.filter((s) => s.startsWith('Session on '))).toHaveLength(3);
    expect(steps.filter((s) => s.startsWith('Question "'))).toHaveLength(5);

    // no e-mail address, no answer-key word (outside the question sentences themselves)
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/\S+@\S+/);
    expect(text).not.toMatch(/"(answers|distractors|word)"/);
    const questions = await app.testGraph.cypher<{ sentence: string; answers: string[]; distractors: string[] }>(
      `MATCH (:Decision {id: $id})-[:BECAUSE]->(q:Question) RETURN q.sentence AS sentence, q.answers AS answers, q.distractors AS distractors`,
      { id: first.decisionId },
    );
    expect(questions).toHaveLength(5);
    const sentences = questions.map((q) => q.sentence.toLowerCase()).join(' ');
    const stripped = text.toLowerCase();
    for (const word of questions.flatMap((q) => [...q.answers, ...q.distractors])) {
      const re = new RegExp(`(?<![\\w-])${word.toLowerCase().replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?![\\w-])`);
      // a word that is part of any sentence of the path legitimately occurs in the response
      if (re.test(sentences) || re.test(JSON.stringify(nodes.map((n) => n.title + JSON.stringify(n.props))).toLowerCase())) continue;
      expect(stripped).not.toMatch(re);
    }
  });

  it('GET /decisions/:id and /path answer 404 for an unknown id', async () => {
    expect((await app.http.get('/decisions/no-such-decision').set(learner.auth)).status).toBe(404);
    const res = await app.http.get('/decisions/no-such-decision/path').set(learner.auth);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('S3: a user with no history gets a cold start', async () => {
    const res = await recommend(app, learner2);
    expect(res.status).toBe(201);
    expect(res.body.flags).toEqual(['cold_start']);
    expect(res.body.summary).toMatch(/no study history/);
    expect(res.body.target).toEqual({ conceptId: seedIds.concept('relational-model'), name: 'Relational model' });
    expect(res.body.puzzle.id).toBe(seedIds.puzzle('tables-and-keys'));
    expect(res.body.alternatives).toEqual([]);
    expect('coverageGap' in res.body).toBe(false);
  });

  it('503 GRAPH_UNAVAILABLE when the graph is down; no decision is created', async () => {
    const before = await decisionCount(app);
    const graph = app.app.get(GraphKit);
    const spy = vi.spyOn(graph, 'query').mockRejectedValue(new GraphUnavailableError());
    try {
      const res = await recommend(app, learner);
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('GRAPH_UNAVAILABLE');
    } finally {
      spy.mockRestore();
    }
    expect(await decisionCount(app)).toBe(before);
  });

  it('503 DECISION_NOT_RECORDED when the write returns no row', async () => {
    app.clock.advance(11 * MINUTE); // past the reuse window of the earlier decisions
    const before = await decisionCount(app);
    const graph = app.app.get(GraphKit);
    const original = graph.query.bind(graph);
    const spy = vi
      .spyOn(graph, 'query')
      .mockImplementation(((name: string, params?: never, options?: never) =>
        name === 'record_decision' ? Promise.resolve([]) : original(name, params, options)) as never);
    try {
      const res = await recommend(app, learner);
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('DECISION_NOT_RECORDED');
      expect(res.body.puzzle).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
    expect(await decisionCount(app)).toBe(before);
  });

  it('after a submitted session the next call is a new decision', async () => {
    const start = await app.http.post(`/puzzles/${seedIds.puzzle('storage-and-b-trees')}/sessions`).set(learner.auth);
    expect(start.status).toBe(201);
    app.clock.advance(MINUTE);
    const submit = await app.http
      .post(`/sessions/${start.body.sessionId}/submit`)
      .set(learner.auth)
      .send({ answers: [] });
    expect(submit.status).toBe(200);
    const before = await decisionCount(app);
    const res = await recommend(app, learner);
    expect(res.status).toBe(201);
    expect(res.body.reused).toBe(false);
    expect(res.body.decisionId).not.toBe(first.decisionId);
    expect(await decisionCount(app)).toBe(before + 1);
  });
});

describe('Coach: who may read a decision (C4, G8)', () => {
  let app: TestApp;
  const owner: { decisionId: string } = { decisionId: '' };

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app?.close();
  });

  describeAccessMatrix(
    () => app,
    async (testApp, actors) => {
      await testApp.testGraph.loadSeed({ now: testApp.clock.now(), scenario: false });
      // The owner is a new account: give it the weak-prerequisite situation of the scenario.
      await testApp.testGraph.cypher(
        `MATCH (l:Learner {id: $id})
         UNWIND $rows AS r
         MATCH (c:Concept {id: r.id})
         CREATE (l)-[:HAS_MASTERY {score: r.score, attempts: r.attempts, lastSeen: r.lastSeen}]->(c)`,
        {
          id: actors.owner.id,
          rows: [
            { id: seedIds.concept('b-trees'), score: 0.12, attempts: 4, lastSeen: testApp.clock.now().getTime() - 9 * 86_400_000 },
            { id: seedIds.concept('indexes'), score: 0.26, attempts: 6, lastSeen: testApp.clock.now().getTime() - 86_400_000 },
          ],
        },
      );
      const res = await testApp.http.post('/coach/recommendations').set(actors.owner.auth).send({});
      expect(res.status).toBe(201);
      owner.decisionId = res.body.decisionId;
      return { decisionId: res.body.decisionId as string };
    },
    [
      {
        name: 'GET /decisions/:id',
        request: (ctx) => ({ method: 'GET', path: `/decisions/${ctx.decisionId}` }),
        expect: { owner: 200, shared: 404, sharedWithSource: 404, otherLearner: 404, reviewer: 404, admin: 200 },
      },
      {
        name: 'GET /decisions/:id/path',
        request: (ctx) => ({ method: 'GET', path: `/decisions/${ctx.decisionId}/path` }),
        expect: { owner: 200, shared: 404, sharedWithSource: 404, otherLearner: 404, reviewer: 404, admin: 200 },
      },
    ],
  );

  it('an admin who reads another learner decision sees the same path', async () => {
    const admin = await app.createUser({ role: 'admin', name: 'Reader' });
    const res = await app.http.get(`/decisions/${owner.decisionId}/path`).set(admin.auth);
    expect(res.status).toBe(200);
    expect(res.body.nodes.some((n: { label: string; title: string }) => n.label === 'Learner')).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/\S+@\S+/);
  });
});

describe('Coach: sparse content (S3)', () => {
  it('a coverage gap recommends the closest puzzle and states the gap', async () => {
    const app = await createTestApp();
    try {
      const user = await app.createUser({ role: 'learner' });
      const other = await app.createUser({ role: 'learner' });
      await addAgents(app);
      await addConcepts(app, [{ slug: 'y' }, { slug: 'x', prereqs: ['y'] }]);
      await addMastery(app, user.id, [{ slug: 'x', score: 0.1, attempts: 3, daysAgo: 4 }]);
      await addPuzzle(app, { id: 'gap-puzzle', name: 'Neighbour puzzle', ownerId: other.id, visibility: 'public', tests: ['y', 'y'] });
      const res = await recommend(app, user);
      expect(res.status).toBe(201);
      expect(res.body.puzzle).toEqual({ id: 'gap-puzzle', name: 'Neighbour puzzle' });
      expect(res.body.flags).toEqual(['coverage_gap']);
      expect(res.body.coverageGap).toEqual({ concepts: [{ conceptId: cid('x'), name: 'X' }] });
      expect(res.body.target).toEqual({ conceptId: cid('x'), name: 'X' });
      expect(res.body.summary).toContain('No puzzle tests "X" directly yet');
    } finally {
      await app.close();
    }
  });

  it('a target with no playable puzzle at all gets puzzle null, no_puzzle, and coverage_gap', async () => {
    const app = await createTestApp();
    try {
      const user = await app.createUser({ role: 'learner' });
      await addAgents(app);
      await addConcepts(app, [{ slug: 'x' }]);
      await addMastery(app, user.id, [{ slug: 'x', score: 0.1, attempts: 3, daysAgo: 4 }]);
      const res = await recommend(app, user);
      // Nothing is playable at all, so there is no target either: the weak concept has no question anywhere, but a weak
      // concept is still a target; only a decision without any puzzle is stored.
      expect(res.status).toBe(201);
      expect(res.body.puzzle).toBeNull();
      expect(res.body.flags).toEqual(['coverage_gap', 'no_puzzle']);
      expect(res.body.coverageGap.concepts).toHaveLength(1);
      const stored = await app.http.get(`/decisions/${res.body.decisionId}`).set(user.auth);
      expect(stored.body.puzzle).toBeNull();
      expect(await app.testGraph.countEdges('RECOMMENDED')).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('an empty catalogue answers 409 NO_PLAYABLE_CONTENT and creates no decision', async () => {
    const app = await createTestApp();
    try {
      const user = await app.createUser({ role: 'learner' });
      await addAgents(app);
      const res = await recommend(app, user);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('NO_PLAYABLE_CONTENT');
      expect(await decisionCount(app)).toBe(0);
    } finally {
      await app.close();
    }
  });
});

describe('Coach: respects ownership (S5)', () => {
  let app: TestApp;
  let a: TestUser; // owns the private puzzle
  let b: TestUser; // another learner
  let reviewer: TestUser;
  let admin: TestUser;

  beforeAll(async () => {
    app = await createTestApp();
    a = await app.createUser({ role: 'learner', name: 'Owner A' });
    b = await app.createUser({ role: 'learner', name: 'Learner B' });
    reviewer = await app.createUser({ role: 'reviewer', name: 'Reviewer' });
    admin = await app.createUser({ role: 'admin', name: 'Admin' });
    await addAgents(app);
    // t is the weak concept of everyone; nb is its (unpractised) prerequisite. Only A's private puzzle tests t.
    await addConcepts(app, [{ slug: 'nb' }, { slug: 't', prereqs: ['nb'] }]);
    for (const user of [a, b, reviewer, admin]) {
      await addMastery(app, user.id, [{ slug: 't', score: 0.2, attempts: 3, daysAgo: 2 }]);
    }
    await addPuzzle(app, { id: 'p-private', name: 'A private puzzle', ownerId: a.id, visibility: 'private', tests: ['t', 't'] });
    await addPuzzle(app, { id: 'p-public', name: 'A public neighbour', ownerId: admin.id, visibility: 'public', tests: ['nb', 'nb'] });
  });
  afterAll(async () => {
    await app?.close();
  });

  const nextWindow = () => app.clock.advance(11 * MINUTE);

  it('learner B never receives learner A private puzzle, even when it is the only one covering the target', async () => {
    const res = await recommend(app, b);
    expect(res.status).toBe(201);
    expect(res.body.puzzle.id).toBe('p-public');
    expect(res.body.flags).toContain('coverage_gap');
    expect(res.body.coverageGap.concepts).toEqual([{ conceptId: cid('t'), name: 'T' }]);
  });

  it('learner A receives their own private puzzle', async () => {
    const res = await recommend(app, a);
    expect(res.status).toBe(201);
    expect(res.body.puzzle.id).toBe('p-private');
    expect(res.body.flags).not.toContain('coverage_gap');
  });

  it('after A shares it with B, B is recommended it; after the share is revoked, B is not', async () => {
    await share(app, 'p-private', b.id, false);
    nextWindow();
    const shared = await recommend(app, b);
    expect(shared.body.reused).toBe(false);
    expect(shared.body.puzzle.id).toBe('p-private');
    expect(shared.body.flags).not.toContain('coverage_gap');

    await revokeShare(app, 'p-private', b.id);
    nextWindow();
    const revoked = await recommend(app, b);
    expect(revoked.body.reused).toBe(false);
    expect(revoked.body.puzzle.id).toBe('p-public');

    nextWindow();
    const ownerAgain = await recommend(app, a);
    expect(ownerAgain.body.puzzle.id).toBe('p-private');
  });

  it('a reviewer and an admin requesting for themselves get no private puzzle of others', async () => {
    for (const staff of [reviewer, admin]) {
      const res = await recommend(app, staff);
      expect(res.status).toBe(201);
      expect(res.body.puzzle.id).toBe('p-public');
    }
  });
});
