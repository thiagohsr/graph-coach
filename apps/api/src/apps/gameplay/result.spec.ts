import { describe, expect, it } from 'vitest';
import { SubmitResult } from '@coach/types';
import type { AnswerKey, GradedBlank } from './gameplay.dto';
import { buildResult } from './result';

const KEY: AnswerKey = [
  { questionId: 'q2', order: 2, sentence: 'B ___', answers: ['y'], concepts: [] },
  { questionId: 'q1', order: 1, sentence: 'A ___ ___', answers: ['x', 'z'], concepts: [] },
];
const BLANKS: GradedBlank[] = [
  { questionId: 'q1', order: 1, blank: 0, word: 'x', expected: 'x', correct: true },
  { questionId: 'q1', order: 1, blank: 1, word: '', expected: 'z', correct: false },
  { questionId: 'q2', order: 2, blank: 0, word: 'no', expected: 'y', correct: false },
];

const input = (passages = new Map<string, { chunkId: string; sourceId: string; text: string }>()) => ({
  session: {
    sessionId: 's1',
    puzzleId: 'P1',
    puzzleName: 'Databases',
    puzzleOrigin: 'upload' as const,
    submittedAt: 1_760_000_000_000,
    score: 10,
    maxScore: 30,
  },
  key: KEY,
  blanks: BLANKS,
  changes: [
    { conceptId: 'c2', name: 'Zed', before: 0.5, after: 0.35, attempts: 9 },
    { conceptId: 'c1', name: 'Alpha', before: 0.5, after: 0.65, attempts: 9 },
  ],
  passages,
});

describe('buildResult', () => {
  it('copies session and puzzle fields and ISO-formats submittedAt', () => {
    const r = buildResult(input());
    expect(r.sessionId).toBe('s1');
    expect(r.puzzle).toEqual({ id: 'P1', name: 'Databases', origin: 'upload' });
    expect(r.submittedAt).toBe('2025-10-09T08:53:20.000Z');
    expect([r.score, r.maxScore]).toEqual([10, 30]);
  });

  it('lists every key entry as { id, order, sentence } by order', () => {
    const r = buildResult(input());
    expect(r.questions).toEqual([
      { id: 'q1', order: 1, sentence: 'A ___ ___' },
      { id: 'q2', order: 2, sentence: 'B ___' },
    ]);
  });

  it("review follows the blanks, maps '' to null, and copies expected and correct", () => {
    const r = buildResult(input());
    expect(r.review.map((i) => [i.questionId, i.blank, i.submitted, i.expected, i.correct])).toEqual([
      ['q1', 0, 'x', 'x', true],
      ['q1', 1, null, 'z', false],
      ['q2', 0, 'no', 'y', false],
    ]);
    expect(r.review.every((i) => !('passage' in i))).toBe(true);
  });

  it('mastery is sorted by name and has no attempts key', () => {
    const r = buildResult(input());
    expect(r.mastery.map((m) => m.name)).toEqual(['Alpha', 'Zed']);
    expect(Object.keys(r.mastery[0]!).sort()).toEqual(['after', 'before', 'conceptId', 'name']);
  });

  it('adds a capped passage only for questions in the map', () => {
    const r = buildResult(input(new Map([['q1', { chunkId: 'ch', sourceId: 'S', text: 'word '.repeat(200) }]])));
    expect(r.review[0]!.passage).toMatchObject({ chunkId: 'ch', sourceId: 'S' });
    expect(r.review[0]!.passage!.excerpt.length).toBeLessThanOrEqual(281);
    expect(r.review[2]!.passage).toBeUndefined();
    expect(SubmitResult.safeParse(r).success).toBe(true);
  });
});
