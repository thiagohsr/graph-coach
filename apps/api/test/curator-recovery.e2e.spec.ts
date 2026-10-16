/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are untyped JSON in these tests */
// Spec 005, story US6 (fail visibly and recover), end to end: a failing provider ends the task `failed` with the step and
// the reason, retry goes on from there without consuming anything, a blocked requester's tasks stop, and a run killed in
// the middle of a step is resumed at start-up without a duplicate node.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { testing as fixtures, ingestTaskId } from '@coach/agents/curator';
import { CHAT_PROVIDER, EMBEDDINGS_PROVIDER, USAGE_TRACER } from '../src/common/llm/llm.module';
import { CLOCK } from '../src/common/clock';
import { AccountsService } from '../src/apps/accounts/accounts.service';
import { AllowanceService } from '../src/apps/allowance/allowance.service';
import { CuratorGraph } from '../src/apps/curator/curator.graph-port';
import { RunOrchestrator } from '../src/apps/curator/run-orchestrator.service';
import { StartupResumeService } from '../src/apps/curator/startup-resume.service';
import { TaskEventBus } from '../src/apps/curator/task-events.bus';
import { TaskRecorder } from '../src/apps/curator/task-recorder';
import { SettingsService } from '../src/common/settings/settings.service';
import { createTestApp, type TestApp, type TestUser } from './support/test-app';

const { CURATOR_LABELS, LONG_TEXT, PROMPT_LABELS, scriptCurator, scriptPrompt } = fixtures;

const BRIEF = { subject: 'Library cataloguing', difficulty: 'easy', sentences: 4 } as const;
const UPLOAD_NODES = [
  'chunk',
  'embed',
  'extractConcepts',
  'linkPrerequisites',
  'draftQuestions',
  'validate',
];
const PROMPT_NODES = ['outline', 'draftQuestions', 'critique', 'refine', 'validate'];

let app: TestApp;
let baseUrl: string;
/** Resolvers of model calls that were hung to simulate a killed process; released at the very end. */
const hung: Array<() => void> = [];

beforeAll(async () => {
  app = await createTestApp();
  scriptCurator(app.chat);
  scriptPrompt(app.chat);
  baseUrl = await app.listen();
  await restoreSettings();
});
afterAll(async () => {
  for (const release of hung) release();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await app?.close();
});

const settings = () => app.app.get(SettingsService);
const orchestrator = () => app.app.get(RunOrchestrator);

async function restoreSettings() {
  await settings().set('monthlySourceAllowance', 50);
  await settings().set('monthlyPromptAllowance', 50);
  await settings().set('hourlyCreationLimit', 50);
  await settings().set('creationEnabled', true);
}
afterEach(async () => {
  vi.restoreAllMocks();
  await restoreSettings();
});

let counter = 0;
const uniqueText = () =>
  `${LONG_TEXT}\n\nA closing note, number ${(counter += 1)}, that only this recovery test uses.`;
const newUser = (role: 'learner' | 'reviewer' | 'admin' = 'learner') => app.createUser({ role });

const postUpload = (user: TestUser, content = uniqueText()) =>
  app.http.post('/sources').set(user.auth).send({ title: 'Recovery notes', kind: 'text', content });
const postPrompt = (user: TestUser) =>
  app.http
    .post('/sources')
    .set(user.auth)
    .send({ title: 'Recovery prompt', kind: 'prompt', brief: BRIEF });

const getTask = async (user: TestUser, taskId: string) =>
  (await app.http.get(`/tasks/${taskId}`).set(user.auth)).body;

