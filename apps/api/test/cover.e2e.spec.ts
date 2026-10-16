/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are untyped JSON in these tests */
// Spec 005, story US7 (coverage requests), end to end with the stub providers: a `cover` task, written the way the Coach
// writes it (create_cover_task), is picked up by CoverPickupService and fulfilled by the prompt graph. The planner,
// writer, and critic are scripted stub chat answers, and the embeddings stub must never be called.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { conceptId, testing as fixtures } from '@coach/agents/curator';
import { GraphKit } from '@coach/graph-kit';
import { CoverPickupService } from '../src/apps/curator/cover-pickup.service';
import { RunOrchestrator } from '../src/apps/curator/run-orchestrator.service';
import { SettingsService } from '../src/common/settings/settings.service';
import { createTestApp, type TestApp, type TestUser } from './support/test-app';

const { TOPICS, scriptPrompt } = fixtures;
/** The stub planner always plans these two concepts, so the fixture concepts are the cover task's targets. */
const TARGETS = TOPICS.slice(0, 2);
const PROMPT_NODES = ['outline', 'draftQuestions', 'critique', 'refine', 'validate'];

let app: TestApp;
let baseUrl: string;

const settings = () => app.app.get(SettingsService);
const orchestrator = () => app.app.get(RunOrchestrator);
const pickup = () => app.app.get(CoverPickupService);

beforeAll(async () => {
  app = await createTestApp();
  scriptPrompt(app.chat);
  baseUrl = await app.listen();
  await settings().set('monthlyPromptAllowance', 50);
  await settings().set('hourlyCreationLimit', 50);
  for (const topic of TARGETS) {
    await app.testGraph.cypher(
      `MERGE (c:Concept {slug: $slug}) ON CREATE SET c.id = $id, c.name = $name, c.description = $description, c.createdAt = 1`,
      {
        slug: topic.slug,
        id: conceptId(topic.slug),
        name: topic.name,
        description: topic.description,
      },
    );
  }
});
afterAll(async () => {
  await app?.close();
});
afterEach(async () => {
  app.chat.reset();
  scriptPrompt(app.chat);
  await settings().set('monthlyPromptAllowance', 50);
  await settings().set('creationEnabled', true);
});

/** What the Coach does on a coverage gap: a Decision for the learner, then create_cover_task. */
async function requestCover(user: TestUser): Promise<string> {
  const decisionId = randomUUID();
  const taskId = randomUUID();
  await app.testGraph.cypher(
    `MATCH (l:Learner {id: $learner}) CREATE (:Decision {id: $decision, kind: 'recommendation', summary: 's', createdAt: 1, flags: []})-[:FOR]->(l)`,
    { learner: user.id, decision: decisionId },
  );
  await app.app.get(GraphKit).query('create_cover_task', {
    taskId,
    learnerId: user.id,
    decisionId,
    conceptIds: TARGETS.map((t) => conceptId(t.slug)),
    now: Date.now(),
  });
  return taskId;
}

/** One pickup pass, then the run it started. */
async function pickUp(taskId: string): Promise<void> {
  await pickup().runOnce();
  await pickup().whenIdle();
  await orchestrator().whenIdle(taskId);
}

const getTask = async (user: TestUser, taskId: string) =>
  app.http.get(`/tasks/${taskId}`).set(user.auth);
const drafts = async (user: TestUser, taskId: string) =>
  (await app.http.get(`/review/questions?taskId=${taskId}`).set(user.auth)).body as any[];
const promptSources = async (user: TestUser) =>
  app.testGraph.cypher<{ id: string }>(
    `MATCH (:Learner {id: $id})-[:OWNS]->(s:Source {kind: 'prompt'}) RETURN s.id AS id`,
    { id: user.id },
  );

async function readStream(user: TestUser, taskId: string) {
  const res = await fetch(`${baseUrl}/api/tasks/${taskId}/events`, { headers: user.auth });
  const raw = await res.text();
  const frames: Array<{ id: string; event: any }> = [];
  for (const block of raw.split('\n\n')) {
    const id = /^id: (.*)$/m.exec(block)?.[1];
    const data = /^data: (.*)$/m.exec(block)?.[1];
    if (id !== undefined && data !== undefined) frames.push({ id, event: JSON.parse(data) });
  }
  return { status: res.status, frames };
}

