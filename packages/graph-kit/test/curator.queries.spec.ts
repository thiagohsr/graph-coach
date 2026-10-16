import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { QueryParams } from '../src';
import { createTestGraph, type TestGraph } from '../src/testing';
import {
  FP1,
  IDS,
  SOURCE_TEXT,
  VECTORS,
  addTaskFor,
  buildCuratorFixture,
  vec,
  type Run,
} from './curator.fixture';

const { A, B, R, M } = IDS;
const NOW = 1_760_000_000_000;
const ZERO = { modelCalls: 0, inputTokens: 0, outputTokens: 0, embeddingTokens: 0 };

let tg: TestGraph;
const run: Run = (text, params) => tg.cypher(text, params as QueryParams);
const q = <T = Record<string, unknown>>(name: string, params: Record<string, unknown>) =>
  tg.graph.query<T>(name, params as QueryParams);

async function signature(): Promise<string> {
  const [nodes] = await tg.cypher<{ n: number }>('MATCH (n) RETURN count(n) AS n');
  const [edges] = await tg.cypher<{ n: number }>('MATCH ()-[r]->() RETURN count(r) AS n');
  return `${nodes!.n}/${edges!.n}`;
}

beforeAll(async () => {
  tg = await createTestGraph();
});
afterAll(async () => {
  await tg?.dispose();
});
beforeEach(async () => {
  await tg.clear();
  await buildCuratorFixture(run);
});

// ─── Tasks and steps ─────────────────────────────────────────────────────────

describe('create_task', () => {
  const params = { id: 'task-1', kind: 'ingest', requesterId: A, sourceId: 'S1', now: NOW };

  it('creates a queued task with its requester, assignee, and source, and zero usage', async () => {
    const rows = await q('create_task', params);
    expect(rows).toEqual([{ taskId: 'task-1', status: 'queued' }]);
    const [task] = await tg.cypher<{ p: Record<string, unknown> }>(
      `MATCH (t:Task {id: 'task-1'}) RETURN properties(t) AS p`,
    );
    expect(task!.p).toMatchObject({
      kind: 'ingest',
      status: 'queued',
      createdAt: NOW,
      updatedAt: NOW,
      ...ZERO,
    });
    expect(await tg.countEdges('REQUESTED')).toBe(1);
    expect(await tg.countEdges('ASSIGNED_TO')).toBe(1);
    expect(await tg.countEdges('CONCERNS')).toBe(1);
  });

  it('twice changes nothing', async () => {
    await q('create_task', params);
    const before = await signature();
    await q('create_task', { ...params, now: NOW + 1000 });
    expect(await signature()).toBe(before);
    const [task] = await tg.cypher<{ createdAt: number }>(
      `MATCH (t:Task {id: 'task-1'}) RETURN t.createdAt AS createdAt`,
    );
    expect(task!.createdAt).toBe(NOW);
  });

  it('works on a graph that has no Curator agent yet, and does not add a second one later', async () => {
    await tg.cypher('MATCH (a:Agent) DELETE a');
    await q('create_task', params);
    await q('create_task', { ...params, id: 'task-2' });
    const [agents] = await tg.cypher<{ n: number }>(
      `MATCH (a:Agent {name: 'Curator'}) RETURN count(a) AS n`,
    );
    expect(agents!.n).toBe(1);
  });

  it('returns no row when the requester or the source does not exist', async () => {
    expect(await q('create_task', { ...params, requesterId: 'nobody' })).toEqual([]);
    expect(await q('create_task', { ...params, sourceId: 'nothing' })).toEqual([]);
    expect(await tg.count('Task')).toBe(0);
  });
});

describe('update_task', () => {
  beforeEach(async () => {
    await q('create_task', {
      id: 'task-1',
      kind: 'ingest',
      requesterId: A,
      sourceId: 'S1',
      now: NOW,
    });
  });

  it('applies the patch when the status is one of the expected ones', async () => {
    const rows = await q('update_task', {
      id: 'task-1',
      expectedStatuses: ['queued', 'in_progress'],
      patch: { status: 'in_progress' },
      now: NOW + 5,
    });
    expect(rows).toEqual([
      {
        taskId: 'task-1',
        status: 'in_progress',
        result: null,
        error: null,
        lastCompletedStep: null,
      },
    ]);
    const [t] = await tg.cypher<{ updatedAt: number }>(
      `MATCH (t:Task {id: 'task-1'}) RETURN t.updatedAt AS updatedAt`,
    );
    expect(t!.updatedAt).toBe(NOW + 5);
  });

  it('returns no row and changes nothing when the status does not match', async () => {
    const rows = await q('update_task', {
      id: 'task-1',
      expectedStatuses: ['failed'],
      patch: { status: 'in_progress' },
      now: NOW + 5,
    });
    expect(rows).toEqual([]);
    const [t] = await tg.cypher<{ status: string; updatedAt: number }>(
      `MATCH (t:Task {id: 'task-1'}) RETURN t.status AS status, t.updatedAt AS updatedAt`,
    );
    expect(t).toEqual({ status: 'queued', updatedAt: NOW });
  });

  it('sets result, error and lastCompletedStep, and a null clears error', async () => {
    await q('update_task', {
      id: 'task-1',
      expectedStatuses: ['queued'],
      patch: {
        status: 'failed',
        error: 'embed: PROVIDER_UNAVAILABLE: down',
        lastCompletedStep: 'chunk',
      },
      now: NOW + 1,
    });
    const [failed] = await q<{ error: string; lastCompletedStep: string }>('get_task', {
      id: 'task-1',
      userId: A,
    });
    expect(failed).toMatchObject({
      status: 'failed',
      error: 'embed: PROVIDER_UNAVAILABLE: down',
      lastCompletedStep: 'chunk',
    });
    const rows = await q('update_task', {
      id: 'task-1',
      expectedStatuses: ['failed'],
      patch: { status: 'in_progress', error: null },
      now: NOW + 2,
    });
    expect(rows).toMatchObject([
      { status: 'in_progress', error: null, lastCompletedStep: 'chunk' },
    ]);
    const [props] = await tg.cypher<{ p: Record<string, unknown> }>(
      `MATCH (t:Task {id: 'task-1'}) RETURN properties(t) AS p`,
    );
    expect('error' in props!.p).toBe(false);
  });
});

