/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are untyped JSON in these tests */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SettingsService } from '../src/common/settings/settings.service';
import { ACCESS, describeAccessMatrix } from './support/role-matrix';
import { PASSAGE, seedRun, type SeededRun } from './support/review-fixture';
import { createTestApp, type TestApp, type TestUser } from './support/test-app';

let app: TestApp;

beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app?.close();
});

const newUser = (role: 'learner' | 'reviewer' | 'admin' = 'learner') => app.createUser({ role });
const approve = (user: TestUser, id: string) =>
  app.http.post(`/review/questions/${id}/approve`).set(user.auth);
const reject = (user: TestUser, id: string, body: object = {}) =>
  app.http.post(`/review/questions/${id}/reject`).set(user.auth).send(body);
const task = async (user: TestUser, id: string) =>
  (await app.http.get(`/tasks/${id}`).set(user.auth)).body;

async function questionState(id: string) {
  const [row] = await app.testGraph.cypher<{ s: string; sentence: string }>(
    `MATCH (q:Question {id: $id}) RETURN q.status AS s, q.sentence AS sentence`,
    { id },
  );
  return row!;
}

describe('listing and editing drafts (S4.1, S4.2)', () => {
  let owner: TestUser;
  let run: SeededRun;
  beforeAll(async () => {
    owner = await newUser();
    run = await seedRun(app, owner, { drafts: 4 });
  });

  it('lists drafts with answers, distractors, concepts, and passage, ordered', async () => {
    const res = await app.http
      .get('/review/questions')
      .query({ taskId: run.taskId })
      .set(owner.auth);
    expect(res.status).toBe(200);
    expect(res.body.map((d: any) => d.id)).toEqual(run.questionIds);
    expect(res.body[0]).toMatchObject({
      answers: ['index'],
      distractors: ['queue', 'stack'],
      concepts: [{ id: 'c-indexes', name: 'Indexes' }],
      passage: { text: PASSAGE },
      critique: null,
      origin: 'upload',
      puzzleId: run.puzzleId,
      taskId: run.taskId,
    });
    expect((await app.http.get('/review/questions').set(owner.auth)).body).toHaveLength(4);
  });

  it('a taskId the caller did not request, or that does not exist, is 404', async () => {
    const other = await newUser();
    const res = await app.http
      .get('/review/questions')
      .query({ taskId: run.taskId })
      .set(other.auth);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(
      (await app.http.get('/review/questions').query({ taskId: 'nope' }).set(owner.auth)).status,
    ).toBe(404);
    expect((await app.http.get('/review/questions').set(other.auth)).body).toEqual([]);
  });

  it('a PATCH that breaks the blank count is 422 DRAFT_INVALID and saves nothing', async () => {
    const before = await questionState(run.questionIds[0]!);
    const res = await app.http
      .patch(`/review/questions/${run.questionIds[0]}`)
      .set(owner.auth)
      .send({ sentence: 'This sentence has ___ and also ___ two blanks in it.' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('DRAFT_INVALID');
    expect(res.body.error.details.reasons).toContain('blank_count_mismatch');
    expect(res.body.error.details.issues[0]).toMatchObject({
      path: 'answers',
      code: 'blank_count_mismatch',
    });
    expect(await questionState(run.questionIds[0]!)).toEqual(before);
  });

  it('a PATCH with an unknown field is 422 VALIDATION_FAILED; an answer outside the passage is 422 DRAFT_INVALID', async () => {
    const extra = await app.http
      .patch(`/review/questions/${run.questionIds[0]}`)
      .set(owner.auth)
      .send({ conceptIds: ['x'] });
    expect(extra.status).toBe(422);
    expect(extra.body.error.code).toBe('VALIDATION_FAILED');
    const outside = await app.http
      .patch(`/review/questions/${run.questionIds[0]}`)
      .set(owner.auth)
      .send({ answers: ['zebra'] });
    expect(outside.status).toBe(422);
    expect(outside.body.error.details.reasons).toContain('answer_not_in_passage');
  });

  it('a valid PATCH is 200 with the saved draft', async () => {
    const sentence = 'Reading rows from a huge table is much faster with an ___ in place.';
    const res = await app.http
      .patch(`/review/questions/${run.questionIds[0]}`)
      .set(owner.auth)
      .send({ sentence });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: run.questionIds[0], sentence, answers: ['index'] });
    expect((await questionState(run.questionIds[0]!)).sentence).toBe(sentence);
  });
});