/** An upload whose extractConcepts call fails once; resolves when the run has ended. */
async function failedUpload(user: TestUser) {
  app.chat.enqueue(CURATOR_LABELS.extract, new Error('provider down'));
  const res = await postUpload(user);
  expect(res.status).toBe(202);
  await orchestrator().whenIdle(res.body.taskId);
  const task = await getTask(user, res.body.taskId);
  expect(task.status).toBe('failed');
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

async function countIds(label: string, where = ''): Promise<{ total: number; distinct: number }> {
  const [row] = await app.testGraph.cypher<{ total: number; distinct: number }>(
    `MATCH (n:${label}) ${where} RETURN count(n) AS total, count(DISTINCT n.id) AS distinct`,
  );
  return row!;
}

/** What a restart-resume test compares: nodes of one run, by label. */
async function runShape(taskId: string, sourceId: string) {
  const one = async (query: string) =>
    (await app.testGraph.cypher<{ n: number }>(query, { taskId, sourceId }))[0]!.n;
  return {
    steps: await one(`MATCH (:Task {id: $taskId})-[:HAS_STEP]->(s:Step) RETURN count(s) AS n`),
    chunks: await one(
      `MATCH (:Source {id: $sourceId})-[:HAS_CHUNK]->(c:Chunk) RETURN count(c) AS n`,
    ),
    questions: await one(
      `MATCH (:Task {id: $taskId})-[:PRODUCED]->(q:Question) RETURN count(q) AS n`,
    ),
    puzzles: await one(`MATCH (:Task {id: $taskId})-[:PRODUCED]->(p:Puzzle) RETURN count(p) AS n`),
    concepts: await one(
      `MATCH (:Task {id: $taskId})-[:PRODUCED]->(c:Concept) RETURN count(c) AS n`,
    ),
  };
}

/**
 * A fresh orchestrator on the same stores: the "restarted process", with an empty running set. The old instance keeps
 * its hung run for ever, exactly as a killed process would.
 */
function restartedOrchestrator(): RunOrchestrator {
  const get = <T>(token: any): T => app.app.get(token, { strict: false });
  return new RunOrchestrator(
    get(CuratorGraph),
    get(TaskRecorder),
    get(TaskEventBus),
    get(SettingsService),
    get(AccountsService),
    get(CLOCK),
    get(CHAT_PROVIDER),
    get(EMBEDDINGS_PROVIDER),
    get(USAGE_TRACER),
    get(AllowanceService),
  );
}

/** Makes every structured call with this label hang for ever (until the file ends); other labels run as usual. */
function hangOn(label: string) {
  const original = app.chat.completeStructured.bind(app.chat);
  return vi.spyOn(app.chat, 'completeStructured').mockImplementation(((
    messages: any,
    schema: any,
    options: any,
  ) => {
    if (options?.label === label) {
      return new Promise((_resolve, reject) =>
        hung.push(() => reject(new Error('process killed'))),
      );
    }
    return original(messages, schema, options);
  }) as never);
}

async function waitForStep(user: TestUser, taskId: string, node: string, status: string) {
  await vi.waitFor(
    async () => {
      const task = await getTask(user, taskId);
      expect(task.steps.some((s: any) => s.node === node && s.status === status)).toBe(true);
    },
    { timeout: 10_000, interval: 50 },
  );
}

// ─── Failure and retry ───────────────────────────────────────────────────────

describe('S6.1 a failing provider ends the task failed, and retry goes on', () => {
  let owner: TestUser;
  let run: { taskId: string; sourceId: string };

  beforeAll(async () => {
    owner = await newUser();
    run = await failedUpload(owner);
  });

  it('shows the error, the step, and lastCompletedStep on the task', async () => {
    const task = await getTask(owner, run.taskId);
    expect(task.error).toBe(
      'extractConcepts: PROVIDER_UNAVAILABLE: The model provider could not answer',
    );
    expect(task.lastCompletedStep).toBe('embed');
    expect(task.steps.map((s: any) => [s.node, s.status])).toEqual([
      ['chunk', 'complete'],
      ['embed', 'complete'],
      ['extractConcepts', 'error'],
    ]);
    expect(JSON.stringify(task)).not.toContain('Library');
  });

  it('ends the stream with the terminal event: status error, taskStatus failed', async () => {
    const stream = await readStream(owner, run.taskId);
    expect(stream.status).toBe(200);
    const last = stream.frames.at(-1)!;
    expect(last.id).toBe('task:failed');
    expect(last.event).toMatchObject({ node: 'task', status: 'error' });
    expect(last.event.payload).toMatchObject({
      taskStatus: 'failed',
      lastCompletedStep: 'embed',
      error: 'extractConcepts: PROVIDER_UNAVAILABLE: The model provider could not answer',
    });
    expect(
      stream.frames.some((f) => f.event.node === 'extractConcepts' && f.event.status === 'error'),
    ).toBe(true);
  });

  it('retry (no body) answers 202 { taskId }, completes the run, and adds a second entry for the failed node', async () => {
    const before = (await app.http.get('/me/allowance').set(owner.auth)).body;
    const retry = await app.http.post(`/tasks/${run.taskId}/retry`).set(owner.auth);
    expect(retry.status).toBe(202);
    expect(retry.body).toEqual({ taskId: run.taskId });
    await orchestrator().whenIdle(run.taskId);

    const task = await getTask(owner, run.taskId);
    expect(task).toMatchObject({ status: 'awaiting_review', lastCompletedStep: 'validate' });
    expect(task.error).toBeUndefined();
    expect(task.steps.map((s: any) => [s.node, s.status])).toEqual([
      ['chunk', 'complete'],
      ['embed', 'complete'],
      ['extractConcepts', 'error'],
      ['extractConcepts', 'complete'],
      ['linkPrerequisites', 'complete'],
      ['draftQuestions', 'complete'],
      ['validate', 'complete'],
    ]);
    const ids = task.steps.map((s: any) => s.stepId);
    expect(new Set(ids).size).toBe(ids.length);
    // The failed attempt keeps what it spent, and the total is the sum of the steps.
    expect(task.usage.modelCalls).toBe(
      task.steps.reduce((n: number, s: any) => n + s.usage.modelCalls, 0),
    );
    // Consumes nothing.
    const after = (await app.http.get('/me/allowance').set(owner.auth)).body;
    expect(after.upload.used).toBe(before.upload.used);
    expect(after.hourly.used).toBe(before.hourly.used);
    expect((await countIds('Chunk', `WHERE n.id IS NOT NULL`)).total).toBe(
      (await countIds('Chunk')).distinct,
    );
  });

  it('retry when the task is not failed answers 409 TASK_NOT_FAILED', async () => {
    const res = await app.http.post(`/tasks/${run.taskId}/retry`).set(owner.auth);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TASK_NOT_FAILED');
    expect(res.body.error.details).toEqual({ status: 'awaiting_review' });
  });
});

describe('S6.2 retry rules', () => {
  it('while creation is paused answers 503 CREATION_PAUSED and the task stays failed', async () => {
    const owner = await newUser();
    const run = await failedUpload(owner);
    await settings().set('creationEnabled', false);
    const res = await app.http.post(`/tasks/${run.taskId}/retry`).set(owner.auth);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('CREATION_PAUSED');
    expect((await getTask(owner, run.taskId)).status).toBe('failed');
    await settings().set('creationEnabled', true);
    expect((await app.http.post(`/tasks/${run.taskId}/retry`).set(owner.auth)).status).toBe(202);
    await orchestrator().whenIdle(run.taskId);
    expect((await getTask(owner, run.taskId)).status).toBe('awaiting_review');
  });

  it('never calls AllowanceService.begin and is not refused for hourly_limit or no_allowance', async () => {
    const owner = await newUser();
    const run = await failedUpload(owner);
    await settings().set('monthlySourceAllowance', 0);
    await settings().set('monthlyPromptAllowance', 0);
    await settings().set('hourlyCreationLimit', 0);
    const begin = vi.spyOn(app.app.get(AllowanceService), 'begin');
    // A new creation is refused now, so the limits really are exhausted.
    expect((await postUpload(owner)).status).toBe(429);
    const res = await app.http.post(`/tasks/${run.taskId}/retry`).set(owner.auth);
    expect(res.status).toBe(202);
    await orchestrator().whenIdle(run.taskId);
    expect(begin).not.toHaveBeenCalled();
    expect((await getTask(owner, run.taskId)).status).toBe('awaiting_review');
  });

  it('is requester-only: another learner, a reviewer, and an admin get 404 NOT_FOUND and nothing changes', async () => {
    const owner = await newUser();
    const run = await failedUpload(owner);
    for (const role of ['learner', 'reviewer', 'admin'] as const) {
      const other = await newUser(role);
      const res = await app.http.post(`/tasks/${run.taskId}/retry`).set(other.auth);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
    expect((await app.http.post('/tasks/not-a-task/retry').set(owner.auth)).status).toBe(404);
    expect((await getTask(owner, run.taskId)).status).toBe('failed');
  });

  it('a failed prompt run is retried the same way, from the stored outline', async () => {
    const owner = await newUser();
    app.chat.enqueue(PROMPT_LABELS.critique, new Error('provider down'));
    const res = await postPrompt(owner);
    await orchestrator().whenIdle(res.body.taskId);
    const failed = await getTask(owner, res.body.taskId);
    expect(failed).toMatchObject({
      kind: 'generate',
      status: 'failed',
      lastCompletedStep: 'draftQuestions',
    });
    expect(failed.error).toBe(
      'critique: PROVIDER_UNAVAILABLE: The model provider could not answer',
    );

    const planner = app.chat.callCount(PROMPT_LABELS.outline);
    expect((await app.http.post(`/tasks/${res.body.taskId}/retry`).set(owner.auth)).status).toBe(
      202,
    );
    await orchestrator().whenIdle(res.body.taskId);
    expect(app.chat.callCount(PROMPT_LABELS.outline)).toBe(planner);
    const done = await getTask(owner, res.body.taskId);
    expect(done.status).toBe('awaiting_review');
    expect(done.steps.filter((s: any) => s.node === 'critique').map((s: any) => s.status)).toEqual([
      'error',
      'complete',
    ]);
  });
});

// ─── Blocked requesters ──────────────────────────────────────────────────────

describe('S6.3 a blocked requester', () => {
  /** An open task made the way the request does, without starting its run. */
  async function openTask(
    user: TestUser,
    options: { status: 'queued' | 'in_progress'; lastCompletedStep?: string },
  ) {
    const graph = app.app.get(CuratorGraph);
    const content = uniqueText();
    const sourceId = `src-${user.id}-${(counter += 1)}`;
    const taskId = ingestTaskId(sourceId);
    await graph.createSource({
      id: sourceId,
      ownerId: user.id,
      title: 'Open task',
      kind: 'text',
      fingerprint: `fp-${sourceId}`,
      content,
      brief: null,
      now: 1_000,
    });
    await graph.createTask({
      id: taskId,
      kind: 'ingest',
      requesterId: user.id,
      sourceId,
      now: 1_000,
    });
    if (options.status === 'in_progress') {
      await graph.updateTask(
        taskId,
        ['queued'],
        {
          status: 'in_progress',
          ...(options.lastCompletedStep
            ? { lastCompletedStep: options.lastCompletedStep as never }
            : {}),
        },
        1_001,
      );
    }
    return { taskId, sourceId };
  }

  it("after a restart, its queued and in_progress tasks are failed with ACCOUNT_BLOCKED and make no provider call; another user's open task resumes; after unblocking, retry completes the run", async () => {
    const blocked = await newUser();
    const other = await newUser();
    const queued = await openTask(blocked, { status: 'queued' });
    const midway = await openTask(blocked, { status: 'in_progress' });
    await app.setStatus(blocked.id, 'blocked');

    const chatCalls = app.chat.callCount();
    const embedCalls = app.embeddings.calls.length;
    await app.app.get(StartupResumeService).onApplicationBootstrap();
    await orchestrator().whenResumed();

    // The blocked user's requests answer 403, so read the tasks through the graph.
    const rows = await app.testGraph.cypher<any>(
      `MATCH (t:Task) WHERE t.id IN $ids RETURN t.id AS id, t.status AS status, t.error AS error`,
      { ids: [queued.taskId, midway.taskId] },
    );
    const byId = Object.fromEntries(rows.map((r: any) => [r.id, r]));
    expect(byId[queued.taskId]).toMatchObject({
      status: 'failed',
      error: 'chunk: ACCOUNT_BLOCKED: account blocked',
    });
    expect(byId[midway.taskId]).toMatchObject({
      status: 'failed',
      error: 'chunk: ACCOUNT_BLOCKED: account blocked',
    });
    expect(app.chat.callCount()).toBe(chatCalls);
    expect(app.embeddings.calls.length).toBe(embedCalls);
    expect((await app.http.get(`/tasks/${queued.taskId}`).set(blocked.auth)).status).toBe(403);

    // Another user's open task resumes at start-up and completes.
    const theirs = await openTask(other, { status: 'queued' });
    await app.app.get(StartupResumeService).onApplicationBootstrap();
    await orchestrator().whenResumed();
    await orchestrator().whenIdle(theirs.taskId);
    expect((await getTask(other, theirs.taskId)).status).toBe('awaiting_review');
    // The blocked user's tasks were not touched again.
    const again = await app.testGraph.cypher<any>(
      `MATCH (t:Task {id: $id}) RETURN t.status AS status`,
      { id: queued.taskId },
    );
    expect(again[0].status).toBe('failed');

    // Unblocked, the requester can retry through the normal endpoint, and the run completes.
    await app.setStatus(blocked.id, 'active');
    const retry = await app.http.post(`/tasks/${midway.taskId}/retry`).set(blocked.auth);
    expect(retry.status).toBe(202);
    await orchestrator().whenIdle(midway.taskId);
    const done = await getTask(blocked, midway.taskId);
    expect(done).toMatchObject({ status: 'awaiting_review', lastCompletedStep: 'validate' });
    expect(done.steps.map((s: any) => s.node)).toEqual(UPLOAD_NODES);
  });

  it('a requester blocked while a run is going stops at the next step, failed with ACCOUNT_BLOCKED', async () => {
    const user = await newUser();
    const original = app.chat.completeStructured.bind(app.chat);
    vi.spyOn(app.chat, 'completeStructured').mockImplementation((async (
      messages: any,
      schema: any,
      options: any,
    ) => {
      // Block the account while the planner call is in flight.
      if (options?.label === PROMPT_LABELS.outline) await app.setStatus(user.id, 'blocked');
      return original(messages, schema, options);
    }) as never);
    const res = await postPrompt(user);
    expect(res.status).toBe(202);
    await orchestrator().whenIdle(res.body.taskId);
    const rows = await app.testGraph.cypher<any>(
      `MATCH (t:Task {id: $id})-[:HAS_STEP]->(s:Step) RETURN t.status AS status, t.error AS error, s.node AS node ORDER BY s.order`,
      { id: res.body.taskId },
    );
    expect(rows.map((r: any) => r.node)).toEqual(['outline']);
    expect(rows[0]).toMatchObject({
      status: 'failed',
      error: 'draftQuestions: ACCOUNT_BLOCKED: account blocked',
    });
  });
});

// ─── A killed run resumes without duplicates ─────────────────────────────────

describe('S6.4 a run killed in the middle of a step resumes at start-up without duplicates', () => {
  it('upload: killed while draftQuestions is active, the restarted process finishes with the nodes of an uninterrupted run', async () => {
    // Reference: the same text, uninterrupted, by another user.
    const text = uniqueText();
    const refUser = await newUser();
    const ref = await postUpload(refUser, text);
    await orchestrator().whenIdle(ref.body.taskId);
    const reference = await runShape(ref.body.taskId, ref.body.sourceId);
    expect(reference.steps).toBe(UPLOAD_NODES.length);

    // The kill: every draftQuestions call hangs for ever, as if the process died inside the step.
    const owner = await newUser();
    const hang = hangOn(CURATOR_LABELS.draft);
    const res = await postUpload(owner, text);
    expect(res.status).toBe(202);
    await waitForStep(owner, res.body.taskId, 'draftQuestions', 'active');
    const mid = await getTask(owner, res.body.taskId);
    expect(mid).toMatchObject({ status: 'in_progress', lastCompletedStep: 'linkPrerequisites' });
    expect(orchestrator().isRunning(res.body.taskId)).toBe(true);
    hang.mockRestore();

    // The restart: a new process (an empty running set) on the same stores resumes the open task.
    const fresh = restartedOrchestrator();
    expect(fresh.isRunning(res.body.taskId)).toBe(false);
    const callsBefore = app.chat.callCount(CURATOR_LABELS.extract);
    expect(await fresh.resumeOpen()).toBe(1);
    await fresh.whenResumed();

    const task = await getTask(owner, res.body.taskId);
    expect(task).toMatchObject({ status: 'awaiting_review', lastCompletedStep: 'validate' });
    expect(task.steps.map((s: any) => [s.node, s.status])).toEqual(
      UPLOAD_NODES.map((n) => [n, 'complete']),
    );
    // Resumed at the step it was in: nothing before it ran again.
    expect(app.chat.callCount(CURATOR_LABELS.extract)).toBe(callsBefore);
    expect(await runShape(res.body.taskId, res.body.sourceId)).toEqual(reference);

    for (const label of ['Chunk', 'Concept', 'Question', 'Step', 'Puzzle']) {
      const ids = await countIds(label);
      expect(ids.total, `${label} ids are unique`).toBe(ids.distinct);
    }
  });

  it('prompt: killed while the critic is active, the restart goes on from the stored outline with one planner call', async () => {
    const refUser = await newUser();
    const ref = await postPrompt(refUser);
    await orchestrator().whenIdle(ref.body.taskId);
    const reference = await runShape(ref.body.taskId, ref.body.sourceId);
    expect(reference).toMatchObject({ steps: PROMPT_NODES.length, chunks: 0 });

    const owner = await newUser();
    const planner = app.chat.callCount(PROMPT_LABELS.outline);
    const hang = hangOn(PROMPT_LABELS.critique);
    const res = await postPrompt(owner);
    expect(res.status).toBe(202);
    await waitForStep(owner, res.body.taskId, 'critique', 'active');
    expect(await getTask(owner, res.body.taskId)).toMatchObject({
      status: 'in_progress',
      lastCompletedStep: 'draftQuestions',
    });
    hang.mockRestore();

    const fresh = restartedOrchestrator();
    expect(await fresh.resumeOpen()).toBe(1);
    await fresh.whenResumed();

    const task = await getTask(owner, res.body.taskId);
    expect(task).toMatchObject({ status: 'awaiting_review', lastCompletedStep: 'validate' });
    expect(task.steps.map((s: any) => [s.node, s.status])).toEqual(
      PROMPT_NODES.map((n) => [n, 'complete']),
    );
    // One planner call for this task: the restart used the outline stored on the source.
    expect(app.chat.callCount(PROMPT_LABELS.outline)).toBe(planner + 1);
    expect(await runShape(res.body.taskId, res.body.sourceId)).toEqual(reference);
    for (const label of ['Concept', 'Question', 'Step', 'Puzzle']) {
      const ids = await countIds(label);
      expect(ids.total, `${label} ids are unique`).toBe(ids.distinct);
    }
  });

  it('start-up resume through the application service does the same for an open task of this process', async () => {
    const owner = await newUser();
    const hang = hangOn(CURATOR_LABELS.draft);
    const res = await postUpload(owner);
    await waitForStep(owner, res.body.taskId, 'draftQuestions', 'active');
    hang.mockRestore();
    // The running set of this process still holds the hung run, so the service leaves the task to it ...
    await app.app.get(StartupResumeService).onApplicationBootstrap();
    expect(orchestrator().isRunning(res.body.taskId)).toBe(true);
    // ... and a restarted process, which has an empty set, takes it over.
    const fresh = restartedOrchestrator();
    await fresh.resumeOpen();
    await fresh.whenResumed();
    expect((await getTask(owner, res.body.taskId)).status).toBe('awaiting_review');
  });
});
