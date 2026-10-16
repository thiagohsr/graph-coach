/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are untyped JSON in these tests */
// Spec 005, story US9 (create a puzzle from a prompt), end to end with the stub providers: the planner, writer, and critic
// are scripted stub chat answers, and the embeddings stub must never be called.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { testing as fixtures } from '@coach/agents/curator';
import { PROMPT_ORIGIN_NOTICE } from '@coach/types';
import { RunOrchestrator } from '../src/apps/curator/run-orchestrator.service';
import { SettingsService } from '../src/common/settings/settings.service';
import { ACCESS, describeAccessMatrix } from './support/role-matrix';
import { createTestApp, type TestApp, type TestUser } from './support/test-app';

const { PROMPT_LABELS, scriptPrompt } = fixtures;

const BRIEF = {
  subject: 'Library cataloguing',
  focus: 'Call numbers and the accession register',
  difficulty: 'easy',
  sentences: 4,
} as const;

let app: TestApp;
let baseUrl: string;

beforeAll(async () => {
  app = await createTestApp();
  scriptPrompt(app.chat);
  baseUrl = await app.listen();
  const settings = app.app.get(SettingsService);
  await settings.set('monthlyPromptAllowance', 50);
  await settings.set('hourlyCreationLimit', 50);
});
afterAll(async () => {
  await app?.close();
});

const newUser = (role: 'learner' | 'reviewer' | 'admin' = 'learner', name?: string) =>
  app.createUser({ role, ...(name ? { name } : {}) });
const orchestrator = () => app.app.get(RunOrchestrator);

const postPrompt = (
  user: TestUser,
  brief: Record<string, unknown> = BRIEF,
  title = 'Cataloguing',
) => app.http.post('/sources').set(user.auth).send({ title, kind: 'prompt', brief });

async function create(user: TestUser, brief: Record<string, unknown> = BRIEF) {
  const res = await postPrompt(user, brief);
  expect(res.status).toBe(202);
  await orchestrator().whenIdle(res.body.taskId);
  return res.body as { taskId: string; sourceId: string };
}

interface Frame {
  id: string;
  event: { node: string; status: string; log?: string; payload?: Record<string, any> };
}
async function readStream(user: TestUser, taskId: string) {
  const res = await fetch(`${baseUrl}/api/tasks/${taskId}/events`, { headers: user.auth });
  const raw = await res.text();
  const frames: Frame[] = [];
  for (const block of raw.split('\n\n')) {
    const id = /^id: (.*)$/m.exec(block)?.[1];
    const data = /^data: (.*)$/m.exec(block)?.[1];
    if (id !== undefined && data !== undefined) frames.push({ id, event: JSON.parse(data) });
  }
  return { status: res.status, frames };
}

const drafts = async (user: TestUser, taskId: string) =>
  (await app.http.get(`/review/questions?taskId=${taskId}`).set(user.auth)).body as any[];

const PROMPT_NODES = ['outline', 'draftQuestions', 'critique', 'refine', 'validate'];

afterEach(() => {
  app.chat.reset();
  scriptPrompt(app.chat);
});

