/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are untyped JSON in these tests */
// Security checklist probes (the design documents, task T073, local part).
// Each probe is an automated API test against the isolated test application (AUTH_MODE=dev, stub providers, a Postgres
// schema and a FalkorDB graph of their own). They are NOT manual probes of the running development server.
// The describe titles start with the checklist id so the security checklist (kept privately) can cite them.
// Actors: A owner, S shared user, B other learner (never shared), R reviewer, X admin (see the checklist).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GraphKit, GraphUnavailableError } from '@coach/graph-kit';
import { testing as fixtures } from '@coach/agents/curator';
import { AccountsService } from '../src/apps/accounts/accounts.service';
import { CodesService } from '../src/apps/allowance/codes.service';
import { RunOrchestrator } from '../src/apps/curator/run-orchestrator.service';
import { SettingsService } from '../src/common/settings/settings.service';
import { addAgents, addMastery } from './support/coach-fixture';
import {
  PASSAGE,
  draftSentence,
  publishDirectly,
  seedRun,
  type SeededRun,
} from './support/review-fixture';
import { createTestApp, type TestApp, type TestUser } from './support/test-app';

const { LONG_TEXT, scriptCurator, scriptPrompt } = fixtures;

// ---------------------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------------------

const WEB_ORIGIN = 'http://localhost:3000';
const EVIL_ORIGIN = 'http://evil.example';
const FORBIDDEN_KEYS = ['answers', 'expected', 'correct'];

/** Every key name found anywhere in a JSON value. */
function keysOf(value: unknown): Set<string> {
  const keys = new Set<string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      for (const [k, inner] of Object.entries(v)) {
        keys.add(k);
        walk(inner);
      }
    }
  };
  walk(value);
  return keys;
}

const passages = (body: any): any[] => (body.review as any[]).filter((item) => item.passage);
const ids = (list: any[]): string[] => list.map((item) => item.id);

// ---------------------------------------------------------------------------------------------------------------------
// Ownership, sharing, and source access (SEC-01 to SEC-16, SEC-18 to SEC-20, SEC-25, SEC-28 to SEC-30, SEC-39, SEC-41, SEC-42)
// ---------------------------------------------------------------------------------------------------------------------

