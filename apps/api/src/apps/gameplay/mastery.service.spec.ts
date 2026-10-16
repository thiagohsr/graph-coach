import { describe, expect, it } from 'vitest';
import type { GraphKit } from '@coach/graph-kit';
import type { AnswerKey, GradedBlank } from './gameplay.dto';
import { MasteryService } from './mastery.service';

const KEY: AnswerKey = [
  {
    questionId: 'q1',
    order: 1,
    sentence: '',
    answers: ['a', 'b'],
    concepts: [{ id: 'c-index', name: 'Indexes' }],
  },
  {
    questionId: 'q2',
    order: 2,
    sentence: '',
    answers: ['c'],
    concepts: [
      { id: 'c-index', name: 'Indexes' },
      { id: 'c-btree', name: 'B-trees' },
    ],
  },
  { questionId: 'q3', order: 3, sentence: '', answers: ['d'], concepts: [] },
];

const blank = (questionId: string, order: number, b: number, correct: boolean): GradedBlank => ({
  questionId,
  order,
  blank: b,
  word: correct ? 'x' : '',
  expected: 'x',
  correct,
});
const BLANKS = [
  blank('q1', 1, 0, true),
  blank('q1', 1, 1, false),
  blank('q2', 2, 0, false),
  blank('q3', 3, 0, true),
];

function make(rows: unknown[] = []) {
  const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const graph = {
    query: async (name: string, params: Record<string, unknown>) => {
      calls.push({ name, params });
      return name === 'learner_mastery' ? rows : [];
    },
  } as unknown as GraphKit;
  const settings = { get: async () => 0.3 as never };
  const clock = { now: () => new Date(1_760_000_000_000) };
  return { service: new MasteryService(graph, settings, clock), calls };
}

describe('MasteryService.plan', () => {
  it('updates every concept of a question and folds blanks by order then blank; unseen starts at 0.5', async () => {
    const { service, calls } = make();
    const changes = await service.plan('u', BLANKS, KEY);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.params.conceptIds).toEqual(['c-index', 'c-btree']);
    const index = changes.find((c) => c.conceptId === 'c-index')!;
    // outcomes 1, 0, 0 from 0.5 at alpha 0.3
    expect(index.before).toBe(0.5);
    expect(index.after).toBeCloseTo(0.3185);
    expect(index.attempts).toBe(3);
    const btree = changes.find((c) => c.conceptId === 'c-btree')!;
    expect(btree.after).toBeCloseTo(0.35);
    expect(changes.map((c) => c.name)).toEqual(['B-trees', 'Indexes']);
  });

  it('uses previous score and attempts from learner_mastery', async () => {
    const { service } = make([
      { conceptId: 'c-btree', name: 'B-trees', score: 0.8, attempts: 5, lastSeen: 1 },
    ]);
    const changes = await service.plan('u', BLANKS, KEY);
    const btree = changes.find((c) => c.conceptId === 'c-btree')!;
    expect(btree.before).toBe(0.8);
    expect(btree.attempts).toBe(6);
  });

  it('a question with no concept produces no change and no read when nothing else is touched', async () => {
    const { service, calls } = make();
    expect(await service.plan('u', [blank('q3', 3, 0, true)], KEY)).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe('MasteryService.apply and list', () => {
  it('apply upserts absolute values computed by plan', async () => {
    const { service, calls } = make();
    const changes = await service.apply('u', BLANKS, KEY, 123);
    const write = calls.find((c) => c.name === 'upsert_mastery')!;
    const rows = write.params.rows as Array<{
      conceptId: string;
      score: number;
      attempts: number;
      lastSeen: number;
    }>;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const change = changes.find((c) => c.conceptId === row.conceptId)!;
      expect(row).toEqual({
        conceptId: row.conceptId,
        score: change.after,
        attempts: change.attempts,
        lastSeen: 123,
      });
    }
  });

  it('apply makes no write when no concept is touched', async () => {
    const { service, calls } = make();
    await service.apply('u', [blank('q3', 3, 0, true)], KEY);
    expect(calls.filter((c) => c.name === 'upsert_mastery')).toHaveLength(0);
  });

  it('list maps rows to MasteryDto with ISO lastSeen, ordered by name', async () => {
    const { service } = make([
      { conceptId: 'c2', name: 'Zed', score: 0.5, attempts: 1, lastSeen: 1_760_000_000_000 },
      { conceptId: 'c1', name: 'Alpha', score: 0.4, attempts: 2, lastSeen: 1_760_000_000_000 },
    ]);
    const list = await service.list('u');
    expect(list.map((m) => m.name)).toEqual(['Alpha', 'Zed']);
    expect(list[0]!.lastSeen).toBe('2025-10-09T08:53:20.000Z');
  });
});