describe('get_task', () => {
  beforeEach(async () => {
    await addTaskFor(run);
  });

  it('returns the task with its source, produced counts, and zero usage to the requester', async () => {
    await tg.cypher(`MATCH (t:Task {id: 'task-1'}), (c:Concept) CREATE (t)-[:PRODUCED]->(c)`);
    await tg.cypher(
      `MATCH (t:Task {id: 'task-1'})
       CREATE (t)-[:PRODUCED]->(:Question {id: 'qa', status: 'draft'}), (t)-[:PRODUCED]->(:Question {id: 'qb', status: 'draft'})`,
    );
    const rows = await q('get_task', { id: 'task-1', userId: A });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'task-1',
      kind: 'ingest',
      status: 'queued',
      result: null,
      error: null,
      lastCompletedStep: null,
      createdAt: 1000,
      requesterId: A,
      sourceId: 'S1',
      puzzleId: null,
      concepts: 3,
      questions: 2,
      ...ZERO,
    });
  });

  it('returns no row to another learner, a reviewer, or an admin', async () => {
    for (const userId of [B, R, M, 'nobody'])
      expect(await q('get_task', { id: 'task-1', userId })).toEqual([]);
  });

  it('returns no row for an unknown task', async () => {
    expect(await q('get_task', { id: 'nope', userId: A })).toEqual([]);
  });

  it('refuses a missing $userId before anything is sent, and a null one matches nobody', async () => {
    await expect(q('get_task', { id: 'task-1' })).rejects.toMatchObject({ code: 'MISSING_PARAM' });
    expect(await q('get_task', { id: 'task-1', userId: null })).toEqual([]);
  });

  it('serves a cover task to the learner its decision is FOR', async () => {
    await tg.cypher(
      `MATCH (t:Task {id: 'task-1'}) DETACH DELETE t
       WITH 1 AS x
       MATCH (b:Learner {id: $B}), (a:Agent)
       CREATE (t2:Task {id: 'cover-1', kind: 'cover', status: 'queued', createdAt: 1, updatedAt: 1})
       CREATE (d:Decision {id: 'd1'})-[:REQUESTED]->(t2), (d)-[:FOR]->(b)`,
      { B },
    );
    expect(await q('get_task', { id: 'cover-1', userId: B })).toHaveLength(1);
    expect(await q('get_task', { id: 'cover-1', userId: A })).toEqual([]);
  });
});

describe('add_step', () => {
  const base = (over: Record<string, unknown> = {}) => ({
    taskId: 'task-1',
    id: 'step-1',
    node: 'chunk',
    status: 'active',
    log: '',
    order: 1,
    startedAt: NOW,
    finishedAt: null,
    usage: ZERO,
    ...over,
  });

  beforeEach(async () => {
    await addTaskFor(run);
  });

  it('creates a step linked to the task and returns zero totals', async () => {
    const rows = await q('add_step', base());
    expect(rows).toEqual([{ stepId: 'step-1', status: 'active', ...ZERO }]);
    expect(await tg.count('Step')).toBe(1);
    const [edge] = await tg.cypher<{ order: number }>(
      `MATCH (:Task {id: 'task-1'})-[r:HAS_STEP]->(:Step {id: 'step-1'}) RETURN r.order AS order`,
    );
    expect(edge!.order).toBe(1);
  });

  it('updates the same step in place, keeps order and startedAt, and stores the usage on the step', async () => {
    await q('add_step', base());
    const usage = { modelCalls: 2, inputTokens: 30, outputTokens: 12, embeddingTokens: 5 };
    const rows = await q(
      'add_step',
      base({
        status: 'complete',
        log: '3 chunks',
        order: 9,
        startedAt: NOW + 99,
        finishedAt: NOW + 10,
        usage,
      }),
    );
    expect(rows).toEqual([{ stepId: 'step-1', status: 'complete', ...usage }]);
    expect(await tg.count('Step')).toBe(1);
    const [step] = await tg.cypher<Record<string, unknown>>(
      `MATCH (:Task)-[r:HAS_STEP]->(s:Step {id: 'step-1'}) RETURN s.status AS status, s.log AS log, s.startedAt AS startedAt, s.finishedAt AS finishedAt,
              s.modelCalls AS modelCalls, s.inputTokens AS inputTokens, s.outputTokens AS outputTokens, s.embeddingTokens AS embeddingTokens, r.order AS order`,
    );
    expect(step).toMatchObject({
      status: 'complete',
      log: '3 chunks',
      startedAt: NOW,
      finishedAt: NOW + 10,
      order: 1,
      ...usage,
    });
  });

  it('keeps the task totals equal to the sum over its steps', async () => {
    await q(
      'add_step',
      base({
        id: 's1',
        node: 'chunk',
        order: 1,
        status: 'complete',
        usage: { ...ZERO, modelCalls: 1, inputTokens: 10 },
      }),
    );
    await q(
      'add_step',
      base({
        id: 's2',
        node: 'embed',
        order: 2,
        status: 'complete',
        usage: { ...ZERO, modelCalls: 1, embeddingTokens: 7 },
      }),
    );
    const rows = await q(
      'add_step',
      base({
        id: 's3',
        node: 'extractConcepts',
        order: 3,
        status: 'complete',
        usage: { modelCalls: 4, inputTokens: 40, outputTokens: 8, embeddingTokens: 0 },
      }),
    );
    expect(rows[0]).toMatchObject({
      modelCalls: 6,
      inputTokens: 50,
      outputTokens: 8,
      embeddingTokens: 7,
    });
    const [task] = await q('get_task', { id: 'task-1', userId: A });
    expect(task).toMatchObject({
      modelCalls: 6,
      inputTokens: 50,
      outputTokens: 8,
      embeddingTokens: 7,
    });
  });

  it('writing the same step twice leaves the totals unchanged', async () => {
    const usage = { modelCalls: 2, inputTokens: 20, outputTokens: 4, embeddingTokens: 1 };
    const first = await q('add_step', base({ status: 'complete', usage }));
    const second = await q('add_step', base({ status: 'complete', usage }));
    expect(second).toEqual(first);
    expect(await tg.count('Step')).toBe(1);
  });

  it("replacing a step's numbers changes the totals by the difference", async () => {
    await q(
      'add_step',
      base({ id: 's1', status: 'complete', usage: { ...ZERO, modelCalls: 3, inputTokens: 30 } }),
    );
    await q(
      'add_step',
      base({
        id: 's2',
        node: 'embed',
        order: 2,
        status: 'complete',
        usage: { ...ZERO, modelCalls: 1, inputTokens: 5 },
      }),
    );
    const rows = await q(
      'add_step',
      base({ id: 's1', status: 'complete', usage: { ...ZERO, modelCalls: 2, inputTokens: 18 } }),
    );
    expect(rows[0]).toMatchObject({ modelCalls: 3, inputTokens: 23 });
  });

  it('adds a second attempt of the same node to the totals', async () => {
    await q(
      'add_step',
      base({ id: 'a1', status: 'error', usage: { ...ZERO, modelCalls: 3, inputTokens: 30 } }),
    );
    const rows = await q(
      'add_step',
      base({
        id: 'a2',
        order: 2,
        status: 'complete',
        usage: { ...ZERO, modelCalls: 1, inputTokens: 10 },
      }),
    );
    expect(rows[0]).toMatchObject({ modelCalls: 4, inputTokens: 40 });
    expect(await tg.count('Step')).toBe(2);
  });

  it('copies the provider and model the run resolved to from the task onto each step', async () => {
    await q('add_step', base());
    await q('update_task', {
      id: 'task-1',
      expectedStatuses: ['queued', 'in_progress'],
      patch: { llmProvider: 'openrouter', llmModel: 'openai/gpt-4o-mini' },
      now: NOW + 1,
    });
    await q('add_step', base({ id: 'step-2', node: 'embed', order: 2 }));
    const rows = await tg.cypher<{ id: string; p: string | null; m: string | null }>(
      `MATCH (s:Step) RETURN s.id AS id, s.llmProvider AS p, s.llmModel AS m ORDER BY id`,
    );
    expect(rows).toEqual([
      { id: 'step-1', p: null, m: null },
      { id: 'step-2', p: 'openrouter', m: 'openai/gpt-4o-mini' },
    ]);
  });

  it('returns no row for an unknown task and creates nothing', async () => {
    expect(await q('add_step', base({ taskId: 'nope' }))).toEqual([]);
    expect(await tg.count('Step')).toBe(0);
  });
});

