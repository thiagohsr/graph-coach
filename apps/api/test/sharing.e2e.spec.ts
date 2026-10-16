/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are untyped JSON in these tests */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { UserDirectory } from '../src/apps/accounts/user-directory';
import { ACCESS, describeAccessMatrix } from './support/role-matrix';
import { PASSAGE, publishDirectly, seedRun, type SeededRun } from './support/review-fixture';
import { createTestApp, type TestApp, type TestUser } from './support/test-app';

let app: TestApp;

beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app?.close();
});

const newUser = (options: { signedIn?: boolean; name?: string } = {}) =>
  app.createUser({ role: 'learner', ...options });
const put = (owner: TestUser, puzzleId: string, body: object) =>
  app.http.put(`/puzzles/${puzzleId}/shares`).set(owner.auth).send(body);
const listShares = (owner: TestUser, puzzleId: string) =>
  app.http.get(`/puzzles/${puzzleId}/shares`).set(owner.auth);

async function publishedRun(
  owner: TestUser,
  options: { kind?: 'upload' | 'prompt' } = {},
): Promise<SeededRun> {
  const run = await seedRun(app, owner, { drafts: 3, ...options });
  await publishDirectly(app, run.puzzleId);
  return run;
}

describe('sharing a puzzle (S5.1 to S5.4)', () => {
  it('shares by address, idempotently, toggles withSource, and matches the address case-insensitively', async () => {
    const owner = await newUser();
    const friend = await newUser({ name: 'Friend' });
    const run = await publishedRun(owner);

    const first = await put(owner, run.puzzleId, {
      email: ` ${friend.email.toUpperCase()} `,
      withSource: false,
    });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      userId: friend.id,
      name: 'Friend',
      email: friend.email,
      withSource: false,
    });
    expect(first.body.sharedAt).toMatch(/Z$/);

    app.clock.advance(60_000);
    const again = await put(owner, run.puzzleId, { email: friend.email, withSource: false });
    expect(again.status).toBe(200);
    expect(again.body.sharedAt).toBe(first.body.sharedAt);
    const toggled = await put(owner, run.puzzleId, { email: friend.email, withSource: true });
    expect(toggled.body).toMatchObject({ withSource: true, sharedAt: first.body.sharedAt });

    const list = await listShares(owner, run.puzzleId);
    expect(list.status).toBe(200);
    expect(list.body).toEqual([toggled.body]);
  });

  it('a draft puzzle is 409 CONFLICT, and its share list is empty', async () => {
    const owner = await newUser();
    const friend = await newUser();
    const run = await seedRun(app, owner, { drafts: 3 });
    const res = await put(owner, run.puzzleId, { email: friend.email, withSource: false });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect((await listShares(owner, run.puzzleId)).body).toEqual([]);
  });

  it('an address with no account, one that never signed in, and the owner’s own are 422 on path email', async () => {
    const owner = await newUser();
    const never = await newUser({ signedIn: false });
    const run = await publishedRun(owner);
    for (const email of ['nobody-at-all@example.test', never.email, owner.email]) {
      const res = await put(owner, run.puzzleId, { email, withSource: false });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details.issues[0].path).toBe('email');
    }
    expect(
      (await put(owner, run.puzzleId, { email: 'not-an-address', withSource: false })).status,
    ).toBe(422);
    expect((await put(owner, run.puzzleId, { email: owner.email })).status).toBe(422);
  });

  it('withSource on a puzzle with no source is 422 on path withSource', async () => {
    const owner = await newUser();
    const friend = await newUser();
    const run = await publishedRun(owner);
    await app.testGraph.cypher(`MATCH (:Source {id: $id})-[y:YIELDED]->(:Puzzle) DELETE y`, {
      id: run.sourceId,
    });
    const res = await put(owner, run.puzzleId, { email: friend.email, withSource: true });
    expect(res.status).toBe(422);
    expect(res.body.error.details.issues[0].path).toBe('withSource');
    expect(
      (await put(owner, run.puzzleId, { email: friend.email, withSource: false })).status,
    ).toBe(200);
  });

  it('the 21st attempt in an hour is 429 RATE_LIMITED with Retry-After, failed attempts counting too', async () => {
    const owner = await newUser();
    const friend = await newUser();
    const run = await publishedRun(owner);
    for (let i = 0; i < 20; i += 1) {
      const email = i % 2 === 0 ? friend.email : `missing-${i}@example.test`;
      const res = await put(owner, run.puzzleId, { email, withSource: false });
      expect([200, 422]).toContain(res.status);
    }
    const res = await put(owner, run.puzzleId, { email: friend.email, withSource: false });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    // Reading and revoking are not limited.
    expect((await listShares(owner, run.puzzleId)).status).toBe(200);
    expect(
      (await app.http.delete(`/puzzles/${run.puzzleId}/shares/${friend.id}`).set(owner.auth))
        .status,
    ).toBe(204);
  });

  it('a non-owner is 404 before any directory lookup', async () => {
    const owner = await newUser();
    const other = await newUser();
    const run = await publishedRun(owner);
    const spy = vi.spyOn(app.app.get(UserDirectory), 'findIdByEmail');
    try {
      const res = await put(other, run.puzzleId, { email: owner.email, withSource: false });
      expect(res.status).toBe(404);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('S5.1 to S5.4 end to end: without the source, with it, and after revocation', async () => {
    const owner = await newUser({ name: 'Olivia' });
    const friend = await newUser();
    const run = await publishedRun(owner);
    const read = () => app.http.get(`/sources/${run.sourceId}`).set(friend.auth);
    const sources = async () => (await app.http.get('/sources').set(friend.auth)).body as any[];

    await put(owner, run.puzzleId, { email: friend.email, withSource: false });
    expect((await read()).status).toBe(404);
    expect(await sources()).toEqual([]);
    expect(
      (await app.http.get('/review/questions').query({ taskId: run.taskId }).set(friend.auth))
        .status,
    ).toBe(404);

    await put(owner, run.puzzleId, { email: friend.email, withSource: true });
    const detail = await read();
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      id: run.sourceId,
      kind: 'text',
      origin: 'upload',
      access: 'shared',
      ownerName: 'Olivia',
      content: PASSAGE,
      puzzleId: run.puzzleId,
    });
    const listed = await sources();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: run.sourceId, access: 'shared', ownerName: 'Olivia' });
    expect(listed[0].taskId).toBeUndefined();
    expect(listed[0].taskStatus).toBeUndefined();
    // The owner's address is nowhere in what the shared user receives.
    expect(JSON.stringify([detail.body, listed])).not.toContain(owner.email);

    // Turning withSource off closes the source again.
    await put(owner, run.puzzleId, { email: friend.email, withSource: false });
    expect((await read()).status).toBe(404);

    await put(owner, run.puzzleId, { email: friend.email, withSource: true });
    expect((await read()).status).toBe(200);
    expect(
      (await app.http.delete(`/puzzles/${run.puzzleId}/shares/${friend.id}`).set(owner.auth))
        .status,
    ).toBe(204);
    expect((await read()).status).toBe(404);
    expect(await sources()).toEqual([]);
    // Revoking again, or for an unknown user, is still 204.
    expect(
      (await app.http.delete(`/puzzles/${run.puzzleId}/shares/${friend.id}`).set(owner.auth))
        .status,
    ).toBe(204);
    expect(
      (await app.http.delete(`/puzzles/${run.puzzleId}/shares/unknown-user`).set(owner.auth))
        .status,
    ).toBe(204);
  });

  it('a prompt puzzle shared with its source gives the brief, and no passages', async () => {
    const owner = await newUser();
    const friend = await newUser();
    const run = await publishedRun(owner, { kind: 'prompt' });
    await put(owner, run.puzzleId, { email: friend.email, withSource: true });
    const res = await app.http.get(`/sources/${run.sourceId}`).set(friend.auth);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      kind: 'prompt',
      origin: 'prompt',
      brief: { subject: 'indexes' },
    });
    expect(res.body.content).toBeUndefined();
  });

  it('a shared user cannot review, edit, or share onward (S5.6, S5.7)', async () => {
    const owner = await newUser();
    const friend = await newUser();
    const third = await newUser();
    const run = await publishedRun(owner);
    await put(owner, run.puzzleId, { email: friend.email, withSource: true });
    const q = run.questionIds[0];
    expect(
      (await app.http.get('/review/questions').query({ taskId: run.taskId }).set(friend.auth))
        .status,
    ).toBe(404);
    expect((await app.http.get('/review/questions').set(friend.auth)).body).toEqual([]);
    expect(
      (
        await app.http
          .patch(`/review/questions/${q}`)
          .set(friend.auth)
          .send({ distractors: ['a1', 'b1'] })
      ).status,
    ).toBe(404);
    expect((await app.http.post(`/review/questions/${q}/approve`).set(friend.auth)).status).toBe(
      404,
    );
    expect(
      (await app.http.post(`/review/questions/${q}/reject`).set(friend.auth).send({})).status,
    ).toBe(404);
    expect(
      (await put(friend, run.puzzleId, { email: third.email, withSource: false })).status,
    ).toBe(404);
    expect((await listShares(friend, run.puzzleId)).status).toBe(404);
    expect(
      (await app.http.delete(`/puzzles/${run.puzzleId}/shares/${friend.id}`).set(friend.auth))
        .status,
    ).toBe(404);
  });

  it('no e-mail address is in the graph', async () => {
    const owner = await newUser();
    const friend = await newUser();
    const run = await publishedRun(owner);
    await put(owner, run.puzzleId, { email: friend.email, withSource: true });
    const nodes = await app.testGraph.cypher<{ p: Record<string, unknown> }>(
      'MATCH (n) RETURN properties(n) AS p',
    );
    const edges = await app.testGraph.cypher<{ p: Record<string, unknown> }>(
      'MATCH ()-[r]->() RETURN properties(r) AS p',
    );
    expect(JSON.stringify([...nodes, ...edges])).not.toContain('@');
  });
});