describe('S7.1 a queued cover task is fulfilled by the prompt graph', () => {
  let learner: TestUser;
  let taskId: string;

  beforeAll(async () => {
    learner = await app.createUser({ role: 'learner', name: 'Cover Learner' });
    taskId = await requestCover(learner);
    expect((await getTask(learner, taskId)).body).toMatchObject({
      kind: 'cover',
      status: 'queued',
    });
    await pickUp(taskId);
  });

  it('reaches awaiting_review and the stream shows the five prompt steps then the terminal event', async () => {
    const task = await getTask(learner, taskId);
    expect(task.status).toBe(200);
    expect(task.body).toMatchObject({
      kind: 'cover',
      status: 'awaiting_review',
      lastCompletedStep: 'validate',
    });
    expect(task.body.steps.map((s: any) => s.node)).toEqual(PROMPT_NODES);
    expect(task.body.usage.embeddingTokens).toBe(0);

    const stream = await readStream(learner, taskId);
    expect(stream.status).toBe(200);
    const steps = stream.frames.filter((f) => f.event.node !== 'task');
    expect([...new Set(steps.map((f) => f.event.node))]).toEqual(PROMPT_NODES);
    expect(stream.frames.at(-1)!.id).toBe('task:awaiting_review');
  });

  it('wrote a prompt source owned by the learner, linked to the task, with a brief built from the concepts', async () => {
    const sources = await promptSources(learner);
    expect(sources).toHaveLength(1);
    const rows = await app.testGraph.cypher<{ brief: string; linked: number }>(
      `MATCH (s:Source {id: $id})<-[:CONCERNS]-(t:Task {id: $task}) RETURN s.brief AS brief, count(t) AS linked`,
      { id: sources[0]!.id, task: taskId },
    );
    expect(rows).toHaveLength(1);
    const brief = JSON.parse(rows[0]!.brief);
    expect(brief.subject).toBe(
      TARGETS.map((t) => t.name)
        .sort()
        .join(', '),
    );
    expect(brief.difficulty).toBe('medium');
    const detail = await app.http.get(`/sources/${sources[0]!.id}`).set(learner.auth);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ kind: 'prompt', origin: 'prompt' });
  });

  it('left prompt-origin drafts that test the target concepts, owned by the learner', async () => {
    const rows = await app.testGraph.cypher<{
      origin: string;
      owner: string;
      status: string;
      tests: string[];
    }>(
      `MATCH (l:Learner)-[:OWNS]->(p:Puzzle)<-[:PRODUCED]-(:Task {id: $task})
       MATCH (p)-[:CONTAINS]->(q:Question)
       RETURN p.origin AS origin, l.id AS owner, q.status AS status, [(q)-[:TESTS]->(c:Concept) | c.id] AS tests`,
      { task: taskId },
    );
    expect(rows.length).toBeGreaterThanOrEqual(3);
    const targetIds = new Set(TARGETS.map((t) => conceptId(t.slug)));
    for (const row of rows) {
      expect(row).toMatchObject({ origin: 'prompt', owner: learner.id, status: 'draft' });
      expect(row.tests.length).toBeGreaterThan(0);
      for (const id of row.tests) expect(targetIds.has(id)).toBe(true);
    }
    expect(new Set(rows.flatMap((r) => r.tests))).toEqual(targetIds);
  });

  it('lets the learner list and decide the drafts; the allowance records one prompt creation; no embeddings', async () => {
    const list = await drafts(learner, taskId);
    expect(list.length).toBeGreaterThanOrEqual(3);
    expect(list.every((d) => d.origin === 'prompt')).toBe(true);
    const approved = await app.http
      .post(`/review/questions/${list[0].id}/approve`)
      .set(learner.auth);
    expect(approved.status).toBe(200);
    const rejected = await app.http
      .post(`/review/questions/${list[1].id}/reject`)
      .set(learner.auth)
      .send({});
    expect(rejected.status).toBe(200);

    expect(await promptSources(learner)).toHaveLength(1);
    expect(app.embeddings.calls).toHaveLength(0);

    const other = await app.createUser({ role: 'learner', name: 'Not The Requester' });
    expect((await getTask(other, taskId)).status).toBe(404);
  });

  it('is not picked up a second time', async () => {
    await pickUp(taskId);
    expect(await promptSources(learner)).toHaveLength(1);
    expect((await getTask(learner, taskId)).body.steps).toHaveLength(5);
  });
});