describe('task_steps', () => {
  beforeEach(async () => {
    await addTaskFor(run);
    const usage = { ...ZERO, modelCalls: 1, inputTokens: 4 };
    // Written out of order on purpose.
    await q('add_step', {
      taskId: 'task-1',
      id: 's2',
      node: 'embed',
      status: 'complete',
      log: 'two',
      order: 2,
      startedAt: 20,
      finishedAt: 25,
      usage,
    });
    await q('add_step', {
      taskId: 'task-1',
      id: 's1',
      node: 'chunk',
      status: 'complete',
      log: 'one',
      order: 1,
      startedAt: 10,
      finishedAt: 15,
      usage: ZERO,
    });
  });

  it('returns the steps in order with their usage to the requester', async () => {
    const rows = await q<Record<string, unknown>>('task_steps', { taskId: 'task-1', userId: A });
    expect(rows.map((r) => [r.stepId, r.node, r.order, r.log])).toEqual([
      ['s1', 'chunk', 1, 'one'],
      ['s2', 'embed', 2, 'two'],
    ]);
    expect(rows[1]).toMatchObject({
      modelCalls: 1,
      inputTokens: 4,
      outputTokens: 0,
      embeddingTokens: 0,
      startedAt: 20,
      finishedAt: 25,
      status: 'complete',
    });
  });

  it('returns nothing to anyone else, whatever their role', async () => {
    for (const userId of [B, R, M])
      expect(await q('task_steps', { taskId: 'task-1', userId })).toEqual([]);
    await expect(q('task_steps', { taskId: 'task-1' })).rejects.toMatchObject({
      code: 'MISSING_PARAM',
    });
  });
});

describe('load_task', () => {
  beforeEach(async () => {
    await addTaskFor(run);
  });

  it('returns the task columns and the ordered steps, with no access parameter', async () => {
    await q('add_step', {
      taskId: 'task-1',
      id: 's2',
      node: 'embed',
      status: 'active',
      log: '',
      order: 2,
      startedAt: 20,
      finishedAt: null,
      usage: ZERO,
    });
    await q('add_step', {
      taskId: 'task-1',
      id: 's1',
      node: 'chunk',
      status: 'complete',
      log: '3 chunks',
      order: 1,
      startedAt: 10,
      finishedAt: 15,
      usage: ZERO,
    });
    const [row] = await q<Record<string, unknown>>('load_task', { id: 'task-1' });
    expect(row).toMatchObject({
      id: 'task-1',
      kind: 'ingest',
      status: 'queued',
      requesterId: A,
      sourceId: 'S1',
      concepts: 0,
      questions: 0,
    });
    const steps = row!.steps as Array<Record<string, unknown>>;
    expect(steps.map((s) => [s.stepId, s.node, s.order, s.status])).toEqual([
      ['s1', 'chunk', 1, 'complete'],
      ['s2', 'embed', 2, 'active'],
    ]);
    expect(steps[1]!.finishedAt).toBeNull();
  });

  it('gives one map of nulls for a task with no step (the caller drops it) and no row for an unknown task', async () => {
    const [row] = await q<{ steps: Array<Record<string, unknown>> }>('load_task', { id: 'task-1' });
    expect(row!.steps).toHaveLength(1);
    expect(Object.values(row!.steps[0]!).every((v) => v === null)).toBe(true);
    expect(await q('load_task', { id: 'nope' })).toEqual([]);
  });
});