describe('S9.1 a prompt creation runs the five steps', () => {
  let owner: TestUser;
  let accepted: { taskId: string; sourceId: string };
  let stream: Awaited<ReturnType<typeof readStream>>;

  beforeAll(async () => {
    owner = await newUser('learner', 'Prompt Owner');
    const res = await postPrompt(owner);
    expect(res.status).toBe(202);
    accepted = res.body;
    stream = await readStream(owner, accepted.taskId);
    await orchestrator().whenIdle(accepted.taskId);
  });

  it('answers 202 with ids, and the stream shows the five prompt steps, then the terminal event', () => {
    expect(accepted.taskId).toMatch(/^[0-9a-f-]{36}$/);
    expect(accepted.sourceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(stream.status).toBe(200);
    const steps = stream.frames.filter((f) => f.event.node !== 'task');
    expect([...new Set(steps.map((f) => f.event.node))]).toEqual(PROMPT_NODES);
    for (const node of PROMPT_NODES) {
      expect(
        steps.filter((f) => f.event.node === node && f.event.status === 'complete'),
      ).toHaveLength(1);
    }
    const last = stream.frames.at(-1)!;
    expect(last.id).toBe('task:awaiting_review');
    expect(last.event.payload).toMatchObject({
      taskId: accepted.taskId,
      taskStatus: 'awaiting_review',
      lastCompletedStep: 'validate',
      error: null,
    });
  });

  it('GET /tasks/:id is a generate task with all five steps, usage per step, and the produced counts', async () => {
    const res = await app.http.get(`/tasks/${accepted.taskId}`).set(owner.auth);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      kind: 'generate',
      status: 'awaiting_review',
      sourceId: accepted.sourceId,
      lastCompletedStep: 'validate',
    });
    expect(res.body.steps.map((s: any) => s.node)).toEqual(PROMPT_NODES);
    const refine = res.body.steps.find((s: any) => s.node === 'refine');
    expect(refine).toMatchObject({ status: 'complete', log: 'Nothing to rewrite' });
    expect(refine.usage.modelCalls).toBe(0);
    expect(res.body.usage.modelCalls).toBe(3);
    expect(res.body.usage.embeddingTokens).toBe(0);
    expect(res.body.produced.questions).toBe(BRIEF.sentences);
    expect(res.body.produced.concepts).toBe(2);
    expect(res.body.produced.puzzleId).toBeDefined();
  });

  it('used the planner, writer, and critic once each, and never the embeddings', async () => {
    const task = await app.http.get(`/tasks/${accepted.taskId}`).set(owner.auth);
    const calls = Object.fromEntries(task.body.steps.map((s: any) => [s.node, s.usage.modelCalls]));
    expect(calls).toEqual({ outline: 1, draftQuestions: 1, critique: 1, refine: 0, validate: 0 });
    expect(app.embeddings.calls).toHaveLength(0);
    const [chunks] = await app.testGraph.cypher<{ n: number }>(
      `MATCH (:Source {id: $id})-[:HAS_CHUNK]->(c:Chunk) RETURN count(c) AS n`,
      { id: accepted.sourceId },
    );
    expect(chunks!.n).toBe(0);
  });

  it('writes the graph described by the scenario: GENERATED_FROM, TESTS by slug, origin prompt, no GROUNDED_IN', async () => {
    const rows = await app.testGraph.cypher<any>(
      `MATCH (s:Source {id: $id})-[:YIELDED]->(p:Puzzle)-[:CONTAINS]->(q:Question)
       RETURN p.origin AS origin, p.status AS status, p.visibility AS visibility, q.status AS qs, q.critique AS critique,
              size([(q)-[:GENERATED_FROM]->(s) | 1]) AS fromBrief, size([(q)-[:GROUNDED_IN]->() | 1]) AS grounded,
              [(q)-[:TESTS]->(c:Concept) | c.slug] AS tests`,
      { id: accepted.sourceId },
    );
    expect(rows).toHaveLength(BRIEF.sentences);
    for (const row of rows) {
      expect(row).toMatchObject({
        origin: 'prompt',
        status: 'draft',
        visibility: 'private',
        qs: 'draft',
        fromBrief: 1,
        grounded: 0,
      });
      expect(row.tests.length).toBeGreaterThan(0);
      expect(JSON.parse(row.critique)).toMatchObject({ verdict: 'pass', rewritten: false });
    }
    const slugs = await app.testGraph.cypher<{ slug: string }>(
      `MATCH (:Source {id: $id})-[:YIELDED]->(:Puzzle)-[:CONTAINS]->(:Question)-[:TESTS]->(c:Concept) RETURN DISTINCT c.slug AS slug`,
      { id: accepted.sourceId },
    );
    expect(slugs.map((r) => r.slug).sort()).toEqual(['accession-register', 'call-numbers']);
    const [links] = await app.testGraph.cypher<{ links: number }>(
      `MATCH (:Concept {slug: 'call-numbers'})-[r:PREREQUISITE_OF]->(:Concept {slug: 'accession-register'}) RETURN count(r) AS links`,
    );
    expect(links!.links).toBe(1);
  });

  it('the review list shows origin prompt, no passage, and the critique, with the notice wording exported', async () => {
    const list = await drafts(owner, accepted.taskId);
    expect(list).toHaveLength(BRIEF.sentences);
    for (const draft of list) {
      expect(draft).toMatchObject({ origin: 'prompt', passage: null, taskId: accepted.taskId });
      expect(draft.critique.verdict).toBe('pass');
    }
    expect(JSON.stringify(list)).not.toMatch(/"passage":\{/);
    expect(PROMPT_ORIGIN_NOTICE).toBe('Generated from a prompt, not checked against a source');
  });

  it('GET /sources lists it with kind and origin prompt, chunkCount 0, and no brief; GET /sources/:id has the brief and no content', async () => {
    const list = await app.http.get('/sources').set(owner.auth);
    const row = list.body.find((s: any) => s.id === accepted.sourceId);
    expect(row).toMatchObject({
      kind: 'prompt',
      origin: 'prompt',
      chunkCount: 0,
      access: 'owner',
      taskId: accepted.taskId,
      taskStatus: 'awaiting_review',
    });
    expect(row.conceptCount).toBe(2);
    expect(JSON.stringify(row)).not.toContain('Library cataloguing');
    expect('brief' in row).toBe(false);

    const detail = await app.http.get(`/sources/${accepted.sourceId}`).set(owner.auth);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ kind: 'prompt', origin: 'prompt', brief: BRIEF });
    expect('content' in detail.body).toBe(false);
    expect(JSON.stringify(detail.body)).not.toMatch(/outline/i);
  });
});

