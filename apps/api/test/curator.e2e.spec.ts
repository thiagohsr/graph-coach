/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are untyped JSON in these tests */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  fingerprint,
  sourceId as makeSourceId,
  ingestTaskId,
  testing as fixtures,
} from '@coach/agents/curator';
import { AllowanceService } from '../src/apps/allowance/allowance.service';
import { CuratorGraph } from '../src/apps/curator/curator.graph-port';
import { RunOrchestrator } from '../src/apps/curator/run-orchestrator.service';
import { SettingsService } from '../src/common/settings/settings.service';
import { STREAM_TIMING } from '../src/apps/curator/tasks.controller';
import { TaskEventBus } from '../src/apps/curator/task-events.bus';
import { TaskRecorder } from '../src/apps/curator/task-recorder';
import { ACCESS, describeAccessMatrix, describeRoleMatrix } from './support/role-matrix';
import { createTestApp, type TestApp, type TestUser } from './support/test-app';

const { LONG_TEXT, SHORT_TEXT, TOPICS, scriptCurator } = fixtures;

let app: TestApp;
let baseUrl: string;

beforeAll(async () => {
  app = await createTestApp();
  scriptCurator(app.chat);
  baseUrl = await app.listen();
});
afterAll(async () => {
  await app?.close();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

let counter = 0;
/** A valid text that is new for its owner: the fixture plus a unique closing paragraph. */
const uniqueText = (base = LONG_TEXT) =>
  `${base}\n\nA closing note, number ${(counter += 1)}, that only this test uses.`;

const newUser = (role: 'learner' | 'reviewer' | 'admin' = 'learner') => app.createUser({ role });

const post = (user: TestUser, content: string, extra: Record<string, unknown> = {}) =>
  app.http
    .post('/sources')
    .set(user.auth)
    .send({ title: 'Library notes', kind: 'text', content, ...extra });

const orchestrator = () => app.app.get(RunOrchestrator);
const settings = () => app.app.get(SettingsService);
const idle = (taskId: string) => orchestrator().whenIdle(taskId);

/** Starts a run and waits until it has finished. */
async function ingest(user: TestUser, content = uniqueText()) {
  const res = await post(user, content);
  expect(res.status).toBe(202);
  await idle(res.body.taskId);
  return res.body as { taskId: string; sourceId: string };
}

interface Frame {
  id: string;
  event: { node: string; status: string; log?: string; payload?: Record<string, any> };
}

async function readStream(
  user: TestUser,
  taskId: string,
): Promise<{ status: number; frames: Frame[]; raw: string; headers: Headers }> {
  const res = await fetch(`${baseUrl}/api/tasks/${taskId}/events`, { headers: user.auth });
  const raw = await res.text();
  const frames: Frame[] = [];
  for (const block of raw.split('\n\n')) {
    const id = /^id: (.*)$/m.exec(block)?.[1];
    const data = /^data: (.*)$/m.exec(block)?.[1];
    if (id !== undefined && data !== undefined) frames.push({ id, event: JSON.parse(data) });
  }
  return { status: res.status, frames, raw, headers: res.headers };
}

const STEP_NODES = [
  'chunk',
  'embed',
  'extractConcepts',
  'linkPrerequisites',
  'draftQuestions',
  'validate',
];

async function countNodes(label: string): Promise<number> {
  const [row] = await app.testGraph.cypher<{ n: number }>(
    `MATCH (n:${label}) RETURN count(n) AS n`,
  );
  return row!.n;
}

async function restoreSettings() {
  await settings().set('monthlySourceAllowance', 3);
  await settings().set('hourlyCreationLimit', 5);
  await settings().set('creationEnabled', true);
  await settings().set('sourceMaxWords', 10_000);
}

afterEach(async () => {
  vi.restoreAllMocks();
  await restoreSettings();
});

// ─── S1: ingest a source ─────────────────────────────────────────────────────

describe('S1 ingest a source', () => {
  let owner: TestUser;
  let accepted: { taskId: string; sourceId: string };
  let firstStream: Awaited<ReturnType<typeof readStream>>;

  let text: string;

  beforeAll(async () => {
    owner = await newUser();
    text = uniqueText();
    const res = await post(owner, text);
    expect(res.status).toBe(202);
    accepted = res.body;
    // Connect at once: the stream carries the live events (or the replay, if the run is already over).
    firstStream = await readStream(owner, accepted.taskId);
    await idle(accepted.taskId);
  });

  it('POST /sources answers 202 with ids', () => {
    expect(accepted.taskId).toMatch(/^[0-9a-f-]{36}$/);
    expect(accepted.sourceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(accepted.taskId).toBe(ingestTaskId(accepted.sourceId));
    expect(accepted.sourceId).toBe(makeSourceId(owner.id, fingerprint(text)));
  });

  it('the stream delivers the six nodes in order, then the terminal task event, then closes', () => {
    expect(firstStream.status).toBe(200);
    expect(firstStream.headers.get('content-type')).toMatch(/text\/event-stream/);
    expect(firstStream.headers.get('cache-control')).toMatch(/no-cache/);
    const stepFrames = firstStream.frames.filter((f) => f.event.node !== 'task');
    const nodes = [...new Set(stepFrames.map((f) => f.event.node))];
    expect(nodes).toEqual(STEP_NODES);
    for (const node of STEP_NODES) {
      expect(
        stepFrames.filter((f) => f.event.node === node && f.event.status === 'complete'),
      ).toHaveLength(1);
    }
    for (const frame of stepFrames) {
      expect(typeof frame.event.payload!.stepId).toBe('string');
      expect(typeof frame.event.payload!.order).toBe('number');
      expect(frame.event.payload!.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
    // Orders never go backwards, and the terminal event is last.
    const orders = stepFrames.map((f) => f.event.payload!.order as number);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
    const last = firstStream.frames.at(-1)!;
    expect(last.event.node).toBe('task');
    expect(last.id).toBe('task:awaiting_review');
    expect(last.event.status).toBe('complete');
    expect(last.event.payload).toMatchObject({
      taskId: accepted.taskId,
      taskStatus: 'awaiting_review',
      result: null,
      lastCompletedStep: 'validate',
      error: null,
    });
    expect(firstStream.frames.filter((f) => f.event.node === 'task')).toHaveLength(1);
  });

  it('GET /tasks/:id matches the contract and the stream', async () => {
    const res = await app.http.get(`/tasks/${accepted.taskId}`).set(owner.auth);
    expect(res.status).toBe(200);
    const task = res.body;
    expect(task).toMatchObject({
      id: accepted.taskId,
      kind: 'ingest',
      status: 'awaiting_review',
      result: null,
      sourceId: accepted.sourceId,
      lastCompletedStep: 'validate',
    });
    expect(task.error).toBeUndefined();
    expect(task.steps.map((s: any) => s.node)).toEqual(STEP_NODES);
    for (const step of task.steps) {
      expect(step.status).toBe('complete');
      expect(step.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(step.finishedAt).toMatch(/Z$/);
      expect(step.usage).toBeDefined();
    }
    // stepId and order are the values on the stream events.
    const completes = firstStream.frames.filter(
      (f) => f.event.node !== 'task' && f.event.status === 'complete',
    );
    expect(task.steps.map((s: any) => [s.stepId, s.order])).toEqual(
      completes.map((f) => [f.event.payload!.stepId, f.event.payload!.order]),
    );
    // Usage: the task equals the sum of its steps, which equals what the providers reported (deterministic stubs).
    const sum = task.steps.reduce(
      (acc: Record<string, number>, s: any) => {
        for (const key of Object.keys(acc)) acc[key] = acc[key]! + s.usage[key];
        return acc;
      },
      { modelCalls: 0, inputTokens: 0, outputTokens: 0, embeddingTokens: 0 },
    );
    expect(task.usage).toEqual(sum);
    expect(task.usage.modelCalls).toBeGreaterThan(5);
    expect(task.usage).toEqual(app.tracer.totalUsage(accepted.taskId));
    expect(task.steps.find((s: any) => s.node === 'chunk').usage.modelCalls).toBe(0);
    expect(task.steps.find((s: any) => s.node === 'embed').usage.embeddingTokens).toBeGreaterThan(
      0,
    );
    expect(task.produced.concepts).toBe(TOPICS.length);
    expect(task.produced.questions).toBeGreaterThanOrEqual(3);
    expect(typeof task.produced.puzzleId).toBe('string');
    // A tracer run was opened with the task id and closed.
    expect(app.tracer.runs.find((r) => r.id === accepted.taskId)).toMatchObject({
      kind: 'ingest',
      userId: owner.id,
      ended: true,
      ok: true,
    });
  });

  it('a second connection replays the same steps and closes', async () => {
    const again = await readStream(owner, accepted.taskId);
    expect(again.status).toBe(200);
    const stepFrames = again.frames.filter((f) => f.event.node !== 'task');
    expect(stepFrames.map((f) => [f.event.node, f.event.status])).toEqual(
      STEP_NODES.map((n) => [n, 'complete']),
    );
    expect(stepFrames.map((f) => f.id)).toEqual(STEP_NODES.map((_, i) => `${i + 1}:z`));
    expect(again.frames.at(-1)!.event).toMatchObject({
      node: 'task',
      payload: { taskStatus: 'awaiting_review' },
    });
    const first = firstStream.frames.filter(
      (f) => f.event.status === 'complete' && f.event.node !== 'task',
    );
    expect(stepFrames.map((f) => f.event.payload!.stepId)).toEqual(
      first.map((f) => f.event.payload!.stepId),
    );
  });

  it('GET /sources lists the source for its owner only and never contains the text', async () => {
    const res = await app.http.get('/sources').set(owner.auth);
    expect(res.status).toBe(200);
    const item = res.body.find((s: any) => s.id === accepted.sourceId);
    expect(item).toMatchObject({
      title: 'Library notes',
      kind: 'text',
      origin: 'upload',
      access: 'owner',
      ownerName: owner.name,
      taskId: accepted.taskId,
      taskStatus: 'awaiting_review',
    });
    expect(item.chunkCount).toBeGreaterThanOrEqual(5);
    expect(item.conceptCount).toBe(TOPICS.length);
    expect(typeof item.puzzleId).toBe('string');
    expect(item.createdAt).toMatch(/Z$/);
    expect(JSON.stringify(res.body)).not.toContain('content');
    expect(JSON.stringify(res.body)).not.toContain('call number is the short code');

    const other = await newUser();
    expect((await app.http.get('/sources').set(other.auth)).body).toEqual([]);
    const staff = await newUser('admin');
    expect((await app.http.get('/sources').set(staff.auth)).body).toEqual([]);
  });

  it('wrote the graph described by the scenario: drafts with traces, a draft private puzzle, concepts, links', async () => {
    const rows = await app.testGraph.cypher<Record<string, number>>(
      `MATCH (s:Source {id: $sid})
       OPTIONAL MATCH (s)-[:HAS_CHUNK]->(ch:Chunk)
       WITH s, count(DISTINCT ch) AS chunks, sum(CASE WHEN ch.embedding IS NULL THEN 0 ELSE 1 END) AS embedded
       OPTIONAL MATCH (s)-[:YIELDED]->(p:Puzzle {status: 'draft', visibility: 'private', origin: 'upload'})
       OPTIONAL MATCH (p)-[:CONTAINS]->(q:Question {status: 'draft'})
       OPTIONAL MATCH (q)-[:GROUNDED_IN]->(g:Chunk)
       RETURN chunks, embedded, count(DISTINCT p) AS puzzles, count(DISTINCT q) AS questions, count(DISTINCT g) AS grounded`,
      { sid: accepted.sourceId },
    );
    expect(rows[0]!.chunks).toBeGreaterThanOrEqual(5);
    expect(rows[0]!.embedded).toBe(rows[0]!.chunks);
    expect(rows[0]!.puzzles).toBe(1);
    expect(rows[0]!.questions).toBeGreaterThanOrEqual(3);
    const [edges] = await app.testGraph.cypher<{ n: number }>(
      `MATCH (:Concept)-[r:PREREQUISITE_OF]->(:Concept) RETURN count(r) AS n`,
    );
    expect(edges!.n).toBeGreaterThan(0);
  });

  it('a text that yields no usable draft ends done with nothing_usable, no puzzle, and the same steps', async () => {
    const user = await newUser();
    app.chat.enqueue(
      'curator.draftQuestions',
      ...Array.from({ length: 12 }, () => ({ questions: [] })),
    );
    const { taskId } = await ingest(user);
    const task = (await app.http.get(`/tasks/${taskId}`).set(user.auth)).body;
    expect(task).toMatchObject({ status: 'done', result: 'nothing_usable' });
    expect(task.steps.map((s: any) => s.node)).toEqual(STEP_NODES);
    const stream = await readStream(user, taskId);
    expect(stream.frames.at(-1)!.id).toBe('task:done');
    expect(stream.frames.at(-1)!.event.payload).toMatchObject({
      taskStatus: 'done',
      result: 'nothing_usable',
    });
    expect(task.produced.questions).toBe(0);
    expect(task.produced.puzzleId).toBeUndefined();
  });
});

describeAccessMatrix(
  () => app,
  async (testApp, actors) => {
    const res = await testApp.http
      .post('/sources')
      .set(actors.owner.auth)
      .send({ title: 'Matrix source', kind: 'text', content: uniqueText() });
    expect(res.status).toBe(202);
    await app.app.get(RunOrchestrator).whenIdle(res.body.taskId);
    return { taskId: res.body.taskId as string, sourceId: res.body.sourceId as string };
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
  ],
);

describe('unknown ids', () => {
  it('are 404 for a task and its stream', async () => {
    const user = await newUser();
    const res = await app.http.get('/tasks/does-not-exist').set(user.auth);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    const stream = await readStream(user, 'does-not-exist');
    expect(stream.status).toBe(404);
  });
});

// ─── S2: reject bad input cheaply ────────────────────────────────────────────

describe('S2 reject bad input cheaply', () => {
  const JUNK: Array<[string, string, string[]]> = [
    ['empty text', '', ['too_short']],
    ['the same character 5,000 times', 'a'.repeat(5000), ['too_short', 'low_diversity']],
    [
      'one URL per line',
      Array.from({ length: 150 }, (_, i) => `https://example.com/articles/${i}`).join('\n'),
      ['mostly_markup'],
    ],
    ['digits only', '1234567890 '.repeat(1000), ['low_diversity']],
    [
      'a repeated sentence',
      'The quick brown fox jumps over lazy dogs. '.repeat(200),
      ['repeated_content'],
    ],
  ];

  it('S2.1: junk is refused with 422 SOURCE_REJECTED, its reasons, no node, and no model or embedding call', async () => {
    const user = await newUser();
    const before = {
      sources: await countNodes('Source'),
      tasks: await countNodes('Task'),
      chat: app.chat.callCount(),
      embed: app.embeddings.calls.length,
    };
    for (const [, content, reasons] of JUNK) {
      const res = await post(user, content);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('SOURCE_REJECTED');
      for (const code of reasons) expect(res.body.error.details.reasons).toContain(code);
      const issues = res.body.error.details.issues as Array<{
        path: string;
        message: string;
        code: string;
      }>;
      expect(issues.length).toBe(res.body.error.details.reasons.length);
      for (const issue of issues) {
        expect(issue.path).toBe('content');
        expect(issue.message.length).toBeGreaterThan(10);
        expect(res.body.error.details.reasons).toContain(issue.code);
      }
    }
    expect(await countNodes('Source')).toBe(before.sources);
    expect(await countNodes('Task')).toBe(before.tasks);
    expect(app.chat.callCount()).toBe(before.chat);
    expect(app.embeddings.calls.length).toBe(before.embed);
  });

  it('S2.1: the messages are the ones of the HTTP contract', async () => {
    const user = await newUser();
    const res = await post(user, 'too short to be a source');
    expect(res.body.error.details.issues[0].message).toBe(
      'Add more text: at least 80 words are needed.',
    );
  });

  it('S2.1: kind url is refused as unsupported_kind', async () => {
    const user = await newUser();
    const res = await app.http
      .post('/sources')
      .set(user.auth)
      .send({ title: 'x', kind: 'url', content: 'https://example.com/a' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('SOURCE_REJECTED');
    expect(res.body.error.details.reasons).toEqual(['unsupported_kind']);
    expect(res.body.error.details.issues[0].path).toBe('kind');
  });

  it('S2.1: a malformed body is 422 VALIDATION_FAILED, not a rejection', async () => {
    const user = await newUser();
    for (const body of [
      {},
      { title: '', kind: 'text', content: 'x' },
      { title: 't', kind: 'prompt', content: 'x' },
      { title: 't', kind: 'text', content: 'x', extra: 1 },
    ]) {
      const res = await app.http.post('/sources').set(user.auth).send(body);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('S2.2: with sourceMaxWords lowered, a longer text is rejected as too_long', async () => {
    const user = await newUser();
    await settings().set('sourceMaxWords', 150);
    const res = await post(user, uniqueText());
    expect(res.status).toBe(422);
    expect(res.body.error.details.reasons).toContain('too_long');
    expect(res.body.error.details.issues.find((i: any) => i.code === 'too_long').message).toBe(
      'Shorten the text to 150 words or split it into several sources.',
    );
  });

  describe('S2.3 allowances', () => {
    it("a learner's second upload is refused with 429 CREATION_LIMIT_REACHED (month, upload) once the monthly allowance is used", async () => {
      const user = await newUser();
      await settings().set('monthlySourceAllowance', 1);
      await ingest(user);
      const res = await post(user, uniqueText());
      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('CREATION_LIMIT_REACHED');
      expect(res.body.error.details).toMatchObject({
        window: 'month',
        kind: 'upload',
        canRedeemCode: true,
      });
      expect(res.body.error.details.resetAt).toMatch(/Z$/);
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('over the hourly limit the window is "hour"', async () => {
      const user = await newUser();
      await settings().set('hourlyCreationLimit', 1);
      await ingest(user);
      const res = await post(user, uniqueText());
      expect(res.status).toBe(429);
      expect(res.body.error.details.window).toBe('hour');
    });

    it('a guard refusal and a duplicate consume nothing; an accepted submission begins exactly once and confirms once', async () => {
      const user = await newUser();
      const allowance = app.app.get(AllowanceService);
      const grants: Array<{ confirm: ReturnType<typeof vi.fn>; refund: ReturnType<typeof vi.fn> }> =
        [];
      const original = allowance.begin.bind(allowance);
      const begin = vi.spyOn(allowance, 'begin').mockImplementation(async (...args) => {
        const grant = await original(...args);
        grants.push({ confirm: vi.spyOn(grant, 'confirm'), refund: vi.spyOn(grant, 'refund') });
        return grant;
      });

      expect((await post(user, 'far too short')).status).toBe(422);
      expect(begin).not.toHaveBeenCalled();

      const text = uniqueText();
      const first = await post(user, text);
      expect(first.status).toBe(202);
      await idle(first.body.taskId);
      expect(begin).toHaveBeenCalledTimes(1);
      expect(begin).toHaveBeenCalledWith(expect.objectContaining({ id: user.id }), 'upload');
      expect(grants[0]!.confirm).toHaveBeenCalledTimes(1);
      expect(grants[0]!.refund).not.toHaveBeenCalled();

      const again = await post(user, text);
      expect(again.status).toBe(200);
      expect(begin).toHaveBeenCalledTimes(1);
    });

    it('begins just before the source is written and confirms after the source and the task exist', async () => {
      const user = await newUser();
      const allowance = app.app.get(AllowanceService);
      const graph = app.app.get(CuratorGraph);
      const order: string[] = [];
      const begin = allowance.begin.bind(allowance);
      vi.spyOn(allowance, 'begin').mockImplementation(async (...args) => {
        order.push('begin');
        const grant = await begin(...args);
        const confirm = grant.confirm.bind(grant);
        grant.confirm = () => {
          order.push('confirm');
          confirm();
        };
        return grant;
      });
      const createSource = graph.createSource.bind(graph);
      vi.spyOn(graph, 'createSource').mockImplementation(async (...args) => {
        order.push('createSource');
        return createSource(...args);
      });
      const createTask = graph.createTask.bind(graph);
      vi.spyOn(graph, 'createTask').mockImplementation(async (...args) => {
        order.push('createTask');
        return createTask(...args);
      });
      const res = await post(user, uniqueText());
      expect(res.status).toBe(202);
      await idle(res.body.taskId);
      expect(order).toEqual(['begin', 'createSource', 'createTask', 'confirm']);
    });

    it('refunds once and never confirms when the source write fails after begin', async () => {
      const user = await newUser();
      const allowance = app.app.get(AllowanceService);
      const grants: Array<{ confirm: ReturnType<typeof vi.fn>; refund: ReturnType<typeof vi.fn> }> =
        [];
      const original = allowance.begin.bind(allowance);
      vi.spyOn(allowance, 'begin').mockImplementation(async (...args) => {
        const grant = await original(...args);
        grants.push({ confirm: vi.spyOn(grant, 'confirm'), refund: vi.spyOn(grant, 'refund') });
        return grant;
      });
      vi.spyOn(app.app.get(CuratorGraph), 'createSource').mockRejectedValueOnce(
        new Error('write failed'),
      );
      const before = await countNodes('Source');
      const res = await post(user, uniqueText());
      expect(res.status).toBeGreaterThanOrEqual(500);
      expect(grants).toHaveLength(1);
      expect(grants[0]!.refund).toHaveBeenCalledTimes(1);
      expect(grants[0]!.confirm).not.toHaveBeenCalled();
      expect(await countNodes('Source')).toBe(before);
    });

    it('reviewers and admins are not limited', async () => {
      await settings().set('monthlySourceAllowance', 1);
      await settings().set('hourlyCreationLimit', 1);
      for (const role of ['reviewer', 'admin'] as const) {
        const staff = await newUser(role);
        await ingest(staff);
        const second = await post(staff, uniqueText());
        expect(second.status).toBe(202);
        await idle(second.body.taskId);
      }
    });

    it('with no allowance left, an identical upload still returns 200 with the original ids', async () => {
      const user = await newUser();
      const text = uniqueText();
      const first = await ingest(user, text);
      await settings().set('monthlySourceAllowance', 0);
      await settings().set('hourlyCreationLimit', 0);
      const fresh = await post(user, uniqueText());
      expect(fresh.status).toBe(429);
      const again = await post(user, text);
      expect(again.status).toBe(200);
      expect(again.body).toEqual({ duplicateOf: first.sourceId, taskId: first.taskId });
    });

    it('with creation paused, a new submission is 503 CREATION_PAUSED for every role; junk is still 422 and a duplicate still 200', async () => {
      const learner = await newUser();
      const text = uniqueText();
      const first = await ingest(learner, text);
      await settings().set('creationEnabled', false);
      for (const role of ['learner', 'reviewer', 'admin'] as const) {
        const user = role === 'learner' ? learner : await newUser(role);
        const res = await post(user, uniqueText());
        expect(res.status).toBe(503);
        expect(res.body.error.code).toBe('CREATION_PAUSED');
      }
      expect((await post(learner, 'junk')).status).toBe(422);
      const again = await post(learner, text);
      expect(again.status).toBe(200);
      expect(again.body.duplicateOf).toBe(first.sourceId);
      expect((await app.http.get('/sources').set(learner.auth)).status).toBe(200);
    });

    it('a run started before the switch still reaches awaiting_review', async () => {
      const user = await newUser();
      const res = await post(user, uniqueText());
      expect(res.status).toBe(202);
      await settings().set('creationEnabled', false);
      await idle(res.body.taskId);
      const task = (await app.http.get(`/tasks/${res.body.taskId}`).set(user.auth)).body;
      expect(task.status).toBe('awaiting_review');
    });
  });

  describe('S2.4 a blocked requester', () => {
    it('stops the run before its next step: the task fails with ACCOUNT_BLOCKED, and no e-mail address is stored', async () => {
      const user = await newUser();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const original = app.chat.completeStructured.bind(app.chat);
      let held = false;
      vi.spyOn(app.chat, 'completeStructured').mockImplementation(async (...args) => {
        if (!held) {
          held = true;
          await gate;
        }
        return original(...args);
      });

      const res = await post(user, uniqueText());
      expect(res.status).toBe(202);
      // The first model call (extractConcepts) is held; block the account meanwhile.
      await vi.waitFor(() => expect(held).toBe(true));
      await app.setStatus(user.id, 'blocked');
      release();
      await idle(res.body.taskId);

      const [task] = await app.testGraph.cypher<{ status: string; error: string; last: string }>(
        `MATCH (t:Task {id: $id}) RETURN t.status AS status, t.error AS error, t.lastCompletedStep AS last`,
        { id: res.body.taskId },
      );
      expect(task!.status).toBe('failed');
      expect(task!.error).toBe('linkPrerequisites: ACCOUNT_BLOCKED: account blocked');
      expect(task!.last).toBe('extractConcepts');
      const steps = await app.testGraph.cypher<{ node: string }>(
        `MATCH (:Task {id: $id})-[:HAS_STEP]->(s:Step) RETURN s.node AS node`,
        { id: res.body.taskId },
      );
      expect(steps.map((s) => s.node)).not.toContain('linkPrerequisites');

      // While blocked, every request of theirs answers 403 ACCOUNT_BLOCKED.
      const blocked = await app.http.get(`/tasks/${res.body.taskId}`).set(user.auth);
      expect(blocked.status).toBe(403);
      expect(blocked.body.error.code).toBe('ACCOUNT_BLOCKED');
      expect((await post(user, uniqueText())).status).toBe(403);

      // Unblocked, the failure is visible, and nothing names an address.
      await app.setStatus(user.id, 'active');
      const view = (await app.http.get(`/tasks/${res.body.taskId}`).set(user.auth)).body;
      expect(view.status).toBe('failed');
      expect(view.error).toBe('linkPrerequisites: ACCOUNT_BLOCKED: account blocked');
      expect(JSON.stringify(view)).not.toContain(user.email);
      const stored = await app.testGraph.cypher<{ log: string }>(
        `MATCH (s:Step) RETURN s.log AS log`,
      );
      expect(JSON.stringify(stored)).not.toContain(user.email);
      const stream = await readStream(user, res.body.taskId);
      expect(stream.frames.at(-1)!.event).toMatchObject({
        node: 'task',
        status: 'error',
        payload: { taskStatus: 'failed' },
      });
    });
  });
});

// ─── S3: do not repeat work ──────────────────────────────────────────────────

describe('S3 do not repeat work', () => {
  it('an identical or whitespace-varied resubmission is 200 with the original ids, no new nodes, no provider call', async () => {
    const user = await newUser();
    const text = uniqueText(SHORT_TEXT + '\n\n' + LONG_TEXT);
    const first = await ingest(user, text);
    const snapshot = async () => [
      await countNodes('Source'),
      await countNodes('Task'),
      await countNodes('Chunk'),
      await countNodes('Step'),
      await countNodes('Question'),
    ];
    const before = await snapshot();
    const calls = { chat: app.chat.callCount(), embed: app.embeddings.calls.length };

    const identical = await post(user, text);
    expect(identical.status).toBe(200);
    expect(identical.body).toEqual({ duplicateOf: first.sourceId, taskId: first.taskId });

    const spaced = await post(user, `  ${text.replace(/ /g, '  ').replace(/\n/g, '\r\n')}\n\n `, {
      title: 'A different title',
      kind: 'markdown',
    });
    expect(spaced.status).toBe(200);
    expect(spaced.body).toEqual({ duplicateOf: first.sourceId, taskId: first.taskId });

    expect(await snapshot()).toEqual(before);
    expect(app.chat.callCount()).toBe(calls.chat);
    expect(app.embeddings.calls.length).toBe(calls.embed);
  });

  it('answers a duplicate whatever the status of the existing task', async () => {
    const user = await newUser();
    const text = uniqueText();
    const first = await ingest(user, text);
    await app.testGraph.cypher(
      `MATCH (t:Task {id: $id}) SET t.status = 'failed', t.error = 'embed: PROVIDER_UNAVAILABLE: down'`,
      { id: first.taskId },
    );
    const again = await post(user, text);
    expect(again.status).toBe(200);
    expect(again.body.taskId).toBe(first.taskId);
  });

  it('a one-word change is 202 with different ids', async () => {
    const user = await newUser();
    const text = uniqueText();
    const first = await ingest(user, text);
    const changed = await post(user, text.replace('catalogue', 'catalogues'));
    expect(changed.status).toBe(202);
    expect(changed.body.sourceId).not.toBe(first.sourceId);
    expect(changed.body.taskId).not.toBe(first.taskId);
    await idle(changed.body.taskId);
  });

  it("the same text from another user starts that user's own run", async () => {
    const a = await newUser();
    const b = await newUser();
    const text = uniqueText();
    const first = await ingest(a, text);
    const second = await post(b, text);
    expect(second.status).toBe(202);
    expect(second.body.sourceId).not.toBe(first.sourceId);
    await idle(second.body.taskId);
    expect((await app.http.get('/sources').set(b.auth)).body).toHaveLength(1);
  });

  it('two identical requests sent together end with exactly one Source and one Task', async () => {
    const user = await newUser();
    const text = uniqueText();
    const [a, b] = await Promise.all([post(user, text), post(user, text)]);
    expect([a.status, b.status].sort()).toEqual([200, 202]);
    const accepted = a.status === 202 ? a : b;
    await idle(accepted.body.taskId);
    const [row] = await app.testGraph.cypher<{ sources: number; tasks: number }>(
      `MATCH (:Learner {id: $id})-[:OWNS]->(s:Source)
       OPTIONAL MATCH (t:Task)-[:CONCERNS]->(s)
       RETURN count(DISTINCT s) AS sources, count(DISTINCT t) AS tasks`,
      { id: user.id },
    );
    expect(row).toEqual({ sources: 1, tasks: 1 });
    const duplicate = a.status === 200 ? a : b;
    expect(duplicate.body.duplicateOf).toBe(accepted.body.sourceId);
  });

  it('a source left without a task is completed by the next submission', async () => {
    const user = await newUser();
    const text = uniqueText();
    const print = fingerprint(text);
    const orphan = makeSourceId(user.id, print);
    await app.testGraph.cypher(
      `MATCH (l:Learner {id: $owner}) CREATE (l)-[:OWNS]->(:Source {id: $id, title: 'Library notes', kind: 'text', fingerprint: $print, content: $content, createdAt: 1})`,
      { owner: user.id, id: orphan, print, content: text },
    );
    const res = await post(user, text);
    expect(res.status).toBe(202);
    expect(res.body.sourceId).toBe(orphan);
    expect(res.body.taskId).toBe(ingestTaskId(orphan));
    await idle(res.body.taskId);
    expect(await countOwnedSources(user)).toBe(1);
  });
});

async function countOwnedSources(user: TestUser): Promise<number> {
  const [row] = await app.testGraph.cypher<{ n: number }>(
    `MATCH (:Learner {id: $id})-[:OWNS]->(s:Source) RETURN count(s) AS n`,
    { id: user.id },
  );
  return row!.n;
}

// ─── The stream while a run is open ──────────────────────────────────────────

describe('the event stream of an open task', () => {
  async function openTask(user: TestUser): Promise<string> {
    const taskId = `open-${(counter += 1)}-${user.id}`;
    await app.testGraph.cypher(
      `MATCH (l:Learner {id: $id})
       CREATE (l)-[:REQUESTED]->(t:Task {id: $taskId, kind: 'ingest', status: 'in_progress', createdAt: 1, updatedAt: 1,
                                         modelCalls: 0, inputTokens: 0, outputTokens: 0, embeddingTokens: 0})`,
      { id: user.id, taskId },
    );
    return taskId;
  }

  /** Reads the response body until `done(text)` is true or the server closes the stream. */
  async function readUntil(
    response: Response,
    done: (text: string) => boolean,
  ): Promise<{ text: string; closed: boolean }> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    for (;;) {
      const { value, done: finished } = await reader.read();
      if (finished) return { text, closed: true };
      text += decoder.decode(value, { stream: true });
      if (done(text)) {
        await reader.cancel();
        return { text, closed: false };
      }
    }
  }

  const NO_USAGE = { modelCalls: 0, inputTokens: 0, outputTokens: 0, embeddingTokens: 0 };

  it('sends a ping comment, forwards live events once each in order, and closes after the terminal event', async () => {
    const user = await newUser();
    const taskId = await openTask(user);
    STREAM_TIMING.pingMs = 25;
    try {
      const response = await fetch(`${baseUrl}/api/tasks/${taskId}/events`, { headers: user.auth });
      expect(response.status).toBe(200);
      const reading = readUntil(response, () => false);

      const recorder = app.app.get(TaskRecorder);
      await new Promise((resolve) => setTimeout(resolve, 80));
      const step = await recorder.begin(taskId, 'chunk');
      recorder.progress(step, '1 of 2');
      await recorder.complete(step, '2 chunks', NO_USAGE);
      await recorder.setTaskStatus(taskId, ['in_progress'], { status: 'awaiting_review' });

      const { text, closed } = await reading;
      expect(closed).toBe(true);
      expect(text).toContain(': ping');
      const ids = [...text.matchAll(/^id: (.*)$/gm)].map((m) => m[1]);
      expect(ids).toEqual(['1:a', '1:a:1', '1:z', 'task:awaiting_review']);
    } finally {
      STREAM_TIMING.pingMs = 15_000;
    }
  });

  it('replays what is stored and then goes on live, without repeating a step', async () => {
    const user = await newUser();
    const taskId = await openTask(user);
    const recorder = app.app.get(TaskRecorder);
    const first = await recorder.begin(taskId, 'chunk');
    await recorder.complete(first, '2 chunks', NO_USAGE);
    const second = await recorder.begin(taskId, 'embed');

    const response = await fetch(`${baseUrl}/api/tasks/${taskId}/events`, { headers: user.auth });
    const reading = readUntil(response, () => false);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await recorder.complete(second, '2 chunks embedded', {
      ...NO_USAGE,
      modelCalls: 1,
      embeddingTokens: 9,
    });
    await recorder.setTaskStatus(taskId, ['in_progress'], {
      status: 'failed',
      error: 'extractConcepts: PROVIDER_UNAVAILABLE: down',
    });

    const { text, closed } = await reading;
    expect(closed).toBe(true);
    const ids = [...text.matchAll(/^id: (.*)$/gm)].map((m) => m[1]);
    // chunk replayed as complete; embed replayed as active, then completed live; then the terminal event.
    expect(ids).toEqual(['1:z', '2:a', '2:z', 'task:failed']);
    const last = JSON.parse([...text.matchAll(/^data: (.*)$/gm)].at(-1)![1]!);
    expect(last).toMatchObject({
      node: 'task',
      status: 'error',
      payload: { taskStatus: 'failed', error: 'extractConcepts: PROVIDER_UNAVAILABLE: down' },
    });
  });

  it('closes an idle non-terminal stream by itself', async () => {
    const user = await newUser();
    const taskId = await openTask(user);
    STREAM_TIMING.idleMs = 60;
    try {
      const response = await fetch(`${baseUrl}/api/tasks/${taskId}/events`, { headers: user.auth });
      const { closed } = await readUntil(response, () => false);
      expect(closed).toBe(true);
    } finally {
      STREAM_TIMING.idleMs = 10 * 60_000;
    }
  });

  it('stops listening when the client goes away', async () => {
    const user = await newUser();
    const taskId = await openTask(user);
    const bus = app.app.get(TaskEventBus);
    const response = await fetch(`${baseUrl}/api/tasks/${taskId}/events`, { headers: user.auth });
    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(bus.listenerCount(taskId)).toBe(1));
    await response.body!.cancel();
    await vi.waitFor(() => expect(bus.listenerCount(taskId)).toBe(0));
  });
});

describeRoleMatrix(
  () => app,
  [
    { method: 'POST', path: '/sources', body: {}, allowed: ['learner', 'reviewer', 'admin'] },
    { method: 'GET', path: '/sources', allowed: ['learner', 'reviewer', 'admin'] },
    { method: 'GET', path: '/tasks/nothing', allowed: ['learner', 'reviewer', 'admin'] },
  ],
);