describe('open_tasks', () => {
  it('filters by status and kind and orders by creation time', async () => {
    await addTaskFor(run, IDS, 'task-old', 'S1');
    await addTaskFor(run, IDS, 'task-new', 'S2', B);
    await tg.cypher(
      `MATCH (t:Task {id: 'task-new'}) SET t.createdAt = 5000, t.status = 'in_progress'`,
    );
    await tg.cypher(`MATCH (t:Task {id: 'task-old'}) SET t.kind = 'generate'`);
    const all = await q<{ id: string; requesterId: string }>('open_tasks', {
      statuses: ['queued', 'in_progress'],
      kinds: ['ingest', 'generate'],
    });
    expect(all.map((r) => r.id)).toEqual(['task-old', 'task-new']);
    expect(all[1]!.requesterId).toBe(B);
    expect(
      (await q('open_tasks', { statuses: ['queued'], kinds: ['ingest', 'generate'] })).map(
        (r) => (r as { id: string }).id,
      ),
    ).toEqual(['task-old']);
    expect(
      (await q('open_tasks', { statuses: ['queued', 'in_progress'], kinds: ['ingest'] })).map(
        (r) => (r as { id: string }).id,
      ),
    ).toEqual(['task-new']);
    expect(await q('open_tasks', { statuses: ['done'], kinds: ['ingest'] })).toEqual([]);
  });
});

// ─── Sources, chunks, vectors ────────────────────────────────────────────────

describe('source_by_fingerprint', () => {
  it('matches the owner with task id and status', async () => {
    await addTaskFor(run);
    const rows = await q('source_by_fingerprint', { ownerId: A, fingerprint: FP1 });
    expect(rows).toEqual([{ sourceId: 'S1', taskId: 'task-1', taskStatus: 'queued' }]);
  });

  it('has no row for another owner with the same fingerprint', async () => {
    expect(await q('source_by_fingerprint', { ownerId: B, fingerprint: FP1 })).toEqual([]);
  });

  it('returns taskId null for a source without a task', async () => {
    expect(await q('source_by_fingerprint', { ownerId: A, fingerprint: FP1 })).toEqual([
      { sourceId: 'S1', taskId: null, taskStatus: null },
    ]);
  });

  it('has no row for an unknown fingerprint', async () => {
    expect(await q('source_by_fingerprint', { ownerId: A, fingerprint: 'nope' })).toEqual([]);
  });
});

describe('create_source', () => {
  const params = {
    id: 'S9',
    ownerId: A,
    title: 'New notes',
    kind: 'markdown',
    fingerprint: 'a'.repeat(64),
    content: 'Some text.',
    brief: null,
    now: NOW,
  };

  it('creates the source with content, createdAt, kind and OWNS', async () => {
    expect(await q('create_source', params)).toEqual([{ sourceId: 'S9' }]);
    const [s] = await tg.cypher<{ p: Record<string, unknown> }>(
      `MATCH (:Learner {id: $A})-[:OWNS]->(s:Source {id: 'S9'}) RETURN properties(s) AS p`,
      { A },
    );
    expect(s!.p).toEqual({
      id: 'S9',
      title: 'New notes',
      kind: 'markdown',
      fingerprint: 'a'.repeat(64),
      content: 'Some text.',
      createdAt: NOW,
    });
  });

  it('a second call with a later time changes nothing, createdAt included', async () => {
    await q('create_source', params);
    const before = await signature();
    await q('create_source', { ...params, title: 'Other title', now: NOW + 99_999 });
    expect(await signature()).toBe(before);
    const [s] = await tg.cypher<{ createdAt: number; title: string }>(
      `MATCH (s:Source {id: 'S9'}) RETURN s.createdAt AS createdAt, s.title AS title`,
    );
    expect(s).toEqual({ createdAt: NOW, title: 'New notes' });
  });

  it('writes no property for a null parameter (a prompt source)', async () => {
    await q('create_source', {
      ...params,
      id: 'S10',
      kind: 'prompt',
      fingerprint: null,
      content: null,
      brief: '{"subject":"SQL"}',
    });
    const [s] = await tg.cypher<{ p: Record<string, unknown> }>(
      `MATCH (s:Source {id: 'S10'}) RETURN properties(s) AS p`,
    );
    expect(s!.p).toMatchObject({ kind: 'prompt', brief: '{"subject":"SQL"}' });
    expect('content' in s!.p).toBe(false);
    expect('fingerprint' in s!.p).toBe(false);
  });

  it('returns no row for an unknown owner', async () => {
    expect(await q('create_source', { ...params, ownerId: 'nobody' })).toEqual([]);
    expect(await tg.count('Source')).toBe(2);
  });
});

describe('list_sources', () => {
  it('shows the owner their own sources, newest first, with access, owner name, counts, and no content', async () => {
    await addTaskFor(run);
    const rows = await q<Record<string, unknown>>('list_sources', { userId: A });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      id: 'S1',
      title: 'Ann notes',
      kind: 'text',
      createdAt: 1000,
      access: 'owner',
      ownerName: 'Ann',
      chunkCount: 3,
      conceptCount: 3,
      puzzleId: null,
      taskId: 'task-1',
      taskStatus: 'queued',
    });
    expect(Object.keys(rows[0]!)).not.toContain('content');
    expect(JSON.stringify(rows)).not.toContain(SOURCE_TEXT);
  });

  it('orders newest first', async () => {
    await tg.cypher(
      `MATCH (a:Learner {id: $A}) CREATE (a)-[:OWNS]->(:Source {id: 'S3', title: 'Newer', kind: 'text', createdAt: 5000})`,
      { A },
    );
    expect((await q<{ id: string }>('list_sources', { userId: A })).map((r) => r.id)).toEqual([
      'S3',
      'S1',
    ]);
  });

  it('shows another learner, a reviewer, and an admin none of it', async () => {
    expect((await q<{ id: string }>('list_sources', { userId: B })).map((r) => r.id)).toEqual([
      'S2',
    ]);
    expect(await q('list_sources', { userId: R })).toEqual([]);
    expect(await q('list_sources', { userId: M })).toEqual([]);
  });

  it('lists a source given through a share with the source, without task fields, and not one shared without it', async () => {
    await addTaskFor(run);
    await tg.cypher(
      `MATCH (s:Source {id: 'S1'}), (b:Learner {id: $B})
       CREATE (s)-[:YIELDED]->(p:Puzzle {id: 'P1', status: 'published', visibility: 'private'})
       CREATE (p)-[:SHARED_WITH {withSource: false, at: 1}]->(b)`,
      { B },
    );
    expect((await q<{ id: string }>('list_sources', { userId: B })).map((r) => r.id)).toEqual([
      'S2',
    ]);
    await tg.cypher(
      `MATCH (:Puzzle {id: 'P1'})-[sh:SHARED_WITH]->(:Learner {id: $B}) SET sh.withSource = true`,
      { B },
    );
    const rows = await q<Record<string, unknown>>('list_sources', { userId: B });
    expect(rows.map((r) => r.id)).toEqual(['S2', 'S1']);
    expect(rows.find((r) => r.id === 'S1')).toMatchObject({
      access: 'shared',
      ownerName: 'Ann',
      taskId: null,
      taskStatus: null,
      puzzleId: 'P1',
    });
    // A reviewer and an admin get nothing from someone else's share.
    expect(await q('list_sources', { userId: R })).toEqual([]);
  });
});

