/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are untyped JSON in these tests */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { publishDirectly, seedRun } from './support/review-fixture';
import { describeRoleMatrix } from './support/role-matrix';
import { createTestApp, type TestApp, type TestUser } from './support/test-app';

let app: TestApp;

beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app?.close();
});

const setVisibility = (user: TestUser, puzzleId: string, body: object) =>
  app.http.post(`/puzzles/${puzzleId}/visibility`).set(user.auth).send(body);

async function ownedPuzzle(owner: TestUser, publish = true) {
  const run = await seedRun(app, owner, { drafts: 3 });
  if (publish) await publishDirectly(app, run.puzzleId);
  return run;
}

describe('POST /puzzles/:id/visibility (S8)', () => {
  for (const role of ['reviewer', 'admin'] as const) {
    it(`a ${role} who owns a published puzzle sets public and private`, async () => {
      const owner = await app.createUser({ role });
      const run = await ownedPuzzle(owner);
      const pub = await setVisibility(owner, run.puzzleId, { visibility: 'public' });
      expect(pub.status).toBe(200);
      expect(pub.body).toEqual({ id: run.puzzleId, visibility: 'public', origin: 'upload' });
      // Repeating is a no-op and still 200.
      expect((await setVisibility(owner, run.puzzleId, { visibility: 'public' })).status).toBe(200);
      const priv = await setVisibility(owner, run.puzzleId, { visibility: 'private' });
      expect(priv.status).toBe(200);
      expect(priv.body.visibility).toBe('private');
    });
  }

  it('a learner is 403 FORBIDDEN, even for a puzzle they own', async () => {
    const owner = await app.createUser({ role: 'learner' });
    const run = await ownedPuzzle(owner);
    const res = await setVisibility(owner, run.puzzleId, { visibility: 'public' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('a reviewer or admin who does not own the puzzle, and an unknown id, are 404', async () => {
    const owner = await app.createUser({ role: 'reviewer' });
    const run = await ownedPuzzle(owner);
    for (const role of ['reviewer', 'admin'] as const) {
      const other = await app.createUser({ role });
      const res = await setVisibility(other, run.puzzleId, { visibility: 'public' });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
    expect((await setVisibility(owner, 'no-such-puzzle', { visibility: 'public' })).status).toBe(404);
  });

  it('an owned draft puzzle is 409 CONFLICT, and an invalid body is 422', async () => {
    const owner = await app.createUser({ role: 'admin' });
    const draft = await ownedPuzzle(owner, false);
    const res = await setVisibility(owner, draft.puzzleId, { visibility: 'public' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    const published = await ownedPuzzle(owner);
    for (const body of [{}, { visibility: 'everyone' }]) {
      const bad = await setVisibility(owner, published.puzzleId, body);
      expect(bad.status).toBe(422);
      expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('a public puzzle does not open its source: 404 for everyone except the owner and a user shared with the source', async () => {
    const owner = await app.createUser({ role: 'reviewer' });
    const run = await ownedPuzzle(owner);
    await setVisibility(owner, run.puzzleId, { visibility: 'public' });
    const read = (user: TestUser) => app.http.get(`/sources/${run.sourceId}`).set(user.auth);

    expect((await read(owner)).status).toBe(200);
    for (const other of [
      await app.createUser({ role: 'learner' }),
      await app.createUser({ role: 'reviewer' }),
      await app.createUser({ role: 'admin' }),
    ]) {
      expect((await read(other)).status).toBe(404);
    }

    const friend = await app.createUser({ role: 'learner' });
    await app.http
      .put(`/puzzles/${run.puzzleId}/shares`)
      .set(owner.auth)
      .send({ email: friend.email, withSource: true });
    expect((await read(friend)).status).toBe(200);
  });
});

let roleApp: TestApp;
describe('roles on the visibility route', () => {
  beforeAll(async () => {
    roleApp = app;
  });
  describeRoleMatrix(() => roleApp, [
    {
      method: 'POST',
      path: '/puzzles/any-puzzle/visibility',
      body: { visibility: 'public' },
      allowed: ['reviewer', 'admin'],
    },
  ]);
});