describe('security probes: ownership and sharing', () => {
  let app: TestApp;
  let A: TestUser;
  let S: TestUser;
  let B: TestUser;
  let R: TestUser;
  let X: TestUser;
  let runA: SeededRun; // A's published puzzle, three approved questions and one undecided draft
  let runA2: SeededRun; // A's puzzle with no approval (still a draft puzzle)
  let runR: SeededRun; // R's published puzzle
  let runR2: SeededRun; // R's unpublished puzzle
  let promptRun: SeededRun; // A prompt-made published puzzle (for the admin check)
  let sessionA: string;
  let startedByS: string;

  const approve = (user: TestUser, questionId: string) =>
    app.http.post(`/review/questions/${questionId}/approve`).set(user.auth);
  const getAs = (user: TestUser, path: string) => app.http.get(path).set(user.auth);
  const listIds = async (user: TestUser) => ids((await getAs(user, '/puzzles')).body);
  const sourceIds = async (user: TestUser) => ids((await getAs(user, '/sources')).body);
  const putShare = (owner: TestUser, puzzleId: string, body: object) =>
    app.http.put(`/puzzles/${puzzleId}/shares`).set(owner.auth).send(body);
  const startSession = async (user: TestUser, puzzleId: string) => {
    const res = await app.http.post(`/puzzles/${puzzleId}/sessions`).set(user.auth);
    expect(res.status, `start as ${user.name}`).toBe(201);
    return res.body.sessionId as string;
  };
  const submitEmpty = (user: TestUser, sessionId: string) =>
    app.http.post(`/sessions/${sessionId}/submit`).set(user.auth).send({ answers: [] });

  beforeAll(async () => {
    app = await createTestApp();
    scriptCurator(app.chat);
    scriptPrompt(app.chat);
    A = await app.createUser({ role: 'learner', name: 'Alice Owner' });
    S = await app.createUser({ role: 'learner', name: 'Sam Shared' });
    B = await app.createUser({ role: 'learner', name: 'Bea Other' });
    R = await app.createUser({ role: 'reviewer', name: 'Rui Reviewer' });
    X = await app.createUser({ role: 'admin', name: 'Ada Admin' });
    await addAgents(app);

    // Preparation of the checklist: A's source with three approved drafts (puzzle published privately) and one undecided.
    runA = await seedRun(app, A, { drafts: 4 });
    for (const q of runA.questionIds.slice(0, 3)) expect((await approve(A, q)).status).toBe(200);
    runA2 = await seedRun(app, A, { drafts: 3 });
    runR = await seedRun(app, R, { drafts: 3 });
    for (const q of runR.questionIds) expect((await approve(R, q)).status).toBe(200);
    runR2 = await seedRun(app, R, { drafts: 3 });
    promptRun = await seedRun(app, A, { drafts: 3, kind: 'prompt' });
    await publishDirectly(app, promptRun.puzzleId);
  });
  afterAll(async () => {
    await app?.close();
  });

  it('preparation: the puzzle was published by the third approval and one draft is left', async () => {
    const mine = await getAs(A, '/puzzles');
    expect(mine.body.find((p: any) => p.id === runA.puzzleId)).toMatchObject({
      access: 'owner',
      questionCount: 3,
    });
    const drafts = await getAs(A, `/review/questions?taskId=${runA.taskId}`);
    expect(ids(drafts.body)).toEqual([runA.questionIds[3]]);
  });

  describe('SEC-01 no answers in play payloads', () => {
    it('GET /puzzles and GET /puzzles/:id/play carry none of answers/expected/correct; the word bank is deduplicated and reshuffled', async () => {
      const list = await getAs(A, '/puzzles');
      expect(list.status).toBe(200);
      for (const key of FORBIDDEN_KEYS)
        expect(keysOf(list.body).has(key), `list key ${key}`).toBe(false);
      const orders = new Set<string>();
      for (let i = 0; i < 25; i += 1) {
        const play = await getAs(A, `/puzzles/${runA.puzzleId}/play`);
        expect(play.status).toBe(200);
        for (const key of FORBIDDEN_KEYS)
          expect(keysOf(play.body).has(key), `play key ${key}`).toBe(false);
        const bank = play.body.wordBank as string[];
        expect(new Set(bank).size).toBe(bank.length);
        expect([...bank].sort()).toEqual(['index', 'queue', 'stack']);
        orders.add(JSON.stringify(bank));
      }
      expect(orders.size).toBeGreaterThan(1);
    });
  });

  describe('SEC-02 role checks on every protected route', () => {
    function registered(): Array<{ method: string; path: string }> {
      const instance: any = app.app.getHttpAdapter().getInstance();
      const stack: any[] = (instance.router ?? instance._router).stack;
      const routes: Array<{ method: string; path: string }> = [];
      for (const layer of stack) {
        if (!layer.route) continue;
        // Express's catch-all layers ("_all" and the like) are not application routes.
        const path = String(layer.route.path);
        // "/api/*path" is the request-logging middleware (app.module.ts), not a controller route.
        if (!path.startsWith('/api/') || path.includes('*')) continue;
        for (const method of Object.keys(layer.route.methods)) {
          if (['get', 'post', 'put', 'patch', 'delete'].includes(method)) {
            routes.push({ method: method.toUpperCase(), path });
          }
        }
      }
      return routes;
    }
    const PUBLIC = new Set([
      'GET /api/health',
      'GET /api/auth/dev-users',
      'POST /api/auth/dev-login',
    ]);

    it('every registered route is in the canonical contract, and the only public ones are /health and the two development routes', async () => {
      const routes = registered();
      expect(routes.length).toBeGreaterThan(30);
      const contract = readFileSync(
        join(
          __dirname,
          '..',
          '..',
          '..',
          'specs',
          '001-graph-study-coach',
          'contracts',
          'api-endpoints.md',
        ),
        'utf8',
      );
      const documented = new Set<string>();
      for (const match of contract.matchAll(/^\| (GET|POST|PUT|PATCH|DELETE) \| `([^`]+)`/gm)) {
        documented.add(`${match[1]} /api${match[2]!.split('?')[0]}`);
      }
      const missing = routes
        .map((r) => `${r.method} ${r.path}`)
        .filter((r) => !documented.has(r) && r !== 'GET /api/health');
      expect(missing, 'registered but not in contracts/api-endpoints.md').toEqual([]);
      // Nothing that looks like a register or login endpoint other than the development sign-in.
      const paths = routes.map((r) => r.path);
      expect(paths.filter((p) => /register|signup|sign-up|login|password/i.test(p))).toEqual([
        '/api/auth/dev-login',
      ]);
    });

    it('every non-public route answers 401 with no token, an expired token, and a malformed token', async () => {
      const expired = await app.expiredToken(A.id);
      const protectedRoutes = registered().filter((r) => !PUBLIC.has(`${r.method} ${r.path}`));
      expect(protectedRoutes.length).toBeGreaterThan(25);
      for (const route of protectedRoutes) {
        const path = route.path.replace(/:\w+/g, 'x');
        const call = (headers: Record<string, string>) => {
          const req = (app.http as any)[route.method.toLowerCase()](
            path,
          ) as import('supertest').Test;
          for (const [k, v] of Object.entries(headers)) req.set(k, v);
          return req.send({});
        };
        for (const [label, headers] of [
          ['no token', {}],
          ['expired token', { Authorization: `Bearer ${expired}` }],
          ['malformed token', { Authorization: 'Bearer not.a.jwt' }],
        ] as const) {
          const res = await call(headers);
          expect(res.status, `${route.method} ${path} with ${label}`).toBe(401);
          expect(res.body.error.code).toBe('UNAUTHENTICATED');
        }
      }
    });

    it('/admin/* answers 403 FORBIDDEN to a learner (A) and a reviewer (R) on every admin route', async () => {
      for (const user of [A, R]) {
        for (const [verb, path] of [
          ['get', '/admin/models'],
          ['get', '/admin/concept'],
          ['get', '/admin/concept/c-indexes'],
          ['patch', '/admin/concept/c-indexes'],
        ] as const) {
          const res = await (app.http as any)
            [verb](path)
            .set(user.auth)
            .send({ values: { name: 'x' } });
          expect(res.status, `${verb} ${path} as ${user.name}`).toBe(403);
          expect(res.body.error.code).toBe('FORBIDDEN');
        }
      }
    });

    it('the development routes are public in dev mode; /health is public', async () => {
      expect((await app.http.get('/health')).status).toBe(200);
      expect((await app.http.get('/auth/dev-users')).status).toBe(200);
      expect((await app.http.post('/auth/dev-login').send({ email: A.email })).status).toBe(200);
    });
  });

  describe('SEC-03 private sources', () => {
    it('A: listed as owner and readable with content; everyone else: not listed and 404; the list never has the text', async () => {
      const list = await getAs(A, '/sources');
      expect(list.body.find((s: any) => s.id === runA.sourceId)).toMatchObject({ access: 'owner' });
      expect(list.text).not.toContain(PASSAGE);
      const detail = await getAs(A, `/sources/${runA.sourceId}`);
      expect(detail.status).toBe(200);
      expect(detail.body.content).toBe(PASSAGE);
      for (const user of [B, S, R, X]) {
        expect(await sourceIds(user), user.name).not.toContain(runA.sourceId);
        expect((await getAs(user, '/sources')).text).not.toContain(PASSAGE);
        const res = await getAs(user, `/sources/${runA.sourceId}`);
        expect(res.status, user.name).toBe(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
      }
    });
  });

  describe('SEC-04 drafts', () => {
    it('A sees the draft with its passage; everyone else gets 404 for the task filter and for each action; the draft is unchanged', async () => {
      const draft = runA.questionIds[3]!;
      const mine = await getAs(A, `/review/questions?taskId=${runA.taskId}`);
      expect(mine.status).toBe(200);
      expect(mine.body).toHaveLength(1);
      expect(mine.body[0].passage?.text).toBe(PASSAGE);
      for (const user of [B, S, R, X]) {
        // The filtered read is 404 (as if the task did not exist); without a filter the list is empty.
        expect(
          (await getAs(user, `/review/questions?taskId=${runA.taskId}`)).status,
          user.name,
        ).toBe(404);
        // Without the filter the list holds the caller's own drafts only (R owns some): never one of A's.
        const own = ids((await getAs(user, '/review/questions')).body);
        for (const q of runA.questionIds)
          expect(own, `${user.name} sees a draft of A`).not.toContain(q);
        expect(
          (
            await app.http
              .patch(`/review/questions/${draft}`)
              .set(user.auth)
              .send({ distractors: ['x1', 'y1'] })
          ).status,
        ).toBe(404);
        expect((await approve(user, draft)).status).toBe(404);
        expect(
          (await app.http.post(`/review/questions/${draft}/reject`).set(user.auth).send({})).status,
        ).toBe(404);
      }
      const after = await getAs(A, `/review/questions?taskId=${runA.taskId}`);
      expect(after.body).toEqual(mine.body);
      expect(after.body[0].sentence).toBe(draftSentence(4));
    });
  });

  describe('SEC-05 private puzzles', () => {
    it('A lists, plays, and starts a session; everyone else: not listed, 404, 404', async () => {
      expect(
        (await getAs(A, '/puzzles')).body.find((p: any) => p.id === runA.puzzleId),
      ).toMatchObject({ access: 'owner' });
      expect((await getAs(A, `/puzzles/${runA.puzzleId}/play`)).status).toBe(200);
      sessionA = await startSession(A, runA.puzzleId);
      for (const user of [B, S, R, X]) {
        expect(await listIds(user), user.name).not.toContain(runA.puzzleId);
        expect((await getAs(user, `/puzzles/${runA.puzzleId}/play`)).status, user.name).toBe(404);
        expect(
          (await app.http.post(`/puzzles/${runA.puzzleId}/sessions`).set(user.auth)).status,
          user.name,
        ).toBe(404);
      }
    });
  });

  describe('SEC-06 sessions and mastery', () => {
    it("everyone else gets 404 on A's session (submit and read); the mastery list is each caller's own", async () => {
      for (const user of [B, S, R, X]) {
        expect((await submitEmpty(user, sessionA)).status, user.name).toBe(404);
        expect((await getAs(user, `/sessions/${sessionA}`)).status, user.name).toBe(404);
      }
      const done = await submitEmpty(A, sessionA);
      expect(done.status).toBe(200);
      expect(passages(done.body).length).toBeGreaterThan(0); // the owner sees passages
      const mine = await getAs(A, '/me/mastery');
      expect(mine.body.length).toBeGreaterThan(0);
      for (const user of [B, S, R, X])
        expect((await getAs(user, '/me/mastery')).body, user.name).toEqual([]);
    });
  });

  describe('SEC-07 decisions', () => {
    it('B, S, R get 404; X may read the decision but its path holds no passage node and no chunk text; the owner path includes the passage', async () => {
      await addMastery(app, A.id, [{ slug: 'indexes', score: 0.2, attempts: 3, daysAgo: 2 }]);
      const rec = await app.http.post('/coach/recommendations').set(A.auth).send({});
      expect(rec.status).toBe(201);
      const decisionId = rec.body.decisionId as string;
      // Attach a passage to the decision: a chunk of A's own private source.
      const secret = `SECRET-CHUNK-TEXT-${decisionId}`;
      await app.testGraph.cypher(
        `MATCH (:Source {id: $sourceId})-[:HAS_CHUNK]->(k:Chunk) SET k.text = $secret
         WITH k MATCH (d:Decision {id: $decisionId})
         CREATE (d)-[:BECAUSE {role: 'passage', reason: 'passage probe', weight: 0.5}]->(k)`,
        { sourceId: runA.sourceId, secret, decisionId },
      );
      for (const user of [B, S, R]) {
        expect((await getAs(user, `/decisions/${decisionId}`)).status, user.name).toBe(404);
        expect((await getAs(user, `/decisions/${decisionId}/path`)).status, user.name).toBe(404);
      }
      const own = await getAs(A, `/decisions/${decisionId}/path`);
      expect(own.status).toBe(200);
      expect(own.body.nodes.some((n: any) => n.label === 'Chunk')).toBe(true);
      expect(own.text).toContain(secret);
      expect((await getAs(X, `/decisions/${decisionId}`)).status).toBe(200);
      const admin = await getAs(X, `/decisions/${decisionId}/path`);
      expect(admin.status).toBe(200);
      expect(admin.body.nodes.some((n: any) => n.label === 'Chunk')).toBe(false);
      expect(admin.text).not.toContain(secret);
      expect(admin.text).not.toContain(PASSAGE);
    });
  });

  describe('SEC-08 tasks and the event stream', () => {
    it("everyone else gets 404 on A's task, its stream, and retry; no token is 401; the owner reaches retry's status check (409)", async () => {
      expect((await getAs(A, `/tasks/${runA.taskId}`)).status).toBe(200);
      for (const user of [B, S, R, X]) {
        expect((await getAs(user, `/tasks/${runA.taskId}`)).status, user.name).toBe(404);
        const stream = await getAs(user, `/tasks/${runA.taskId}/events`);
        expect(stream.status, user.name).toBe(404);
        expect(String(stream.headers['content-type'])).not.toMatch(/event-stream/);
        expect(
          (await app.http.post(`/tasks/${runA.taskId}/retry`).set(user.auth)).status,
          user.name,
        ).toBe(404);
      }
      const noToken = await app.http.get(`/tasks/${runA.taskId}/events`);
      expect(noToken.status).toBe(401);
      expect(String(noToken.headers['content-type'])).not.toMatch(/event-stream/);
      expect((await app.http.post(`/tasks/${runA.taskId}/retry`).set(A.auth)).status).toBe(409);
    });
  });

  describe('SEC-09 share management is owner-only', () => {
    it('everyone else gets 404 on list, put, and delete; A gets 422 (unknown address), 422 (own address), 409 (unpublished)', async () => {
      for (const user of [B, S, R, X]) {
        expect((await getAs(user, `/puzzles/${runA.puzzleId}/shares`)).status, user.name).toBe(404);
        expect(
          (await putShare(user, runA.puzzleId, { email: S.email, withSource: false })).status,
          user.name,
        ).toBe(404);
        expect(
          (await app.http.delete(`/puzzles/${runA.puzzleId}/shares/${S.id}`).set(user.auth)).status,
          user.name,
        ).toBe(404);
      }
      const unknown = await putShare(A, runA.puzzleId, {
        email: 'nobody-signed-in@example.test',
        withSource: false,
      });
      expect(unknown.status).toBe(422);
      expect(unknown.body.error.details.issues[0].path).toBe('email');
      const own = await putShare(A, runA.puzzleId, { email: A.email, withSource: false });
      expect(own.status).toBe(422);
      expect(own.body.error.details.issues[0].path).toBe('email');
      const draft = await putShare(A, runA2.puzzleId, { email: S.email, withSource: false });
      expect(draft.status).toBe(409);
      expect((await getAs(A, `/puzzles/${runA.puzzleId}/shares`)).body).toEqual([]);
    });
  });

  describe('SEC-10 a share without the source exposes no text or passages', () => {
    it('S plays and submits, sees no passage and no source; the share view shows the owner name and no address; B, R, X still get 404', async () => {
      const shared = await putShare(A, runA.puzzleId, { email: S.email, withSource: false });
      expect(shared.status).toBe(200);
      const item = (await getAs(S, '/puzzles')).body.find((p: any) => p.id === runA.puzzleId);
      expect(item).toMatchObject({
        access: 'shared',
        ownerName: 'Alice Owner',
        sourceShared: false,
      });
      expect('sourceId' in item).toBe(false);
      expect(JSON.stringify(item)).not.toContain(A.email);
      expect((await getAs(S, `/puzzles/${runA.puzzleId}/play`)).status).toBe(200);
      const done = await submitEmpty(S, await startSession(S, runA.puzzleId));
      expect(done.status).toBe(200);
      expect(passages(done.body)).toHaveLength(0);
      expect(done.text).not.toContain(PASSAGE);
      expect(await sourceIds(S)).not.toContain(runA.sourceId);
      expect((await getAs(S, `/sources/${runA.sourceId}`)).status).toBe(404);
      for (const user of [B, R, X]) {
        expect((await getAs(user, `/puzzles/${runA.puzzleId}/play`)).status, user.name).toBe(404);
        expect(await listIds(user), user.name).not.toContain(runA.puzzleId);
      }
    });
  });

  describe('SEC-11 turning on source sharing gives access to the text', () => {
    it('S sees sourceShared true, passages, the source in the list and its content; B, R, X still nothing', async () => {
      expect((await putShare(A, runA.puzzleId, { email: S.email, withSource: true })).status).toBe(
        200,
      );
      const item = (await getAs(S, '/puzzles')).body.find((p: any) => p.id === runA.puzzleId);
      expect(item).toMatchObject({ access: 'shared', sourceShared: true, sourceId: runA.sourceId });
      const done = await submitEmpty(S, await startSession(S, runA.puzzleId));
      expect(passages(done.body).length).toBeGreaterThan(0);
      const listed = (await getAs(S, '/sources')).body.find((s: any) => s.id === runA.sourceId);
      expect(listed).toMatchObject({ access: 'shared' });
      const detail = await getAs(S, `/sources/${runA.sourceId}`);
      expect(detail.status).toBe(200);
      expect(detail.body.content).toBe(PASSAGE);
      for (const user of [B, R, X]) {
        expect(await sourceIds(user), user.name).not.toContain(runA.sourceId);
        expect((await getAs(user, `/sources/${runA.sourceId}`)).status, user.name).toBe(404);
        expect((await getAs(user, `/puzzles/${runA.puzzleId}/play`)).status, user.name).toBe(404);
      }
    });
  });

  describe('SEC-12 a revoked share stops access on the next request', () => {
    it('after DELETE (204) S has no puzzle, play, session start, or source; the old result is readable without a passage; the open session submits without a passage', async () => {
      const submitted = await submitEmpty(S, await startSession(S, runA.puzzleId));
      expect(passages(submitted.body).length).toBeGreaterThan(0);
      startedByS = await startSession(S, runA.puzzleId);
      expect(
        (await app.http.delete(`/puzzles/${runA.puzzleId}/shares/${S.id}`).set(A.auth)).status,
      ).toBe(204);
      expect(await listIds(S)).not.toContain(runA.puzzleId);
      expect((await getAs(S, `/puzzles/${runA.puzzleId}/play`)).status).toBe(404);
      expect((await app.http.post(`/puzzles/${runA.puzzleId}/sessions`).set(S.auth)).status).toBe(
        404,
      );
      expect(await sourceIds(S)).not.toContain(runA.sourceId);
      expect((await getAs(S, `/sources/${runA.sourceId}`)).status).toBe(404);
      const old = await getAs(S, `/sessions/${submitted.body.sessionId}`);
      expect(old.status).toBe(200);
      expect(passages(old.body)).toHaveLength(0);
      const late = await submitEmpty(S, startedByS);
      expect(late.status).toBe(200);
      expect(passages(late.body)).toHaveLength(0);
      expect(late.text).not.toContain(PASSAGE);
    });
  });

  describe('SEC-13 a shared user is read-only', () => {
    it('S (learner) and R (reviewer) with the share on, including the source, can read nothing of the owner side and change nothing', async () => {
      const draft = runA.questionIds[3]!;
      expect((await putShare(A, runA.puzzleId, { email: S.email, withSource: true })).status).toBe(
        200,
      );
      expect((await putShare(A, runA.puzzleId, { email: R.email, withSource: true })).status).toBe(
        200,
      );
      for (const user of [S, R]) {
        expect(
          (await getAs(user, `/review/questions?taskId=${runA.taskId}`)).status,
          user.name,
        ).toBe(404);
        // The caller's own drafts (R owns some) never include one of A's.
        expect(ids((await getAs(user, '/review/questions')).body), user.name).not.toEqual(
          expect.arrayContaining([runA.questionIds[3]]),
        );
        expect(
          (
            await app.http
              .patch(`/review/questions/${draft}`)
              .set(user.auth)
              .send({ distractors: ['x1', 'y1'] })
          ).status,
        ).toBe(404);
        expect((await approve(user, draft)).status, user.name).toBe(404);
        expect(
          (await app.http.post(`/review/questions/${draft}/reject`).set(user.auth).send({})).status,
        ).toBe(404);
        expect(
          (await putShare(user, runA.puzzleId, { email: B.email, withSource: false })).status,
          user.name,
        ).toBe(404);
        expect((await getAs(user, `/puzzles/${runA.puzzleId}/shares`)).status, user.name).toBe(404);
        expect((await getAs(user, `/tasks/${runA.taskId}`)).status, user.name).toBe(404);
      }
      const visibility = (user: TestUser) =>
        app.http
          .post(`/puzzles/${runA.puzzleId}/visibility`)
          .set(user.auth)
          .send({ visibility: 'public' });
      expect((await visibility(S)).status).toBe(403); // the role guard runs first
      expect((await visibility(R)).status).toBe(404); // staff, shared, not the owner
      const state = await getAs(A, `/puzzles/${runA.puzzleId}/shares`);
      expect(state.body.map((s: any) => s.userId).sort()).toEqual([S.id, R.id].sort());
      expect(
        (await getAs(A, '/puzzles')).body.find((p: any) => p.id === runA.puzzleId).visibility,
      ).toBe('private');
      expect((await getAs(A, `/review/questions?taskId=${runA.taskId}`)).body[0].sentence).toBe(
        draftSentence(4),
      );
      // Clean up: revoke both.
      for (const user of [S, R]) {
        expect(
          (await app.http.delete(`/puzzles/${runA.puzzleId}/shares/${user.id}`).set(A.auth)).status,
        ).toBe(204);
      }
    });
  });

  describe('SEC-14 only an owner who is a reviewer or admin can make a puzzle public', () => {
    it("A 403, B 403, R 404, X 404 on A's puzzle; R 200 on R's published puzzle; R 409 on R's unpublished puzzle", async () => {
      const visibility = (user: TestUser, puzzleId: string) =>
        app.http
          .post(`/puzzles/${puzzleId}/visibility`)
          .set(user.auth)
          .send({ visibility: 'public' });
      expect((await visibility(A, runA.puzzleId)).status).toBe(403);
      expect((await visibility(B, runA.puzzleId)).status).toBe(403);
      expect((await visibility(R, runA.puzzleId)).status).toBe(404);
      expect((await visibility(X, runA.puzzleId)).status).toBe(404);
      expect((await visibility(R, runR.puzzleId)).status).toBe(200);
      expect((await visibility(R, runR2.puzzleId)).status).toBe(409);
    });
  });

  describe('SEC-15 making a puzzle public never exposes its source', () => {
    it("B sees R's puzzle as public with sourceShared false, gets no passage, no source in the list, and 404 on the source", async () => {
      const item = (await getAs(B, '/puzzles')).body.find((p: any) => p.id === runR.puzzleId);
      expect(item).toMatchObject({ access: 'public', sourceShared: false });
      expect('sourceId' in item).toBe(false);
      expect((await getAs(B, `/puzzles/${runR.puzzleId}/play`)).status).toBe(200);
      const done = await submitEmpty(B, await startSession(B, runR.puzzleId));
      expect(done.status).toBe(200);
      expect(passages(done.body)).toHaveLength(0);
      expect(done.text).not.toContain(PASSAGE);
      expect(await sourceIds(B)).not.toContain(runR.sourceId);
      expect((await getAs(B, `/sources/${runR.sourceId}`)).status).toBe(404);
    });
  });

  describe('SEC-16 the admin exposes no source text, passages, questions, or drafts', () => {
    const FORBIDDEN = [
      'content',
      'brief',
      'outline',
      'sentence',
      'answers',
      'distractors',
      'embedding',
      'password',
      'token',
      'accessToken',
      'secret',
      'codeHash',
      'code_hash',
      'text',
      'excerpt',
    ];
    it('X sees the eight registered models, metadata-only list and detail records, and 404 for question/chunk/step', async () => {
      const models = await getAs(X, '/admin/models');
      expect(models.status).toBe(200);
      expect((models.body as any[]).map((m) => m.name).sort()).toEqual([
        'access-code',
        'admin-setting',
        'concept',
        'decision',
        'puzzle',
        'source',
        'task',
        'user',
      ]);
      const seen: string[] = [models.text];
      for (const model of ['source', 'puzzle', 'user', 'task', 'decision']) {
        const list = await getAs(X, `/admin/${model}?pageSize=100`);
        expect(list.status, model).toBe(200);
        seen.push(list.text);
        for (const item of list.body.items.slice(0, 5)) {
          const detail = await getAs(X, `/admin/${model}/${item.id}`);
          expect(detail.status, `${model}/${item.id}`).toBe(200);
          seen.push(detail.text);
        }
      }
      const sources = (await getAs(X, '/admin/source?pageSize=100')).body.items as any[];
      expect(ids(sources)).toEqual(expect.arrayContaining([runA.sourceId, promptRun.sourceId]));
      for (const source of sources.filter((s) =>
        [runA.sourceId, promptRun.sourceId].includes(s.id),
      )) {
        const detail = await getAs(X, `/admin/source/${source.id}`);
        expect(Object.keys(detail.body.record.values).sort()).toEqual([
          'createdAt',
          'id',
          'kind',
          'title',
        ]);
      }
      const all = seen.join('\n');
      expect(all).not.toContain(PASSAGE);
      expect(all).not.toContain('indexes","difficulty"'); // the prompt brief
      for (const text of seen) {
        const keys = keysOf(JSON.parse(text));
        for (const forbidden of FORBIDDEN)
          expect(keys.has(forbidden), `admin key ${forbidden}`).toBe(false);
      }
      for (const path of [
        '/admin/question',
        '/admin/chunk',
        '/admin/step',
        '/admin/question/x',
        '/admin/chunk/x',
      ]) {
        const res = await getAs(X, path);
        expect(res.status, path).toBe(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
      }
    });
  });

  describe('SEC-18 the Coach recommends only playable puzzles', () => {
    it("B, R, and X are never recommended A's private puzzle (A's is the only puzzle covering the weak concept)", async () => {
      for (const user of [B, R, X]) {
        await addMastery(app, user.id, [{ slug: 'indexes', score: 0.1, attempts: 3, daysAgo: 3 }]);
        const res = await app.http.post('/coach/recommendations').set(user.auth).send({});
        // Nothing else is playable for them (R's public puzzle is the only candidate): never A's puzzle.
        expect([201, 409], user.name).toContain(res.status);
        expect(JSON.stringify(res.body), user.name).not.toContain(runA.puzzleId);
      }
    });
  });

  describe('SEC-19 drafts never reach play or the Coach', () => {
    it('the play payload of A and of S holds only approved questions; an unpublished puzzle is neither playable nor shareable', async () => {
      expect((await putShare(A, runA.puzzleId, { email: S.email, withSource: false })).status).toBe(
        200,
      );
      for (const user of [A, S]) {
        const play = await getAs(user, `/puzzles/${runA.puzzleId}/play`);
        expect(play.status).toBe(200);
        expect(play.body.questions).toHaveLength(3);
        expect(play.text).not.toContain('Question 4:');
      }
      expect(
        (await app.http.delete(`/puzzles/${runA.puzzleId}/shares/${S.id}`).set(A.auth)).status,
      ).toBe(204);
      expect((await getAs(A, `/puzzles/${runA2.puzzleId}/play`)).status).toBe(404);
      expect(
        (await putShare(A, runA2.puzzleId, { email: S.email, withSource: false })).status,
      ).toBe(409);
      const rec = await app.http.post('/coach/recommendations').set(A.auth).send({});
      expect(JSON.stringify(rec.body)).not.toContain(runA2.puzzleId);
    });
  });

  describe('SEC-20 CORS locked to the web origin', () => {
    it('a foreign origin gets no Access-Control-Allow-Origin on preflight or GET; the web origin is echoed exactly; never *', async () => {
      const evilPre = await app.http
        .options('/puzzles')
        .set('Origin', EVIL_ORIGIN)
        .set('Access-Control-Request-Method', 'GET');
      expect(evilPre.headers['access-control-allow-origin']).toBeUndefined();
      const evilGet = await app.http.get('/health').set('Origin', EVIL_ORIGIN);
      expect(evilGet.status).toBe(200);
      expect(evilGet.headers['access-control-allow-origin']).toBeUndefined();
      const noOrigin = await app.http.get('/health');
      expect(noOrigin.headers['access-control-allow-origin']).toBeUndefined();
      const okPre = await app.http
        .options('/puzzles')
        .set('Origin', WEB_ORIGIN)
        .set('Access-Control-Request-Method', 'GET');
      expect(okPre.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
      const okGet = await app.http.get('/health').set('Origin', WEB_ORIGIN);
      expect(okGet.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
      for (const res of [evilPre, evilGet, okPre, okGet])
        expect(res.headers['access-control-allow-origin']).not.toBe('*');
    });
  });

  describe('SEC-25 share-by-e-mail is rate limited', () => {
    it('unknown addresses answer 422 on path email with one message; after the limit 429 RATE_LIMITED with Retry-After', async () => {
      const owner = await app.createUser({ role: 'learner' });
      const known = await app.createUser({ role: 'learner', signedIn: false }); // exists but never signed in
      const run = await seedRun(app, owner, { drafts: 3 });
      await publishDirectly(app, run.puzzleId);
      const messages = new Set<string>();
      let limited: any;
      for (let i = 0; i < 40 && !limited; i += 1) {
        const email = i === 1 ? known.email : `guess-${i}@example.test`;
        const res = await putShare(owner, run.puzzleId, { email, withSource: false });
        if (res.status === 429) limited = res;
        else {
          expect(res.status, `attempt ${i}`).toBe(422);
          expect(res.body.error.details.issues[0].path).toBe('email');
          messages.add(res.body.error.details.issues[0].message);
        }
      }
      expect(messages.size).toBe(1); // the same message whether or not the address exists elsewhere
      expect(limited, 'a 429 within 40 attempts').toBeDefined();
      expect(limited.body.error.code).toBe('RATE_LIMITED');
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    });
  });

  describe('SEC-26 no request-supplied identifiers in generated Cypher (admin API)', () => {
    it('an undeclared field, a field name holding Cypher, and a crafted model segment are refused; the data is unchanged', async () => {
      const before = (await getAs(X, '/admin/concept/c-indexes')).body.record;
      const undeclared = await app.http
        .patch('/admin/concept/c-indexes')
        .set(X.auth)
        .send({ values: { colour: 'red' } });
      expect(undeclared.status).toBe(422);
      expect(undeclared.body.error.details.issues[0]).toMatchObject({
        path: 'values.colour',
        code: 'unknown_field',
      });
      const cypher = await app.http
        .patch('/admin/concept/c-indexes')
        .set(X.auth)
        .send({ values: { 'name}) DETACH DELETE n //': 'x' } });
      expect(cypher.status).toBe(422);
      expect(cypher.body.error.details.issues[0].code).toBe('unknown_field');
      for (const model of [
        'Concept',
        'concept)-[',
        'concept%27%20OR%201%3D1',
        '..%2f..%2fetc',
        'user-identities',
      ]) {
        const res = await getAs(X, `/admin/${model}`);
        expect(res.status, model).toBe(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
      }
      const hostileOrdering = await getAs(
        X,
        '/admin/concept?ordering=name%20DESC%20DELETE&search=%27%7D%29%20DETACH%20DELETE%20n%20%2F%2F',
      );
      expect([200, 422]).toContain(hostileOrdering.status);
      expect((await getAs(X, '/admin/concept/c-indexes')).body.record).toEqual(before);
    });
  });

  describe('SEC-28 token (API side)', () => {
    it('a development token holds the user id and times only: no e-mail address, name, or role', async () => {
      const res = await app.http.post('/auth/dev-login').send({ email: A.email });
      expect(res.status).toBe(200);
      const [header, payload] = String(res.body.accessToken).split('.');
      const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8'));
      expect(JSON.parse(Buffer.from(header!, 'base64url').toString('utf8')).alg).toMatch(/^HS/);
      expect(claims.sub).toBe(A.id);
      expect(JSON.stringify(claims)).not.toContain(A.email);
      expect(JSON.stringify(claims)).not.toContain('Alice');
      expect(typeof claims.exp).toBe('number');
    });
  });

  describe('SEC-29 server-side input validation', () => {
    const postBody = (user: TestUser, path: string, verb: 'post' | 'put' | 'patch') =>
      (app.http as any)[verb](path).set(user.auth);

    it('unparseable JSON is 400 VALIDATION_FAILED on every body route', async () => {
      const targets: Array<['post' | 'put' | 'patch', string]> = [
        ['post', '/sources'],
        ['post', `/sessions/${sessionA}/submit`],
        ['patch', `/review/questions/${runA.questionIds[3]}`],
        ['post', `/review/questions/${runA.questionIds[3]}/reject`],
        ['put', `/puzzles/${runA.puzzleId}/shares`],
        ['post', `/puzzles/${runR.puzzleId}/visibility`],
        ['post', '/coach/recommendations'],
        ['post', '/me/codes/redeem'],
        ['patch', '/admin/concept/c-indexes'],
        ['post', '/auth/dev-login'],
      ];
      for (const [verb, path] of targets) {
        const user = path.startsWith('/admin') ? X : path.includes('visibility') ? R : A;
        const res = await postBody(user, path, verb)
          .set('Content-Type', 'application/json')
          .send('{"broken": ');
        expect(res.status, `${verb} ${path}`).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
      }
    });

    it('a wrong type, a missing field, and an oversized string are 422 VALIDATION_FAILED with details.issues; nothing is written', async () => {
      const sourcesBefore = (await getAs(A, '/sources')).body.length;
      const big = 'x'.repeat(100_000);
      const cases: Array<{
        verb: 'post' | 'put' | 'patch';
        path: string;
        user: TestUser;
        bodies: unknown[];
      }> = [
        {
          verb: 'post',
          path: '/sources',
          user: A,
          bodies: [
            {},
            { title: 5, kind: 'text', content: 'x' },
            { title: 't'.repeat(10_000), kind: 'text', content: 'x' },
            {
              title: 't',
              kind: 'prompt',
              brief: { subject: big, difficulty: 'easy', sentences: 4 },
            },
          ],
        },
        {
          verb: 'post',
          path: `/sessions/${sessionA}/submit`,
          user: A,
          bodies: [
            {},
            { answers: 'no' },
            { answers: [{ questionId: 5, blank: 0, word: 'x' }] },
            { answers: [{ questionId: 'q', blank: 0, word: big }] },
          ],
        },
        {
          verb: 'patch',
          path: `/review/questions/${runA.questionIds[3]}`,
          user: A,
          bodies: [{ sentence: 5 }, { distractors: 'x' }, { sentence: big }, { unknown: true }],
        },
        {
          verb: 'put',
          path: `/puzzles/${runA.puzzleId}/shares`,
          user: A,
          bodies: [
            {},
            { email: 5, withSource: false },
            { email: `${big}@example.test`, withSource: false },
            { email: 'a@example.test', withSource: 'yes' },
          ],
        },
        {
          verb: 'post',
          path: `/puzzles/${runR.puzzleId}/visibility`,
          user: R,
          bodies: [{}, { visibility: 5 }, { visibility: 'secret' }],
        },
        {
          verb: 'post',
          path: '/coach/recommendations',
          user: A,
          bodies: [{ goal: 5 }, { goal: big }, { goal: 'ab' }],
        },
        {
          verb: 'post',
          path: '/me/codes/redeem',
          user: B,
          bodies: [{}, { code: 5 }, { code: big }],
        },
        {
          verb: 'patch',
          path: '/admin/concept/c-indexes',
          user: X,
          bodies: [{}, { values: 5 }, { values: { name: 5 } }, { values: { name: big } }],
        },
        {
          verb: 'post',
          path: '/auth/dev-login',
          user: A,
          bodies: [{}, { email: 5 }, { email: big }],
        },
      ];
      for (const c of cases) {
        for (const body of c.bodies) {
          const res = await postBody(c.user, c.path, c.verb).send(body as object);
          expect(res.status, `${c.verb} ${c.path} ${JSON.stringify(body).slice(0, 60)}`).toBe(422);
          expect(res.body.error.code).toBe('VALIDATION_FAILED');
          expect(Array.isArray(res.body.error.details?.issues)).toBe(true);
        }
      }
      expect((await getAs(A, '/sources')).body.length).toBe(sourcesBefore);
      expect((await getAs(A, '/review/questions?taskId=' + runA.taskId)).body[0].sentence).toBe(
        draftSentence(4),
      );
      expect((await getAs(X, '/admin/concept/c-indexes')).body.record.values.name).toBe('Indexes');
    });
  });

  describe('SEC-30 errors do not leak internals', () => {
    const LEAK =
      /stack|\bat \S+\.(ts|js)|\/home\/|node_modules|MATCH \(|CALL db\.|SELECT |secretpath/i;

    it('a 500 and a 503 use the standard envelope with an UPPER_SNAKE code and no stack, query, or path', async () => {
      const graph = app.app.get(GraphKit);
      const boom = new Error(
        'failure at /home/secretpath/file.ts:12 while running MATCH (n:Secret) RETURN n',
      );
      boom.stack = 'Error: boom\n    at /home/secretpath/file.ts:12:3';
      const spy = vi.spyOn(graph, 'query').mockRejectedValue(boom);
      try {
        const res = await getAs(A, '/puzzles');
        expect(res.status).toBe(500);
        expect(res.body.error.code).toBe('INTERNAL');
        expect(res.text).not.toMatch(LEAK);
        expect(Object.keys(res.body)).toEqual(['error']);
      } finally {
        spy.mockRestore();
      }
      const down = vi.spyOn(graph, 'query').mockRejectedValue(new GraphUnavailableError());
      try {
        const res = await getAs(A, '/puzzles');
        expect(res.status).toBe(503);
        expect(res.body.error.code).toBe('GRAPH_UNAVAILABLE');
        expect(res.body.error.code).toMatch(/^[A-Z][A-Z_]+$/);
        expect(res.text).not.toMatch(LEAK);
      } finally {
        down.mockRestore();
      }
    });

    it('an unreachable SQL database is 503 SQL_UNAVAILABLE without a connection string or path', async () => {
      const fresh = await app.createUser({ role: 'learner' });
      const connection = Object.assign(
        new Error('connect ECONNREFUSED 127.0.0.1:5432 (postgres://coach:coach@localhost/coach)'),
        {
          code: 'ECONNREFUSED',
          errno: -111,
          syscall: 'connect',
          address: '127.0.0.1',
          port: 5432,
        },
      );
      const spy = vi.spyOn(app.db, 'select').mockImplementation((() => {
        throw connection;
      }) as never);
      try {
        const res = await getAs(fresh, '/puzzles');
        expect(res.status).toBe(503);
        expect(res.body.error.code).toBe('SQL_UNAVAILABLE');
        expect(res.text).not.toMatch(/postgres:\/\/|coach:coach|127\.0\.0\.1|ECONNREFUSED/);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('SEC-39 a blocked account is refused everywhere on the next request', () => {
    it('after the admin blocks B, one request per endpoint group answers 403 ACCOUNT_BLOCKED; unblocking restores access', async () => {
      const victim = await app.createUser({ role: 'learner', name: 'Victim' });
      expect((await getAs(victim, '/auth/me')).status).toBe(200);
      const block = await app.http
        .patch(`/admin/user/${victim.id}`)
        .set(X.auth)
        .send({ values: { status: 'blocked' } });
      expect(block.status).toBe(200);
      const requests: Array<[string, () => import('supertest').Test]> = [
        ['puzzles', () => app.http.get('/puzzles')],
        ['play', () => app.http.get(`/puzzles/${runR.puzzleId}/play`)],
        ['sessions', () => app.http.get(`/sessions/${sessionA}`)],
        [
          'sessions submit',
          () => app.http.post(`/sessions/${sessionA}/submit`).send({ answers: [] }),
        ],
        ['mastery', () => app.http.get('/me/mastery')],
        ['allowance', () => app.http.get('/me/allowance')],
        ['coach', () => app.http.post('/coach/recommendations').send({})],
        ['sources', () => app.http.get('/sources')],
        ['source create', () => app.http.post('/sources').send({})],
        ['review', () => app.http.get('/review/questions')],
        ['shares', () => app.http.get(`/puzzles/${runA.puzzleId}/shares`)],
        ['tasks', () => app.http.get(`/tasks/${runA.taskId}`)],
        ['event stream', () => app.http.get(`/tasks/${runA.taskId}/events`)],
        ['auth/me', () => app.http.get('/auth/me')],
      ];
      for (const [label, make] of requests) {
        const res = await make().set(victim.auth);
        expect(res.status, label).toBe(403);
        expect(res.body.error.code, label).toBe('ACCOUNT_BLOCKED');
      }
      expect(
        (
          await app.http
            .patch(`/admin/user/${victim.id}`)
            .set(X.auth)
            .send({ values: { status: 'active' } })
        ).status,
      ).toBe(200);
      expect((await getAs(victim, '/puzzles')).status).toBe(200);
      expect((await getAs(victim, '/auth/me')).status).toBe(200);
    });
  });

  describe('SEC-41 paused creation refuses both kinds while play works', () => {
    it('with creationEnabled false: upload and prompt are 503 CREATION_PAUSED, a run already started still finishes, everything else works; on again restores creation', async () => {
      const learner = await app.createUser({ role: 'learner', name: 'Creator' });
      const body = (n: number) => ({
        title: `Notes ${n}`,
        kind: 'text',
        content: `${LONG_TEXT}\n\nPause probe closing note ${n}.`,
      });
      const prompt = (n: number) => ({
        title: `Prompt ${n}`,
        kind: 'prompt',
        brief: {
          subject: `Pause probe ${n}`,
          focus: 'Call numbers',
          difficulty: 'easy',
          sentences: 4,
        },
      });
      const running = await app.http.post('/sources').set(learner.auth).send(body(1));
      expect(running.status).toBe(202);
      const setSwitch = (value: boolean) =>
        app.http
          .patch('/admin/admin-setting/creationEnabled')
          .set(X.auth)
          .send({ values: { value } });
      expect((await setSwitch(false)).status).toBe(200);
      try {
        for (const payload of [body(2), prompt(2)]) {
          const res = await app.http.post('/sources').set(learner.auth).send(payload);
          expect(res.status).toBe(503);
          expect(res.body.error.code).toBe('CREATION_PAUSED');
        }
        expect((await getAs(learner, '/puzzles')).status).toBe(200);
        expect((await getAs(learner, `/puzzles/${runR.puzzleId}/play`)).status).toBe(200);
        const done = await submitEmpty(learner, await startSession(learner, runR.puzzleId));
        expect(done.status).toBe(200);
        await addMastery(app, learner.id, [
          { slug: 'indexes', score: 0.2, attempts: 3, daysAgo: 1 },
        ]);
        expect(
          (await app.http.post('/coach/recommendations').set(learner.auth).send({})).status,
        ).toBe(201);
        await app.app.get(RunOrchestrator).whenIdle(running.body.taskId);
        const task = await getAs(learner, `/tasks/${running.body.taskId}`);
        expect(task.status).toBe(200);
        expect(task.body.status).toBe('awaiting_review');
      } finally {
        expect((await setSwitch(true)).status).toBe(200);
      }
      const again = await app.http.post('/sources').set(learner.auth).send(body(3));
      expect(again.status).toBe(202);
      await app.app.get(RunOrchestrator).whenIdle(again.body.taskId);
    });
  });

  describe('SEC-42 an admin cannot block themselves', () => {
    it('blocking one own account in the admin is refused (422) and the admin stays active', async () => {
      const res = await app.http
        .patch(`/admin/user/${X.id}`)
        .set(X.auth)
        .send({ values: { status: 'blocked' } });
      expect(res.status).toBe(422);
      expect(res.body.error.details.issues[0]).toMatchObject({
        path: 'values.status',
        code: 'rejected',
      });
      expect((await getAs(X, '/auth/me')).status).toBe(200);
      expect((await getAs(X, '/auth/me')).body.status).toBe('active');
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Limits, bonus runs, and codes (SEC-40, SEC-45, SEC-46): an application of their own, so allowance settings do not leak
// ---------------------------------------------------------------------------------------------------------------------

describe('security probes: limits, bonus runs, and codes', () => {
  let app: TestApp;
  let counter = 0;

  beforeAll(async () => {
    app = await createTestApp();
    scriptCurator(app.chat);
    scriptPrompt(app.chat);
  });
  afterAll(async () => {
    await app?.close();
  });

  const settings = () => app.app.get(SettingsService);
  const accounts = () => app.app.get(AccountsService);
  const idle = (taskId: string) => app.app.get(RunOrchestrator).whenIdle(taskId);
  const text = () =>
    `${LONG_TEXT}\n\nA closing note, number ${(counter += 1)}, only for these probes.`;
  const upload = (user: TestUser) =>
    app.http
      .post('/sources')
      .set(user.auth)
      .send({ title: 'Probe notes', kind: 'text', content: text() });
  const prompt = (user: TestUser) =>
    app.http
      .post('/sources')
      .set(user.auth)
      .send({
        title: 'Probe prompt',
        kind: 'prompt',
        brief: {
          subject: `Probe subject ${(counter += 1)}`,
          focus: 'Call numbers',
          difficulty: 'easy',
          sentences: 4,
        },
      });
  async function accept(res: import('supertest').Test | Awaited<import('supertest').Test>) {
    const r: any = await res;
    expect(r.status, JSON.stringify(r.body)).toBe(202);
    await idle(r.body.taskId);
    return r.body as { taskId: string; sourceId: string };
  }
  const sourceCount = async () =>
    (await app.testGraph.cypher<{ n: number }>('MATCH (s:Source) RETURN count(s) AS n'))[0]!.n;

  describe('SEC-40 the creation after the monthly allowance is refused, for each kind separately', () => {
    it('the fourth upload and the fourth prompt answer 429 CREATION_LIMIT_REACHED (month) with the right kind; nothing is stored and no model call is made; the other kind still works; /me/allowance matches', async () => {
      await settings().set('hourlyCreationLimit', 50);
      try {
        const user = await app.createUser({ role: 'learner' });
        const before = (await app.http.get('/me/allowance').set(user.auth)).body;
        expect(before.upload).toMatchObject({ used: 0, allowance: 3, bonus: 0 });
        expect(before.prompt).toMatchObject({ used: 0, allowance: 3, bonus: 0 });
        for (let i = 0; i < 3; i += 1) await accept(upload(user));

        const stored = await sourceCount();
        const calls = app.chat.calls.length;
        const fourth: any = await upload(user);
        expect(fourth.status).toBe(429);
        expect(fourth.body.error.code).toBe('CREATION_LIMIT_REACHED');
        expect(fourth.body.error.details).toMatchObject({
          window: 'month',
          kind: 'upload',
          canRedeemCode: true,
        });
        expect(fourth.body.error.details.resetAt).toMatch(/Z$/);
        expect(Number(fourth.headers['retry-after'])).toBeGreaterThan(0);
        expect(await sourceCount()).toBe(stored);
        expect(app.chat.calls.length).toBe(calls);

        // The other kind is still available.
        for (let i = 0; i < 3; i += 1) await accept(prompt(user));
        const fourthPrompt: any = await prompt(user);
        expect(fourthPrompt.status).toBe(429);
        expect(fourthPrompt.body.error.details).toMatchObject({ window: 'month', kind: 'prompt' });

        const after = (await app.http.get('/me/allowance').set(user.auth)).body;
        expect(after.upload).toMatchObject({ used: 3, allowance: 3 });
        expect(after.prompt).toMatchObject({ used: 3, allowance: 3 });
      } finally {
        await settings().set('hourlyCreationLimit', 5);
      }
    });

    it('the sixth creation in an hour answers CREATION_LIMIT_REACHED with window hour, even with bonus runs', async () => {
      const user = await app.createUser({ role: 'learner' });
      await accounts().setBonusRuns(null, user.id, { prompt: 10 });
      for (let i = 0; i < 5; i += 1) await accept(prompt(user));
      const sixth: any = await prompt(user);
      expect(sixth.status).toBe(429);
      expect(sixth.body.error.code).toBe('CREATION_LIMIT_REACHED');
      expect(sixth.body.error.details.window).toBe('hour');
    });

    it('a reviewer and an admin are exempt past the allowance', async () => {
      await settings().set('monthlySourceAllowance', 0);
      try {
        for (const role of ['reviewer', 'admin'] as const) {
          const staff = await app.createUser({ role });
          await accept(upload(staff));
        }
      } finally {
        await settings().set('monthlySourceAllowance', 3);
      }
    });
  });

  describe('SEC-45 a bonus run is consumed exactly once under two simultaneous requests', () => {
    it('two simultaneous uploads with one bonus run and the allowance used up: one 202, one 429; the bonus ends at 0', async () => {
      await settings().set('monthlySourceAllowance', 0);
      try {
        const user = await app.createUser({ role: 'learner' });
        await accounts().setBonusRuns(null, user.id, { source: 1 });
        const results: any[] = await Promise.all([upload(user), upload(user)]);
        expect(results.map((r) => r.status).sort()).toEqual([202, 429]);
        expect(results.find((r) => r.status === 429).body.error.code).toBe(
          'CREATION_LIMIT_REACHED',
        );
        await idle(results.find((r) => r.status === 202).body.taskId);
        expect((await app.http.get('/me/allowance').set(user.auth)).body.upload.bonus).toBe(0);
      } finally {
        await settings().set('monthlySourceAllowance', 3);
      }
    });
  });

  describe('SEC-46 a code is redeemable once per account, refused generically otherwise, and throttled', () => {
    it('the first redemption returns the grant and /me/allowance shows it; every refusal is the same 422 CODE_INVALID; the sixth attempt in ten minutes is 429', async () => {
      const codes = app.app.get(CodesService);
      const grant = await codes.create({
        label: 'probe',
        sourceRuns: 1,
        promptRuns: 2,
        liftDays: 2,
        maxRedemptions: 2,
      });
      const expired = await codes.create({
        label: 'probe-expired',
        sourceRuns: 1,
        promptRuns: 0,
        liftDays: 0,
        maxRedemptions: 5,
        expiresAt: new Date(app.clock.now().getTime() - 1),
      });
      const disabled = await codes.create({
        label: 'probe-disabled',
        sourceRuns: 1,
        promptRuns: 0,
        liftDays: 0,
        maxRedemptions: 5,
      });
      await codes.disable(disabled.meta.id);
      const a = await app.createUser({ role: 'learner' });
      const s = await app.createUser({ role: 'learner' });
      const b = await app.createUser({ role: 'learner' });
      const redeem = (user: TestUser, code: string) =>
        app.http.post('/me/codes/redeem').set(user.auth).send({ code });

      const first = await redeem(a, grant.code);
      expect(first.status).toBe(200);
      expect(first.body).toEqual({
        sourceRuns: 1,
        promptRuns: 2,
        limitsLiftedUntil: new Date(app.clock.now().getTime() + 2 * 86_400_000).toISOString(),
      });
      const allowance = (await app.http.get('/me/allowance').set(a.auth)).body;
      expect(allowance.upload.bonus).toBe(1);
      expect(allowance.prompt.bonus).toBe(2);
      expect(allowance.hourly.liftedUntil).toBe(first.body.limitsLiftedUntil);

      const refused: any[] = [];
      refused.push(await redeem(a, grant.code)); // again, same account
      expect((await redeem(s, grant.code)).status).toBe(200); // second account
      refused.push(await redeem(b, grant.code)); // over the limit of two redemptions
      refused.push(await redeem(b, 'GC-00000-00000-00000-00000')); // wrong
      refused.push(await redeem(b, expired.code));
      refused.push(await redeem(b, disabled.code));
      for (const res of refused) {
        expect(res.status).toBe(422);
        expect(res.body).toEqual({
          error: { code: 'CODE_INVALID', message: 'This code is not valid' },
        });
      }
      expect((await redeem(b, 'GC-22222-22222-22222-22222')).status).toBe(422); // the fifth attempt of b
      const throttled: any = await redeem(b, 'GC-11111-11111-11111-11111');
      expect(throttled.status).toBe(429);
      expect(throttled.body.error.code).toBe('RATE_LIMITED');
      expect(Number(throttled.headers['retry-after'])).toBeGreaterThan(0);
    });
  });
});