describe('add_chunks', () => {
  const rows = (embedding: boolean) => [
    {
      id: 'n-0',
      position: 0,
      text: 'First.',
      prevId: null,
      embedding: embedding ? vec(1, 0, 0) : null,
    },
    {
      id: 'n-1',
      position: 1,
      text: 'Second.',
      prevId: 'n-0',
      embedding: embedding ? vec(0, 1, 0) : null,
    },
    {
      id: 'n-2',
      position: 2,
      text: 'Third.',
      prevId: 'n-1',
      embedding: embedding ? vec(0, 0, 1) : null,
    },
  ];

  it('records the embedding model next to the vector', async () => {
    const withModel = rows(true).map((r) => ({ ...r, embeddingModel: 'qwen/qwen3-embedding-8b' }));
    await q('add_chunks', { sourceId: 'S2', chunks: withModel });
    const stored = await tg.cypher<{ m: string | null }>(
      `MATCH (c:Chunk) WHERE c.id STARTS WITH 'n-' RETURN DISTINCT c.embeddingModel AS m`,
    );
    expect(stored).toEqual([{ m: 'qwen/qwen3-embedding-8b' }]);
  });

  it('writes chunks with HAS_CHUNK and an ordered NEXT chain, without vectors', async () => {
    expect(await q('add_chunks', { sourceId: 'S2', chunks: rows(false) })).toEqual([
      { written: 3 },
    ]);
    const chain = await tg.cypher<{ a: string; b: string }>(
      `MATCH (a:Chunk)-[:NEXT]->(b:Chunk) WHERE a.id STARTS WITH 'n-' RETURN a.id AS a, b.id AS b ORDER BY a`,
    );
    expect(chain).toEqual([
      { a: 'n-0', b: 'n-1' },
      { a: 'n-1', b: 'n-2' },
    ]);
    const [has] = await tg.cypher<{ n: number }>(
      `MATCH (:Source {id: 'S2'})-[:HAS_CHUNK]->(c:Chunk) WHERE c.id STARTS WITH 'n-' RETURN count(c) AS n`,
    );
    expect(has!.n).toBe(3);
    const [vectors] = await tg.cypher<{ n: number }>(
      `MATCH (c:Chunk) WHERE c.id STARTS WITH 'n-' AND c.embedding IS NOT NULL RETURN count(c) AS n`,
    );
    expect(vectors!.n).toBe(0);
  });

  it('a second call with embeddings updates in place and the chunks are found by vector search', async () => {
    await q('add_chunks', { sourceId: 'S2', chunks: rows(false) });
    const before = await signature();
    expect(await q('add_chunks', { sourceId: 'S2', chunks: rows(true) })).toEqual([{ written: 3 }]);
    expect(await signature()).toBe(before);
    const hits = await tg.cypher<{ id: string }>(
      `CALL db.idx.vector.queryNodes('Chunk', 'embedding', 1, vecf32($v)) YIELD node RETURN node.id AS id`,
      { v: vec(0, 1, 0) },
    );
    // ch-2 has the same vector as n-1; either is a correct nearest neighbour.
    expect(['n-1', 'ch-2']).toContain(hits[0]!.id);
  });

  it('keeps a stored vector when a later call sends null', async () => {
    await q('add_chunks', { sourceId: 'S2', chunks: rows(true) });
    await q('add_chunks', { sourceId: 'S2', chunks: rows(false) });
    const [r] = await tg.cypher<{ n: number }>(
      `MATCH (c:Chunk) WHERE c.id STARTS WITH 'n-' AND c.embedding IS NOT NULL RETURN count(c) AS n`,
    );
    expect(r!.n).toBe(3);
  });
});

describe('source_chunks', () => {
  it('returns the source text, the chunks in order, whether each has a vector, and the concepts per chunk', async () => {
    const rows = await q<Record<string, unknown>>('source_chunks', { sourceId: 'S1' });
    expect(rows.map((r) => [r.id, r.position, r.hasEmbedding])).toEqual([
      ['ch-1', 0, true],
      ['ch-2', 1, true],
      ['ch-3', 2, true],
    ]);
    expect(rows[0]).toMatchObject({
      sourceTitle: 'Ann notes',
      sourceKind: 'text',
      sourceContent: SOURCE_TEXT,
      sourceBrief: null,
      sourceOutline: null,
    });
    const concepts = rows.map((r) => (r.concepts as Array<{ slug: string }>).map((c) => c.slug));
    expect(concepts).toEqual([['index'], ['b-tree'], ['sql']]);
  });

  it('gives a map of nulls for a chunk without a concept, and flags a missing vector', async () => {
    await q('add_chunks', {
      sourceId: 'S1',
      chunks: [{ id: 'ch-4', position: 3, text: 'Tail.', prevId: 'ch-3', embedding: null }],
    });
    const rows = await q<{
      id: string;
      hasEmbedding: boolean;
      concepts: Array<Record<string, unknown>>;
    }>('source_chunks', { sourceId: 'S1' });
    const last = rows[3]!;
    expect(last).toMatchObject({ id: 'ch-4', hasEmbedding: false });
    expect(Object.values(last.concepts[0]!).every((v) => v === null)).toBe(true);
  });

  it('returns one row with null chunk columns for a source without chunks, and nothing for an unknown source', async () => {
    await tg.cypher(
      `MATCH (a:Learner {id: $A}) CREATE (a)-[:OWNS]->(:Source {id: 'S5', title: 'Prompt', kind: 'prompt', brief: '{"subject":"SQL"}'})`,
      { A },
    );
    const rows = await q<Record<string, unknown>>('source_chunks', { sourceId: 'S5' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: null,
      position: null,
      sourceKind: 'prompt',
      sourceBrief: '{"subject":"SQL"}',
      sourceContent: null,
    });
    expect(await q('source_chunks', { sourceId: 'nope' })).toEqual([]);
  });
});