describe('approving and rejecting (S4.3 to S4.7)', () => {
  it('publishes at minQuestions, closes the task on the last decision, and records every decision', async () => {
    const owner = await newUser();
    const run = await seedRun(app, owner, { drafts: 5 });
    const [q1, q2, q3, q4, q5] = run.questionIds as [string, string, string, string, string];

    const first = await approve(owner, q1);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({
      puzzle: { id: run.puzzleId, status: 'draft', visibility: 'private', origin: 'upload' },
      remainingDrafts: 4,
    });
    expect((await approve(owner, q2)).body.remainingDrafts).toBe(3);

    const third = await approve(owner, q3);
    expect(third.body).toMatchObject({
      puzzle: { status: 'published', visibility: 'private' },
      remainingDrafts: 2,
    });
    expect(third.body.task).toBeUndefined();
    expect(await task(owner, run.taskId)).toMatchObject({
      status: 'awaiting_review',
      result: null,
    });

    const fourth = await reject(owner, q4, { reason: 'Too easy' });
    expect(fourth.status).toBe(200);
    expect(fourth.body.remainingDrafts).toBe(1);
    expect(fourth.body.task).toBeUndefined();

    const last = await reject(owner, q5);
    expect(last.body).toMatchObject({
      puzzle: { status: 'published', origin: 'upload' },
      remainingDrafts: 0,
      task: { id: run.taskId, status: 'done', result: 'ok' },
    });
    expect(last.body.notPublishedReason).toBeUndefined();

    const finished = await task(owner, run.taskId);
    expect(finished).toMatchObject({ status: 'done', result: 'ok' });
    expect(finished.steps.map((s: any) => s.node)).toContain('publish');

    const edges = await app.testGraph.cypher<{
      id: string;
      d: string;
      reason: string | null;
      at: number;
    }>(
      `MATCH (:Learner {id: $owner})-[r:REVIEWED]->(q:Question) RETURN q.id AS id, r.decision AS d, r.reason AS reason, r.at AS at ORDER BY id`,
      { owner: owner.id },
    );
    expect(edges).toHaveLength(5);
    expect(edges.find((e) => e.id === q4)).toMatchObject({ d: 'rejected', reason: 'Too easy' });
    expect(edges.find((e) => e.id === q1)).toMatchObject({ d: 'approved' });
    expect(typeof edges[0]!.at).toBe('number');
  });

  it('ending below the minimum leaves the puzzle a draft and the task done with below_minimum', async () => {
    const owner = await newUser();
    const run = await seedRun(app, owner, { drafts: 3 });
    await approve(owner, run.questionIds[0]!);
    await reject(owner, run.questionIds[1]!);
    const last = await reject(owner, run.questionIds[2]!, { reason: 'x' });
    expect(last.body).toMatchObject({
      puzzle: { status: 'draft' },
      remainingDrafts: 0,
      task: { status: 'done', result: 'below_minimum' },
      notPublishedReason: { code: 'below_minimum', approved: 1, minQuestions: 3 },
    });
    expect(await task(owner, run.taskId)).toMatchObject({
      status: 'done',
      result: 'below_minimum',
    });
  });

  it('a changed minQuestions applies at the next decision', async () => {
    const settings = app.app.get(SettingsService);
    const owner = await newUser();
    const run = await seedRun(app, owner, { drafts: 4 });
    try {
      await settings.set('minQuestions', 2);
      await approve(owner, run.questionIds[0]!);
      const second = await approve(owner, run.questionIds[1]!);
      expect(second.body.puzzle.status).toBe('published');
    } finally {
      await settings.set('minQuestions', 3);
    }
  });

  it('a decision on a decided draft, or an edit of it, is 409 ALREADY_DECIDED', async () => {
    const owner = await newUser();
    const run = await seedRun(app, owner, { drafts: 4 });
    const [a, r] = run.questionIds as [string, string, ...string[]];
    await approve(owner, a);
    await reject(owner, r);
    for (const res of [
      await approve(owner, a),
      await reject(owner, a),
      await approve(owner, r),
      await app.http
        .patch(`/review/questions/${a}`)
        .set(owner.auth)
        .send({ distractors: ['one', 'two'] }),
    ]) {
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ALREADY_DECIDED');
    }
    expect((await questionState(a)).s).toBe('approved');
    expect((await questionState(r)).s).toBe('rejected');
  });

  it('two simultaneous decisions on one draft give one 200 and one 409', async () => {
    const owner = await newUser();
    const run = await seedRun(app, owner, { drafts: 4 });
    const id = run.questionIds[0]!;
    const results = await Promise.all([approve(owner, id), reject(owner, id), approve(owner, id)]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409, 409]);
  });

  it('a prompt draft carries its critique and no passage, and can be approved', async () => {
    const owner = await newUser();
    const run = await seedRun(app, owner, { drafts: 3, kind: 'prompt' });
    const list = await app.http
      .get('/review/questions')
      .query({ taskId: run.taskId })
      .set(owner.auth);
    expect(list.body[0]).toMatchObject({
      origin: 'prompt',
      passage: null,
      critique: { verdict: 'pass', note: 'fine' },
    });
    const res = await approve(owner, run.questionIds[0]!);
    expect(res.status).toBe(200);
    expect(res.body.puzzle.origin).toBe('prompt');
  });

  it('a draft is not playable until the puzzle is published', async () => {
    const owner = await newUser();
    const run = await seedRun(app, owner, { drafts: 3 });
    const status = async () =>
      (
        await app.testGraph.cypher<{ s: string }>(
          `MATCH (p:Puzzle {id: $id}) RETURN p.status AS s`,
          {
            id: run.puzzleId,
          },
        )
      )[0]!.s;
    await approve(owner, run.questionIds[0]!);
    await approve(owner, run.questionIds[1]!);
    expect(await status()).toBe('draft');
    await approve(owner, run.questionIds[2]!);
    expect(await status()).toBe('published');
  });
});

describeAccessMatrix(
  () => app,
  async (testApp, actors) => {
    const run = await seedRun(testApp, actors.owner, { drafts: 5 });
    return run;
  },
  [
    {
      name: 'GET /review/questions?taskId',
      request: (run: SeededRun) => ({
        method: 'GET',
        path: `/review/questions?taskId=${run.taskId}`,
      }),
      expect: ACCESS.ownerOnly,
    },
    {
      name: 'PATCH /review/questions/:id',
      request: (run: SeededRun) => ({
        method: 'PATCH',
        path: `/review/questions/${run.questionIds[0]}`,
        body: { distractors: ['queue', 'stack', 'heap'] },
      }),
      expect: ACCESS.ownerOnly,
    },
    {
      name: 'POST /review/questions/:id/approve',
      request: (run: SeededRun) => ({
        method: 'POST',
        path: `/review/questions/${run.questionIds[1]}/approve`,
      }),
      expect: ACCESS.ownerOnly,
    },
    {
      name: 'POST /review/questions/:id/reject',
      request: (run: SeededRun) => ({
        method: 'POST',
        path: `/review/questions/${run.questionIds[2]}/reject`,
        body: {},
      }),
      expect: ACCESS.ownerOnly,
    },
  ],
);
