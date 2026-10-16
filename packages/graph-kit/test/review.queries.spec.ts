import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { QueryParams } from '../src';
import { createTestGraph, type TestGraph } from '../src/testing';
import { IDS, buildCuratorFixture, type Run } from './curator.fixture';
import { addDraftPuzzle } from './review.fixture';

const { A, B, R, M } = IDS;
const NOW = 1_760_000_000_000;

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
  await addDraftPuzzle(run);
});

describe('list_drafts', () => {
  const base = { status: null, taskId: null, questionId: null };

  it('gives the puzzle owner the drafts with concepts and passage, in order', async () => {
    const rows = await q<{
      id: string;
      concepts: Array<{ slug: string | null }>;
      chunkId: string;
      chunkText: string;
      taskId: string;
      puzzleId: string;
      origin: string;
      hasBrief: boolean;
      answers: string[];
      status: string;
    }>('list_drafts', { userId: A, ...base });
    expect(rows.map((r) => r.id)).toEqual(['q-1', 'q-2', 'q-3', 'q-4', 'q-5']);
    expect(rows[0]).toMatchObject({
      chunkId: 'ch-1',
      chunkText: 'An index speeds up lookups.',
      taskId: 'task-1',
      puzzleId: 'PZ1',
      origin: 'upload',
      hasBrief: false,
      answers: ['lookups'],
      status: 'draft',
    });
    expect(rows[0]!.concepts.map((c) => c.slug)).toEqual(['index']);
  });

  it('gives nothing to another learner, a reviewer, an admin, or a user the puzzle is shared with', async () => {
    await run(
      `MATCH (p:Puzzle {id: 'PZ1'}), (b:Learner {id: $B}) CREATE (p)-[:SHARED_WITH {withSource: true, at: 1}]->(b)`,
      { B },
    );
    for (const userId of [B, R, M]) {
      expect(await q('list_drafts', { userId, ...base })).toEqual([]);
      expect(await q('list_drafts', { userId, ...base, taskId: 'task-1' })).toEqual([]);
    }
  });

  it('filters by task, question, and status', async () => {
    expect(await q('list_drafts', { userId: A, ...base, taskId: 'task-1' })).toHaveLength(5);
    expect(await q('list_drafts', { userId: A, ...base, taskId: 'nope' })).toEqual([]);
    const one = await q<{ id: string }>('list_drafts', { userId: A, ...base, questionId: 'q-3' });
    expect(one.map((r) => r.id)).toEqual(['q-3']);
    await run(`MATCH (qq:Question {id: 'q-3'}) SET qq.status = 'approved'`);
    expect(await q('list_drafts', { userId: A, ...base, status: 'draft' })).toHaveLength(4);
    expect(await q('list_drafts', { userId: A, ...base, status: 'approved' })).toHaveLength(1);
    expect(await q('list_drafts', { userId: A, ...base })).toHaveLength(5);
  });
});

describe('update_draft', () => {
  const params = {
    questionId: 'q-1',
    userId: A,
    sentence: 'A new sentence with ___ inside',
    answers: ['x'],
    distractors: ['y', 'z'],
  };

  it('saves the sentence, answers, and distractors and leaves TESTS edges alone', async () => {
    expect(await q('update_draft', params)).toEqual([{ id: 'q-1' }]);
    const [row] = await tg.cypher<{ s: string; a: string[]; d: string[] }>(
      `MATCH (qq:Question {id: 'q-1'}) RETURN qq.sentence AS s, qq.answers AS a, qq.distractors AS d`,
    );
    expect(row).toEqual({ s: params.sentence, a: ['x'], d: ['y', 'z'] });
    expect(await tg.countEdges('TESTS')).toBe(5);
  });

  it('returns no row for a decided question or for anyone who does not own the puzzle', async () => {
    for (const userId of [B, R, M]) {
      expect(await q('update_draft', { ...params, userId })).toEqual([]);
    }
    await run(`MATCH (qq:Question {id: 'q-1'}) SET qq.status = 'rejected'`);
    expect(await q('update_draft', params)).toEqual([]);
  });
});