describe('chunk_embeddings', () => {
  it("returns the stored vectors of a source's chunks in chunk order, as plain number arrays", async () => {
    const rows = await q<{ id: string; embedding: number[] }>('chunk_embeddings', {
      sourceId: 'S1',
    });
    expect(rows.map((r) => r.id)).toEqual(['ch-1', 'ch-2', 'ch-3']);
    expect(rows[0]!.embedding).toHaveLength(64);
    expect(rows[0]!.embedding[0]).toBeCloseTo(1);
    expect(rows[1]!.embedding[1]).toBeCloseTo(1);
  });

  it('leaves out chunks that have no vector, and returns nothing for an unknown source', async () => {
    await q('add_chunks', {
      sourceId: 'S1',
      chunks: [{ id: 'ch-4', position: 3, text: 'Tail.', prevId: 'ch-3', embedding: null }],
    });
    expect(
      (await q<{ id: string }>('chunk_embeddings', { sourceId: 'S1' })).map((r) => r.id),
    ).toEqual(['ch-1', 'ch-2', 'ch-3']);
    expect(await q('chunk_embeddings', { sourceId: 'nope' })).toEqual([]);
  });
});

describe('concept_neighbourhood', () => {
  const near = (v: number[], over: Record<string, unknown> = {}) =>
    q<Record<string, unknown>>('concept_neighbourhood', {
      embedding: v,
      fetchK: 8,
      maxDistance: 0.35,
      ...over,
    });

  it("returns the concepts mentioned by near chunks of any source, including another learner's private one", async () => {
    // ch-1 (index, Ann) and ch-b1 (sql, Bea's private source) are both near this vector.
    const rows = await near(vec(1, 0.05, 0));
    expect(rows.map((r) => r.slug).sort()).toEqual(['index', 'sql']);
  });

  it('respects maxDistance', async () => {
    expect((await near(vec(1, 0, 0), { maxDistance: 0.001 })).map((r) => r.slug)).toEqual([
      'index',
    ]);
    expect(await near(vec(0, 0, 0, 1))).toEqual([]);
  });

  it('with known stub embeddings the nearest concept comes first and a smaller maxDistance keeps only closer ones', async () => {
    // Query vec(1, 0, 0) equals ch-1's vector (index); every other chunk is farther. Lower distance = closer.
    const rows = await near(vec(1, 0, 0), { maxDistance: 2 });
    expect(rows[0]!.slug).toBe('index');
    const distances = rows.map((r) => r.bestDistance as number);
    expect(distances[0]!).toBeLessThan(distances[distances.length - 1]!);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
    // A threshold between the nearest and the farthest keeps the nearest and drops the farthest.
    const cut = (distances[0]! + distances[distances.length - 1]!) / 2;
    const kept = (await near(vec(1, 0, 0), { maxDistance: cut })).map((r) => r.slug);
    expect(kept).toContain('index');
    expect(kept.length).toBeLessThan(rows.length);
  });

  it('counts hits and returns the best distance, nearest first', async () => {
    const rows = await near(vec(1, 0, 0), { maxDistance: 2 });
    expect(rows[0]).toMatchObject({ slug: 'index', hits: 1 });
    expect(rows[0]!.bestDistance as number).toBeLessThan(0.01);
    const sql = rows.find((r) => r.slug === 'sql')!;
    expect(sql.hits).toBe(2); // ch-3 and ch-b1
    const distances = rows.map((r) => r.bestDistance as number);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
  });

  it('returns exactly the concept columns and never a chunk id, chunk text, or source id', async () => {
    const rows = await near(vec(1, 0.05, 0), { maxDistance: 2 });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual([
        'bestDistance',
        'conceptId',
        'description',
        'hits',
        'name',
        'slug',
      ]);
    }
    const everything = JSON.stringify(rows);
    for (const secret of [
      'ch-1',
      'ch-2',
      'ch-3',
      'ch-b1',
      'PRIVATE CHUNK TEXT OF BEA',
      'An index speeds up lookups',
      'S1',
      'S2',
    ]) {
      expect(everything).not.toContain(secret);
    }
    for (const row of rows)
      for (const value of Object.values(row))
        expect(['ch-1', 'ch-b1', 'S1', 'S2']).not.toContain(value);
  });

  it('takes no access parameter', async () => {
    const info = tg.graph.listQueries().find((x) => x.name === 'concept_neighbourhood')!;
    expect(info.params.sort()).toEqual(['embedding', 'fetchK', 'maxDistance']);
  });
});

// ─── Concepts and prerequisites ──────────────────────────────────────────────