describe('S7.2 refused at the allowance', () => {
  it('with no prompt allowance the task fails with CREATION_LIMIT_REACHED, and a retry after the allowance returns completes it', async () => {
    const learner = await app.createUser({ role: 'learner' });
    await settings().set('monthlyPromptAllowance', 0);
    const taskId = await requestCover(learner);
    await pickUp(taskId);

    const failed = await getTask(learner, taskId);
    expect(failed.body.status).toBe('failed');
    expect(failed.body.error).toContain('CREATION_LIMIT_REACHED');
    expect(await promptSources(learner)).toEqual([]);

    await settings().set('monthlyPromptAllowance', 50);
    const retry = await app.http.post(`/tasks/${taskId}/retry`).set(learner.auth);
    expect(retry.status).toBe(202);
    await pickup().whenIdle();
    await orchestrator().whenIdle(taskId);

    const done = await getTask(learner, taskId);
    expect(done.body).toMatchObject({ status: 'awaiting_review' });
    expect(done.body.error).toBeUndefined();
    expect(await promptSources(learner)).toHaveLength(1);
  });

  it('with creation paused the task fails with CREATION_PAUSED, a retry while paused is 503, and a retry after completes it', async () => {
    const learner = await app.createUser({ role: 'learner' });
    await settings().set('creationEnabled', false);
    const taskId = await requestCover(learner);
    await pickUp(taskId);

    const failed = await getTask(learner, taskId);
    expect(failed.body.status).toBe('failed');
    expect(failed.body.error).toContain('CREATION_PAUSED');
    expect(await promptSources(learner)).toEqual([]);

    const paused = await app.http.post(`/tasks/${taskId}/retry`).set(learner.auth);
    expect(paused.status).toBe(503);
    expect(paused.body.error.code).toBe('CREATION_PAUSED');

    await settings().set('creationEnabled', true);
    expect((await app.http.post(`/tasks/${taskId}/retry`).set(learner.auth)).status).toBe(202);
    await pickup().whenIdle();
    await orchestrator().whenIdle(taskId);
    expect((await getTask(learner, taskId)).body.status).toBe('awaiting_review');
  });

  it("a blocked requester's task fails with ACCOUNT_BLOCKED and creates no source", async () => {
    const learner = await app.createUser({ role: 'learner' });
    const taskId = await requestCover(learner);
    await app.setStatus(learner.id, 'blocked');
    await pickUp(taskId);
    const rows = await app.testGraph.cypher<{ status: string; error: string }>(
      `MATCH (t:Task {id: $id}) RETURN t.status AS status, t.error AS error`,
      { id: taskId },
    );
    expect(rows[0]!.status).toBe('failed');
    expect(rows[0]!.error).toContain('ACCOUNT_BLOCKED');
    expect(await promptSources(learner)).toEqual([]);
  });
});

describe('S7.3 too few drafts survive', () => {
  it('ends done with nothing_usable and the embeddings stub stays unused', async () => {
    const learner = await app.createUser({ role: 'learner' });
    const reject = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i, 'reject' as const]));
    app.chat.reset();
    // Short of the requested count, the run tops up once; the writer has nothing more, which ends the loop.
    scriptPrompt(app.chat, {
      firstVerdicts: reject,
      secondVerdicts: reject,
      topUp: () => ({ drafts: [] }),
    });
    const taskId = await requestCover(learner);
    await pickUp(taskId);

    const task = await getTask(learner, taskId);
    expect(task.body).toMatchObject({ kind: 'cover', status: 'done', result: 'nothing_usable' });
    expect(await drafts(learner, taskId)).toEqual([]);
    expect(app.embeddings.calls).toHaveLength(0);
  });
});