describe('approve_question and reject_question', () => {
  it('approve sets the status and records the decision once', async () => {
    expect(await q('approve_question', { questionId: 'q-1', userId: A, now: NOW })).toEqual([
      { id: 'q-1' },
    ]);
    const [row] = await tg.cypher<{ s: string; at: number; d: string; ra: number }>(
      `MATCH (:Learner {id: $A})-[r:REVIEWED]->(qq:Question {id: 'q-1'})
       RETURN qq.status AS s, qq.reviewedAt AS at, r.decision AS d, r.at AS ra`,
      { A },
    );
    expect(row).toEqual({ s: 'approved', at: NOW, d: 'approved', ra: NOW });

    const before = await signature();
    expect(await q('approve_question', { questionId: 'q-1', userId: A, now: NOW + 1 })).toEqual([]);
    expect(
      await q('reject_question', { questionId: 'q-1', userId: A, reason: 'x', now: NOW + 1 }),
    ).toEqual([]);
    expect(await signature()).toBe(before);
  });

  it('reject stores the reason, or none', async () => {
    expect(
      await q('reject_question', { questionId: 'q-2', userId: A, reason: 'Too easy', now: NOW }),
    ).toEqual([{ id: 'q-2' }]);
    expect(
      await q('reject_question', { questionId: 'q-3', userId: A, reason: null, now: NOW }),
    ).toEqual([{ id: 'q-3' }]);
    const rows = await tg.cypher<{ id: string; s: string; d: string; reason: string | null }>(
      `MATCH (:Learner {id: $A})-[r:REVIEWED]->(qq:Question) RETURN qq.id AS id, qq.status AS s, r.decision AS d, r.reason AS reason ORDER BY id`,
      { A },
    );
    expect(rows).toEqual([
      { id: 'q-2', s: 'rejected', d: 'rejected', reason: 'Too easy' },
      { id: 'q-3', s: 'rejected', d: 'rejected', reason: null },
    ]);
  });

  it('returns no row and changes nothing for anyone who does not own the puzzle', async () => {
    const before = await signature();
    for (const userId of [B, R, M]) {
      expect(await q('approve_question', { questionId: 'q-1', userId, now: NOW })).toEqual([]);
      expect(
        await q('reject_question', { questionId: 'q-1', userId, reason: null, now: NOW }),
      ).toEqual([]);
    }
    expect(await signature()).toBe(before);
    const [row] = await tg.cypher<{ s: string }>(
      `MATCH (qq:Question {id: 'q-1'}) RETURN qq.status AS s`,
    );
    expect(row!.s).toBe('draft');
  });
});

describe('remaining_drafts and publish_puzzle', () => {
  it('counts by status', async () => {
    await q('approve_question', { questionId: 'q-1', userId: A, now: NOW });
    await q('approve_question', { questionId: 'q-2', userId: A, now: NOW });
    await q('reject_question', { questionId: 'q-3', userId: A, reason: null, now: NOW });
    expect(await q('remaining_drafts', { taskId: 'task-1' })).toEqual([
      { remaining: 2, approved: 2, rejected: 1 },
    ]);
  });

  it('keeps the puzzle a draft below the minimum, publishes at it, and never reverts', async () => {
    await q('approve_question', { questionId: 'q-1', userId: A, now: NOW });
    await q('approve_question', { questionId: 'q-2', userId: A, now: NOW });
    const shape = { id: 'PZ1', visibility: 'private', origin: 'upload' };
    expect(await q('publish_puzzle', { puzzleId: 'PZ1', minQuestions: 3 })).toEqual([
      { ...shape, status: 'draft', approved: 2 },
    ]);
    await q('approve_question', { questionId: 'q-3', userId: A, now: NOW });
    // A null minimum only reads.
    expect(await q('publish_puzzle', { puzzleId: 'PZ1', minQuestions: null })).toEqual([
      { ...shape, status: 'draft', approved: 3 },
    ]);
    expect(await q('publish_puzzle', { puzzleId: 'PZ1', minQuestions: 3 })).toEqual([
      { ...shape, status: 'published', approved: 3 },
    ]);
    const before = await signature();
    expect(await q('publish_puzzle', { puzzleId: 'PZ1', minQuestions: 3 })).toEqual([
      { ...shape, status: 'published', approved: 3 },
    ]);
    // A higher minimum later does not un-publish.
    expect(await q('publish_puzzle', { puzzleId: 'PZ1', minQuestions: 5 })).toEqual([
      { ...shape, status: 'published', approved: 3 },
    ]);
    expect(await signature()).toBe(before);
    const [row] = await tg.cypher<{ s: string }>(
      `MATCH (p:Puzzle {id: 'PZ1'}) RETURN p.status AS s`,
    );
    expect(row!.s).toBe('published');
  });

  it('returns no row for an unknown puzzle', async () => {
    expect(await q('publish_puzzle', { puzzleId: 'nope', minQuestions: 1 })).toEqual([]);
  });
});