describeAccessMatrix(
  () => app,
  async (testApp, actors) => {
    const run = await seedRun(testApp, actors.owner, { drafts: 3 });
    await publishDirectly(testApp, run.puzzleId);
    for (const [user, withSource] of [
      [actors.shared, false],
      [actors.sharedWithSource, true],
    ] as const) {
      const res = await testApp.http
        .put(`/puzzles/${run.puzzleId}/shares`)
        .set(actors.owner.auth)
        .send({ email: user.email, withSource });
      if (res.status !== 200) throw new Error(`Could not arrange the share: ${res.status}`);
    }
    const target = await testApp.createUser({ role: 'learner' });
    return { run, target };
  },
  [
    {
      name: 'GET /puzzles/:id/shares',
      request: ({ run }: { run: SeededRun }) => ({
        method: 'GET',
        path: `/puzzles/${run.puzzleId}/shares`,
      }),
      expect: ACCESS.ownerOnly,
    },
    {
      name: 'PUT /puzzles/:id/shares',
      request: ({ run, target }: { run: SeededRun; target: TestUser }) => ({
        method: 'PUT',
        path: `/puzzles/${run.puzzleId}/shares`,
        body: { email: target.email, withSource: false },
      }),
      expect: ACCESS.ownerOnly,
    },
    {
      name: 'DELETE /puzzles/:id/shares/:userId',
      request: ({ run, target }: { run: SeededRun; target: TestUser }) => ({
        method: 'DELETE',
        path: `/puzzles/${run.puzzleId}/shares/${target.id}`,
      }),
      expect: { ...ACCESS.ownerOnly, owner: 204 },
    },
    {
      name: 'GET /sources/:id',
      request: ({ run }: { run: SeededRun }) => ({
        method: 'GET',
        path: `/sources/${run.sourceId}`,
      }),
      expect: ACCESS.ownerAndSourceShared,
    },
  ],
);