describe('upsert_concepts', () => {
  beforeEach(async () => {
    await addTaskFor(run);
  });
  const concepts = (over: Array<Record<string, unknown>> = []) => [
    {
      id: 'new-1',
      slug: 'buffer-pool',
      name: 'Buffer pool',
      description: 'A cache of pages.',
      chunkIds: ['ch-1', 'ch-2'],
    },
    // Existing concept: matched by slug, never renamed.
    {
      id: 'ignored',
      slug: 'index',
      name: 'Renamed index',
      description: 'Changed.',
      chunkIds: ['ch-2'],
    },
    ...over,
  ];

  it('creates new concepts, matches existing ones without renaming, and merges MENTIONS and PRODUCED', async () => {
    const rows = await q<{ conceptId: string; slug: string }>('upsert_concepts', {
      taskId: 'task-1',
      concepts: concepts(),
      now: NOW,
    });
    expect(rows.map((r) => r.slug).sort()).toEqual(['buffer-pool', 'index']);
    expect(rows.find((r) => r.slug === 'index')!.conceptId).toBe('c-index');
    const [index] = await tg.cypher<{ name: string; description: string }>(
      `MATCH (c:Concept {slug: 'index'}) RETURN c.name AS name, c.description AS description`,
    );
    expect(index).toEqual({ name: 'Index', description: 'Index concept' });
    const [created] = await tg.cypher<{ id: string; createdAt: number }>(
      `MATCH (c:Concept {slug: 'buffer-pool'}) RETURN c.id AS id, c.createdAt AS createdAt`,
    );
    expect(created).toEqual({ id: 'new-1', createdAt: NOW });
    const mentions = await tg.cypher<{ chunk: string }>(
      `MATCH (ch:Chunk)-[:MENTIONS]->(:Concept {slug: 'buffer-pool'}) RETURN ch.id AS chunk ORDER BY chunk`,
    );
    expect(mentions.map((m) => m.chunk)).toEqual(['ch-1', 'ch-2']);
    const produced = await tg.cypher<{ slug: string }>(
      `MATCH (:Task {id: 'task-1'})-[:PRODUCED]->(c:Concept) RETURN c.slug AS slug ORDER BY slug`,
    );
    expect(produced.map((p) => p.slug)).toEqual(['buffer-pool', 'index']);
  });

  it('twice gives the same counts', async () => {
    await q('upsert_concepts', { taskId: 'task-1', concepts: concepts(), now: NOW });
    const before = await signature();
    await q('upsert_concepts', { taskId: 'task-1', concepts: concepts(), now: NOW + 1 });
    expect(await signature()).toBe(before);
  });

  it('returns the row and writes no MENTIONS for a concept with no chunk ids (the prompt path)', async () => {
    const rows = await q<{ slug: string }>('upsert_concepts', {
      taskId: 'task-1',
      concepts: [
        { id: 'p-1', slug: 'joins', name: 'Joins', description: 'Combining tables.', chunkIds: [] },
      ],
      now: NOW,
    });
    expect(rows.map((r) => r.slug)).toEqual(['joins']);
    const [m] = await tg.cypher<{ n: number }>(
      `MATCH (:Chunk)-[r:MENTIONS]->(:Concept {slug: 'joins'}) RETURN count(r) AS n`,
    );
    expect(m!.n).toBe(0);
  });
});

describe('would_create_cycle and link_prerequisite', () => {
  beforeEach(async () => {
    // index -> b-tree exists; add b-tree -> sql so that the chain is index -> b-tree -> sql.
    await tg.cypher(
      `MATCH (a:Concept {slug: 'b-tree'}), (b:Concept {slug: 'sql'}) CREATE (a)-[:PREREQUISITE_OF {confidence: 0.7}]->(b)`,
    );
  });
  const cycle = async (from: string, to: string) =>
    (await q<{ wouldCycle: boolean }>('would_create_cycle', { fromSlug: from, toSlug: to }))[0]
      ?.wouldCycle;

  it('detects a direct reverse link', async () => {
    expect(await cycle('b-tree', 'index')).toBe(true);
  });
  it('detects a transitive cycle', async () => {
    expect(await cycle('sql', 'index')).toBe(true);
  });
  it('detects a self link', async () => {
    expect(await cycle('index', 'index')).toBe(true);
  });
  it('says no for a safe pair, including a shortcut along existing direction', async () => {
    expect(await cycle('index', 'sql')).toBe(false);
  });
  it('returns no row when a concept does not exist', async () => {
    expect(await q('would_create_cycle', { fromSlug: 'index', toSlug: 'nope' })).toEqual([]);
  });

  it('links a safe pair', async () => {
    await tg.cypher(`CREATE (:Concept {id: 'c-x', slug: 'x', name: 'X'})`);
    expect(
      await q('link_prerequisite', { fromSlug: 'x', toSlug: 'index', confidence: 0.9 }),
    ).toEqual([{ linked: true }]);
    const [e] = await tg.cypher<{ confidence: number }>(
      `MATCH (:Concept {slug: 'x'})-[r:PREREQUISITE_OF]->(:Concept {slug: 'index'}) RETURN r.confidence AS confidence`,
    );
    expect(e!.confidence).toBe(0.9);
  });

  it('refuses a cycle and a self link, and writes nothing', async () => {
    const before = await signature();
    expect(
      await q('link_prerequisite', { fromSlug: 'sql', toSlug: 'index', confidence: 0.9 }),
    ).toEqual([{ linked: false }]);
    expect(
      await q('link_prerequisite', { fromSlug: 'index', toSlug: 'index', confidence: 0.9 }),
    ).toEqual([{ linked: false }]);
    expect(await signature()).toBe(before);
  });

  it('keeps the first confidence and does not duplicate the edge', async () => {
    expect(
      await q('link_prerequisite', { fromSlug: 'index', toSlug: 'b-tree', confidence: 0.99 }),
    ).toEqual([{ linked: true }]);
    expect(await tg.countEdges('PREREQUISITE_OF')).toBe(2);
    const [e] = await tg.cypher<{ confidence: number }>(
      `MATCH (:Concept {slug: 'index'})-[r:PREREQUISITE_OF]->(:Concept {slug: 'b-tree'}) RETURN r.confidence AS confidence`,
    );
    expect(e!.confidence).toBe(0.8);
  });

  it('reports linked false when a concept does not exist', async () => {
    expect(
      await q('link_prerequisite', { fromSlug: 'index', toSlug: 'nope', confidence: 0.9 }),
    ).toEqual([{ linked: false }]);
  });
});

// ─── Drafts ──────────────────────────────────────────────────────────────────