describe('S9.2 several creations', () => {
  it('the same brief twice is two sources, two tasks, and two runs', async () => {
    const user = await newUser();
    const first = await create(user);
    const second = await create(user);
    expect(second.sourceId).not.toBe(first.sourceId);
    expect(second.taskId).not.toBe(first.taskId);
    const list = await app.http.get('/sources').set(user.auth);
    expect(list.body.filter((s: any) => s.kind === 'prompt')).toHaveLength(2);
  });

  it('a prompt consumes one prompt allowance, and an upload allowance is untouched', async () => {
    const user = await newUser();
    const before = (await app.http.get('/me/allowance').set(user.auth)).body;
    await create(user);
    const after = (await app.http.get('/me/allowance').set(user.auth)).body;
    expect(after.prompt.used).toBe(before.prompt.used + 1);
    expect(after.upload.used).toBe(before.upload.used);
  });
});

describe('S9.3 junk briefs are refused cheaply', () => {
  const junk: Array<[string, Record<string, unknown>, string, string]> = [
    ['an empty subject', { ...BRIEF, subject: '' }, 'VALIDATION_FAILED', ''],
    ['two letters', { ...BRIEF, subject: 'ab' }, 'VALIDATION_FAILED', ''],
    ['digits only', { ...BRIEF, subject: '12345 67890' }, 'SOURCE_REJECTED', 'brief_no_letters'],
    ['symbols only', { ...BRIEF, subject: '!!!???' }, 'SOURCE_REJECTED', 'brief_no_letters'],
    [
      'one letter repeated',
      { ...BRIEF, subject: 'aaaaaaaaaaaa' },
      'SOURCE_REJECTED',
      'brief_not_a_topic',
    ],
    [
      'a repeated word',
      { ...BRIEF, subject: 'test test test test' },
      'SOURCE_REJECTED',
      'brief_not_a_topic',
    ],
    [
      'a URL',
      { ...BRIEF, subject: 'https://example.com/page' },
      'SOURCE_REJECTED',
      'brief_not_a_topic',
    ],
    [
      'an address',
      { ...BRIEF, subject: 'someone@example.com' },
      'SOURCE_REJECTED',
      'brief_not_a_topic',
    ],
    [
      'a URL as focus',
      { ...BRIEF, focus: 'https://example.com/page' },
      'SOURCE_REJECTED',
      'brief_not_a_topic',
    ],
  ];

  it.each(junk)('%s', async (_name, brief, code, reason) => {
    const user = await newUser();
    const sources = (
      await app.testGraph.cypher<{ n: number }>(`MATCH (s:Source) RETURN count(s) AS n`)
    )[0]!.n;
    const calls = app.chat.callCount();
    const res = await postPrompt(user, brief);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe(code);
    if (reason) {
      expect(res.body.error.details.reasons).toContain(reason);
      expect(res.body.error.details.issues[0].path).toMatch(/^brief\.(subject|focus|sentences)$/);
    }
    expect(
      (await app.testGraph.cypher<{ n: number }>(`MATCH (s:Source) RETURN count(s) AS n`))[0]!.n,
    ).toBe(sources);
    expect(app.chat.callCount()).toBe(calls);
    expect(app.embeddings.calls).toHaveLength(0);
    // Nothing was consumed.
    expect((await app.http.get('/me/allowance').set(user.auth)).body.prompt.used).toBe(0);
  });

  it('brief rules the schema lets through are SOURCE_REJECTED with every failed rule and its path', async () => {
    const user = await newUser();
    const res = await postPrompt(user, { subject: '!! !!', difficulty: 'easy', sentences: 5 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('SOURCE_REJECTED');
    expect(res.body.error.details.reasons).toEqual(
      expect.arrayContaining(['brief_too_short', 'brief_no_letters']),
    );
    expect(res.body.error.details.issues.map((i: any) => i.path)).toContain('brief.subject');
  });

  it('a prompt body with content, and an upload body with a brief, are VALIDATION_FAILED', async () => {
    const user = await newUser();
    const a = await app.http
      .post('/sources')
      .set(user.auth)
      .send({ title: 'x', kind: 'prompt', brief: BRIEF, content: 'text' });
    expect(a.status).toBe(422);
    expect(a.body.error.code).toBe('VALIDATION_FAILED');
    const b = await app.http
      .post('/sources')
      .set(user.auth)
      .send({ title: 'x', kind: 'text', content: 'text', brief: BRIEF });
    expect(b.status).toBe(422);
    expect(b.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('creation paused is 503 CREATION_PAUSED for a prompt too, and a limit is 429 with kind prompt', async () => {
    const settings = app.app.get(SettingsService);
    const user = await newUser();
    await settings.set('creationEnabled', false);
    try {
      const res = await postPrompt(user);
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('CREATION_PAUSED');
    } finally {
      await settings.set('creationEnabled', true);
    }
    await settings.set('monthlyPromptAllowance', 0);
    try {
      const res = await postPrompt(user);
      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('CREATION_LIMIT_REACHED');
      expect(res.body.error.details.kind).toBe('prompt');
    } finally {
      await settings.set('monthlyPromptAllowance', 50);
    }
  });
});

describe('S9.4 review, publish, share, and play a prompt puzzle', () => {
  it('goes through the same flow as an upload, with no passage anywhere', async () => {
    const owner = await newUser('learner', 'Olivia');
    const friend = await newUser('learner', 'Friend');
    const withSource = await newUser('learner', 'Friend With Source');
    const run = await create(owner);
    const list = await drafts(owner, run.taskId);
    expect(list).toHaveLength(BRIEF.sentences);

    // PATCH re-validates without a passage: a sentence with no blank is refused, a good edit is stored.
    const bad = await app.http
      .patch(`/review/questions/${list[0].id}`)
      .set(owner.auth)
      .send({ sentence: 'A sentence without any blank in it at all, so it breaks the rule.' });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('DRAFT_INVALID');
    const good = await app.http
      .patch(`/review/questions/${list[0].id}`)
      .set(owner.auth)
      .send({ distractors: ['ledger', 'trolley', 'catalogue'] });
    expect(good.status).toBe(200);
    expect(good.body).toMatchObject({ origin: 'prompt', passage: null });
    expect(good.body.distractors).toEqual(['ledger', 'trolley', 'catalogue']);

    // Approve succeeds with GENERATED_FROM; three approvals reach minQuestions and publish.
    const outcomes = [];
    for (const draft of list.slice(0, 3)) {
      const res = await app.http.post(`/review/questions/${draft.id}/approve`).set(owner.auth);
      expect(res.status).toBe(200);
      expect(res.body.puzzle.origin).toBe('prompt');
      outcomes.push(res.body);
    }
    expect(outcomes.map((o) => o.puzzle.status)).toEqual(['draft', 'draft', 'published']);
    const last = await app.http
      .post(`/review/questions/${list[3].id}/reject`)
      .set(owner.auth)
      .send({});
    expect(last.status).toBe(200);
    expect(last.body.task).toMatchObject({ id: run.taskId, status: 'done', result: 'ok' });
    const task = await app.http.get(`/tasks/${run.taskId}`).set(owner.auth);
    expect(task.body.steps.at(-1).node).toBe('publish');
    const puzzleId = outcomes[2].puzzle.id as string;

    // Shared without the source: the friend plays, but the brief is a 404.
    const shareA = await app.http
      .put(`/puzzles/${puzzleId}/shares`)
      .set(owner.auth)
      .send({ email: friend.email, withSource: false });
    expect(shareA.status).toBe(200);
    expect((await app.http.get(`/sources/${run.sourceId}`).set(friend.auth)).status).toBe(404);
    const shareB = await app.http
      .put(`/puzzles/${puzzleId}/shares`)
      .set(owner.auth)
      .send({ email: withSource.email, withSource: true });
    expect(shareB.status).toBe(200);
    const brief = await app.http.get(`/sources/${run.sourceId}`).set(withSource.auth);
    expect(brief.status).toBe(200);
    expect(brief.body).toMatchObject({ brief: BRIEF, access: 'shared' });
    expect('content' in brief.body).toBe(false);

    // The shared user plays it; no response carries a passage.
    for (const user of [friend, withSource]) {
      const play = await app.http.get(`/puzzles/${puzzleId}/play`).set(user.auth);
      expect(play.status).toBe(200);
      expect(play.body.origin).toBe('prompt');
      const session = await app.http.post(`/puzzles/${puzzleId}/sessions`).set(user.auth);
      expect(session.status).toBe(201);
      const result = await app.http
        .post(`/sessions/${session.body.sessionId}/submit`)
        .set(user.auth)
        .send({ answers: [] });
      expect(result.status).toBe(200);
      expect(JSON.stringify([play.body, result.body])).not.toMatch(/passage/i);
    }
    // The review list of the owner never carries one either.
    const approved = await app.http.get('/review/questions?status=approved').set(owner.auth);
    expect(JSON.stringify(approved.body)).not.toMatch(/"passage":\{/);
  });
});

describe('S9.5 failure and retry behave as for uploads', () => {
  it('a failing critic leaves the task failed at critique, and retry completes without consuming allowance', async () => {
    const user = await newUser();
    app.chat.enqueue(PROMPT_LABELS.critique, new Error('provider down'));
    const run = await create(user);

    const failed = await app.http.get(`/tasks/${run.taskId}`).set(user.auth);
    expect(failed.body).toMatchObject({ status: 'failed', lastCompletedStep: 'draftQuestions' });
    expect(failed.body.error).toBe(
      'critique: PROVIDER_UNAVAILABLE: The model provider could not answer',
    );
    expect(failed.body.steps.map((s: any) => [s.node, s.status])).toEqual([
      ['outline', 'complete'],
      ['draftQuestions', 'complete'],
      ['critique', 'error'],
    ]);
    const stream = await readStream(user, run.taskId);
    expect(stream.frames.at(-1)).toMatchObject({ id: 'task:failed' });
    expect(stream.frames.at(-1)!.event.payload).toMatchObject({ taskStatus: 'failed' });

    const before = (await app.http.get('/me/allowance').set(user.auth)).body;
    const retry = await app.http.post(`/tasks/${run.taskId}/retry`).set(user.auth);
    expect(retry.status).toBe(202);
    expect(retry.body).toEqual({ taskId: run.taskId });
    await orchestrator().whenIdle(run.taskId);
    const after = (await app.http.get('/me/allowance').set(user.auth)).body;
    expect(after.prompt.used).toBe(before.prompt.used);
    expect(after.hourly.used).toBe(before.hourly.used);

    const done = (await app.http.get(`/tasks/${run.taskId}`).set(user.auth)).body;
    expect(done).toMatchObject({ status: 'awaiting_review', lastCompletedStep: 'validate' });
    expect(done.error).toBeUndefined();
    expect(done.steps.filter((s: any) => s.node === 'critique').map((s: any) => s.status)).toEqual([
      'error',
      'complete',
    ]);
    expect(done.steps.filter((s: any) => s.node === 'outline')).toHaveLength(1);
    expect(done.produced.questions).toBe(BRIEF.sentences);
    // The planner ran once for this task, even though a retry went on from the stored outline.
    expect(app.embeddings.calls).toHaveLength(0);
  });
});

describe('the access matrix of a prompt creation equals the upload one', () => {
  describeAccessMatrix(
    () => app,
    async (testApp, actors) => {
      const run = await create(actors.owner);
      const list = await drafts(actors.owner, run.taskId);
      let puzzleId = '';
      for (const draft of list.slice(0, 3)) {
        const res = await testApp.http
          .post(`/review/questions/${draft.id}/approve`)
          .set(actors.owner.auth);
        puzzleId = res.body.puzzle.id;
      }
      await testApp.http
        .put(`/puzzles/${puzzleId}/shares`)
        .set(actors.owner.auth)
        .send({ email: actors.shared.email, withSource: false });
      await testApp.http
        .put(`/puzzles/${puzzleId}/shares`)
        .set(actors.owner.auth)
        .send({ email: actors.sharedWithSource.email, withSource: true });
      return { ...run, puzzleId };
    },
    [
      {
        name: 'GET /tasks/:id',
        request: (c) => ({ method: 'GET', path: `/tasks/${c.taskId}` }),
        expect: ACCESS.ownerOnly,
      },
      {
        name: 'GET /tasks/:id/events',
        request: (c) => ({ method: 'GET', path: `/tasks/${c.taskId}/events` }),
        expect: ACCESS.ownerOnly,
      },
      {
        name: 'GET /review/questions?taskId=',
        request: (c) => ({
          method: 'GET',
          path: `/review/questions?taskId=${c.taskId}&status=approved`,
        }),
        expect: ACCESS.ownerOnly,
      },
      {
        name: 'GET /sources/:id (the brief)',
        request: (c) => ({ method: 'GET', path: `/sources/${c.sourceId}` }),
        expect: ACCESS.ownerAndSourceShared,
      },
    ],
  );
});
