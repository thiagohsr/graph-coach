// Privacy sweep (SC-U07): every source, draft, task, and share endpoint, for the six actors of the access matrix.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCESS, describeAccessMatrix, type Actor, type Actors } from './support/role-matrix';
import { publishDirectly, seedRun, type SeededRun } from './support/review-fixture';
import { createTestApp, type TestApp, type TestUser } from './support/test-app';

let app: TestApp;

beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app?.close();
});

interface Ctx {
  run: SeededRun;
  target: TestUser;
  /** A string that is in `Source.content` and in no chunk, draft, or other node. */
  secret: string;
}

type Req = { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string; body?: unknown };
interface Row {
  name: string;
  request: (ctx: Ctx) => Req;
  expect: Partial<Record<Actor, number>>;
  /** Actors whose response may carry `Source.content` (only the source endpoint, only the canReadSource callers). */
  mayHoldContent?: Actor[];
  /** Rows that change state: not repeated for the owner in the body sweep. */
  mutates?: boolean;
}

const LEARNERS = {
  owner: 403,
  shared: 403,
  sharedWithSource: 403,
  otherLearner: 403,
  reviewer: 404,
  admin: 404,
};

const ROWS: Row[] = [
  {
    name: 'GET /tasks/:id',
    request: (c) => ({ method: 'GET', path: `/tasks/${c.run.taskId}` }),
    expect: ACCESS.ownerOnly,
  },
  {
    name: 'GET /tasks/:id/events',
    request: (c) => ({ method: 'GET', path: `/tasks/${c.run.taskId}/events` }),
    expect: ACCESS.ownerOnly,
  },
  {
    name: 'POST /tasks/:id/retry',
    request: (c) => ({ method: 'POST', path: `/tasks/${c.run.taskId}/retry` }),
    // The owner reaches the status check: the task is not failed.
    expect: { ...ACCESS.ownerOnly, owner: 409 },
    mutates: true,
  },
  {
    name: 'GET /sources',
    request: () => ({ method: 'GET', path: '/sources' }),
    expect: {
      owner: 200,
      shared: 200,
      sharedWithSource: 200,
      otherLearner: 200,
      reviewer: 200,
      admin: 200,
    },
  },
  {
    name: 'GET /sources/:id',
    request: (c) => ({ method: 'GET', path: `/sources/${c.run.sourceId}` }),
    expect: ACCESS.ownerAndSourceShared,
    mayHoldContent: ['owner', 'sharedWithSource'],
  },
  {
    name: 'GET /review/questions?taskId',
    request: (c) => ({ method: 'GET', path: `/review/questions?taskId=${c.run.taskId}` }),
    expect: ACCESS.ownerOnly,
  },
  {
    name: 'GET /review/questions (no filter)',
    request: () => ({ method: 'GET', path: '/review/questions' }),
    expect: {
      owner: 200,
      shared: 200,
      sharedWithSource: 200,
      otherLearner: 200,
      reviewer: 200,
      admin: 200,
    },
  },
  {
    name: 'PATCH /review/questions/:id',
    request: (c) => ({
      method: 'PATCH',
      path: `/review/questions/${c.run.questionIds[0]}`,
      body: { distractors: ['queue', 'stack', 'heap'] },
    }),
    expect: ACCESS.ownerOnly,
    mutates: true,
  },
  {
    name: 'POST /review/questions/:id/approve',
    request: (c) => ({ method: 'POST', path: `/review/questions/${c.run.questionIds[1]}/approve` }),
    expect: ACCESS.ownerOnly,
    mutates: true,
  },
  {
    name: 'POST /review/questions/:id/reject',
    request: (c) => ({
      method: 'POST',
      path: `/review/questions/${c.run.questionIds[2]}/reject`,
      body: {},
    }),
    expect: ACCESS.ownerOnly,
    mutates: true,
  },
  {
    name: 'GET /puzzles/:id/shares',
    request: (c) => ({ method: 'GET', path: `/puzzles/${c.run.puzzleId}/shares` }),
    expect: ACCESS.ownerOnly,
  },
  {
    name: 'PUT /puzzles/:id/shares',
    request: (c) => ({
      method: 'PUT',
      path: `/puzzles/${c.run.puzzleId}/shares`,
      body: { email: c.target.email, withSource: false },
    }),
    expect: ACCESS.ownerOnly,
    mutates: true,
  },
  {
    name: 'POST /puzzles/:id/visibility',
    request: (c) => ({
      method: 'POST',
      path: `/puzzles/${c.run.puzzleId}/visibility`,
      body: { visibility: 'private' },
    }),
    expect: LEARNERS,
  },
  {
    name: 'DELETE /puzzles/:id/shares/:userId (a user nobody shared with)',
    request: (c) => ({
      method: 'DELETE',
      path: `/puzzles/${c.run.puzzleId}/shares/${c.target.id}`,
    }),
    expect: { ...ACCESS.ownerOnly, owner: 204 },
    mutates: true,
  },
];

const send = (user: TestUser, req: Req) => {
  const call = app.http[req.method.toLowerCase() as 'get'](req.path).set(user.auth);
  return req.body === undefined ? call : call.send(req.body as object);
};

async function arrange(testApp: TestApp, actors: Actors): Promise<Ctx> {
  const run = await seedRun(testApp, actors.owner, { drafts: 6 });
  await publishDirectly(testApp, run.puzzleId);
  const secret = `SECRET-SOURCE-TEXT-${run.sourceId}`;
  await testApp.testGraph.cypher(`MATCH (s:Source {id: $id}) SET s.content = $secret`, {
    id: run.sourceId,
    secret,
  });
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
  return { run, target, secret };
}