describe('create_draft_puzzle and create_draft_questions', () => {
  const puzzle = {
    id: 'P-1',
    ownerId: A,
    sourceId: 'S1',
    taskId: 'task-1',
    name: 'Ann notes',
    origin: 'upload',
    now: NOW,
  };
  const questions = [
    {
      id: 'q-1',
      sentence: 'An ___ speeds up lookups.',
      answers: ['index'],
      distractors: ['cache', 'table'],
      order: 1,
      chunkId: 'ch-1',
      conceptSlugs: ['index'],
    },
    {
      id: 'q-2',
      sentence: 'A ___ keeps keys sorted.',
      answers: ['B-tree'],
      distractors: ['heap', 'list'],
      order: 2,
      chunkId: 'ch-2',
      conceptSlugs: ['b-tree', 'index'],
    },
  ];

  beforeEach(async () => {
    await addTaskFor(run);
  });

  it('creates a draft private puzzle owned by the learner, yielded by the source, produced by the task', async () => {
    expect(await q('create_draft_puzzle', puzzle)).toEqual([{ puzzleId: 'P-1', status: 'draft' }]);
    const [p] = await tg.cypher<{ p: Record<string, unknown> }>(
      `MATCH (p:Puzzle {id: 'P-1'}) RETURN properties(p) AS p`,
    );
    expect(p!.p).toMatchObject({
      name: 'Ann notes',
      origin: 'upload',
      status: 'draft',
      visibility: 'private',
      distractors: [],
      createdAt: NOW,
    });
    expect(
      await tg.cypher(`MATCH (:Learner {id: $A})-[:OWNS]->(p:Puzzle {id: 'P-1'}) RETURN p.id`, {
        A,
      }),
    ).toHaveLength(1);
    expect(
      await tg.cypher(`MATCH (:Source {id: 'S1'})-[:YIELDED]->(p:Puzzle {id: 'P-1'}) RETURN p.id`),
    ).toHaveLength(1);
    expect(
      await tg.cypher(
        `MATCH (:Task {id: 'task-1'})-[:PRODUCED]->(p:Puzzle {id: 'P-1'}) RETURN p.id`,
      ),
    ).toHaveLength(1);
  });

  it('twice gives the same counts', async () => {
    await q('create_draft_puzzle', puzzle);
    const before = await signature();
    await q('create_draft_puzzle', { ...puzzle, now: NOW + 1 });
    expect(await signature()).toBe(before);
  });

  it('creates draft questions with CONTAINS.order, TESTS, GROUNDED_IN and PRODUCED, and returns the number written', async () => {
    await q('create_draft_puzzle', puzzle);
    expect(
      await q('create_draft_questions', { puzzleId: 'P-1', taskId: 'task-1', questions, now: NOW }),
    ).toEqual([{ written: 2 }]);
    const [q1] = await tg.cypher<{ p: Record<string, unknown> }>(
      `MATCH (q:Question {id: 'q-1'}) RETURN properties(q) AS p`,
    );
    expect(q1!.p).toMatchObject({
      sentence: 'An ___ speeds up lookups.',
      answers: ['index'],
      distractors: ['cache', 'table'],
      status: 'draft',
      createdAt: NOW,
    });
    const order = await tg.cypher<{ id: string; order: number }>(
      `MATCH (:Puzzle {id: 'P-1'})-[c:CONTAINS]->(q:Question) RETURN q.id AS id, c.order AS order ORDER BY order`,
    );
    expect(order).toEqual([
      { id: 'q-1', order: 1 },
      { id: 'q-2', order: 2 },
    ]);
    const tests = await tg.cypher<{ q: string; c: string }>(
      `MATCH (q:Question)-[:TESTS]->(c:Concept) RETURN q.id AS q, c.slug AS c ORDER BY q, c`,
    );
    expect(tests).toEqual([
      { q: 'q-1', c: 'index' },
      { q: 'q-2', c: 'b-tree' },
      { q: 'q-2', c: 'index' },
    ]);
    const grounded = await tg.cypher<{ q: string; ch: string }>(
      `MATCH (q:Question)-[:GROUNDED_IN]->(ch:Chunk) RETURN q.id AS q, ch.id AS ch ORDER BY q`,
    );
    expect(grounded).toEqual([
      { q: 'q-1', ch: 'ch-1' },
      { q: 'q-2', ch: 'ch-2' },
    ]);
    expect(
      await tg.cypher(`MATCH (:Task {id: 'task-1'})-[:PRODUCED]->(q:Question) RETURN q.id`),
    ).toHaveLength(2);
  });

  it('twice gives the same counts', async () => {
    await q('create_draft_puzzle', puzzle);
    await q('create_draft_questions', { puzzleId: 'P-1', taskId: 'task-1', questions, now: NOW });
    const before = await signature();
    expect(
      await q('create_draft_questions', {
        puzzleId: 'P-1',
        taskId: 'task-1',
        questions,
        now: NOW + 1,
      }),
    ).toEqual([{ written: 2 }]);
    expect(await signature()).toBe(before);
  });

  it('writes fewer than sent when a chunk is missing, so the caller can fail the step', async () => {
    await q('create_draft_puzzle', puzzle);
    const rows = await q('create_draft_questions', {
      puzzleId: 'P-1',
      taskId: 'task-1',
      questions: [...questions, { ...questions[0], id: 'q-3', chunkId: 'missing' }],
      now: NOW,
    });
    expect(rows).toEqual([{ written: 2 }]);
  });

  it('every draft question has matching blank and answer counts, >= 2 distractors, >= 1 TESTS and 1 GROUNDED_IN (SC-U02)', async () => {
    await q('create_draft_puzzle', puzzle);
    await q('create_draft_questions', { puzzleId: 'P-1', taskId: 'task-1', questions, now: NOW });
    const bad = await tg.cypher(
      `MATCH (q:Question {status: 'draft'})
       OPTIONAL MATCH (q)-[:TESTS]->(c:Concept)
       OPTIONAL MATCH (q)-[:GROUNDED_IN]->(ch:Chunk)
       WITH q, count(DISTINCT c) AS tests, count(DISTINCT ch) AS grounded
       WHERE size(q.distractors) < 2 OR tests < 1 OR grounded <> 1
          OR size(q.answers) <> size(split(q.sentence, '___')) - 1
       RETURN q.id AS id`,
    );
    expect(bad).toEqual([]);
  });
});

// Keep the shared vectors referenced for readers: they are the contract of the neighbourhood tests above.
void VECTORS;