// The table: statuses per actor for every row.
describeAccessMatrix(
  () => app,
  arrange,
  ROWS.map((row) => ({ name: row.name, request: row.request, expect: row.expect })),
);

// Source text appears only in GET /sources/:id, and only for a caller who passes canReadSource.
describe('Source.content in responses', () => {
  const people = {} as Actors;
  let ctx: Ctx;
  beforeAll(async () => {
    people.owner = await app.createUser({ role: 'learner' });
    people.shared = await app.createUser({ role: 'learner' });
    people.sharedWithSource = await app.createUser({ role: 'learner' });
    people.otherLearner = await app.createUser({ role: 'learner' });
    people.reviewer = await app.createUser({ role: 'reviewer' });
    people.admin = await app.createUser({ role: 'admin' });
    ctx = await arrange(app, people);
  });

  it('is in no response except GET /sources/:id for the owner and the source share', async () => {
    const seenWithContent: string[] = [];
    for (const row of ROWS) {
      for (const actor of Object.keys(people) as Actor[]) {
        if (row.mutates && actor === 'owner') continue; // the owner's mutations ran above or would change state
        const res = await send(people[actor], row.request(ctx));
        const text = res.text ?? JSON.stringify(res.body);
        if (text.includes(ctx.secret)) seenWithContent.push(`${row.name} as ${actor}`);
        if (!(row.mayHoldContent ?? []).includes(actor)) {
          expect(text, `${row.name} as ${actor}`).not.toContain(ctx.secret);
        }
      }
    }
    expect(seenWithContent.sort()).toEqual([
      'GET /sources/:id as owner',
      'GET /sources/:id as sharedWithSource',
    ]);
  });

  it('the owner’s lists and task snapshot never carry it either', async () => {
    for (const path of [
      '/sources',
      `/tasks/${ctx.run.taskId}`,
      `/review/questions?taskId=${ctx.run.taskId}`,
    ]) {
      const res = await app.http.get(path).set(people.owner.auth);
      expect(res.status).toBe(200);
      expect(res.text).not.toContain(ctx.secret);
    }
  });
});

// After revocation every row for the formerly shared users equals otherLearner's.
describe('after revocation', () => {
  it('both formerly shared users get what an unrelated learner gets', async () => {
    const owner = await app.createUser({ role: 'learner' });
    const friend = await app.createUser({ role: 'learner' });
    const sourceFriend = await app.createUser({ role: 'learner' });
    const stranger = await app.createUser({ role: 'learner' });
    const actors = {
      owner,
      shared: friend,
      sharedWithSource: sourceFriend,
      otherLearner: stranger,
      reviewer: await app.createUser({ role: 'reviewer' }),
      admin: await app.createUser({ role: 'admin' }),
    } as Actors;
    const ctx = await arrange(app, actors);
    for (const user of [friend, sourceFriend]) {
      expect(
        (await app.http.delete(`/puzzles/${ctx.run.puzzleId}/shares/${user.id}`).set(owner.auth))
          .status,
      ).toBe(204);
    }
    for (const row of ROWS) {
      const baseline = await send(stranger, row.request(ctx));
      expect(baseline.status, `${row.name} as otherLearner`).toBe(row.expect.otherLearner);
      for (const user of [friend, sourceFriend]) {
        const res = await send(user, row.request(ctx));
        expect(res.status, `${row.name} after revocation`).toBe(baseline.status);
        expect(res.text, `${row.name} after revocation`).not.toContain(ctx.secret);
        if (!row.name.startsWith('GET /tasks/:id/events')) expect(res.body).toEqual(baseline.body);
      }
    }
  });
});

// Request handlers never read a task without the requester check (the pipeline's `loadTask` has no access parameter).
describe('static: request handlers do not call loadTask', () => {
  const ROOTS = ['curator', 'review'].map((d) => resolve(__dirname, '..', 'src', 'apps', d));
  const ALLOWED = new Set([
    'run-orchestrator.service.ts',
    'startup-resume.service.ts',
    'task-recorder.ts',
    'cover-pickup.service.ts',
    'curator.graph-port.ts',
  ]);

  const tsFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? tsFiles(join(dir, entry.name))
        : entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
          ? [join(dir, entry.name)]
          : [],
    );

  /** The controllers and everything they reach through relative imports inside the two folders, except the allowed files. */
  function reachable(): string[] {
    const all = ROOTS.flatMap(tsFiles);
    const seen = new Set<string>();
    const queue = all.filter((f) => f.endsWith('.controller.ts'));
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file) || ALLOWED.has(file.split('/').at(-1)!)) continue;
      seen.add(file);
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/from '(\.[^']*)'/g)) {
        const base = resolve(dirname(file), match[1]!);
        const target = all.find((f) => f === `${base}.ts` || f === join(base, 'index.ts'));
        if (target) queue.push(target);
      }
    }
    return [...seen];
  }

  it('finds the controllers and the services they inject', () => {
    const files = reachable().map((f) => f.split('/').at(-1));
    expect(files).toEqual(
      expect.arrayContaining([
        'tasks.controller.ts',
        'tasks.service.ts',
        'review.controller.ts',
        'review.service.ts',
      ]),
    );
  });

  it('none of them references loadTask or load_task', () => {
    const offenders = reachable().filter((f) => /loadTask|load_task/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
