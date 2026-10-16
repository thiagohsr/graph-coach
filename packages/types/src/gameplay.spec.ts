import { describe, expect, it } from 'vitest';
import {
  MasteryChangeDto,
  MasteryDto,
  PlayPuzzleDto,
  SubmitRequest,
  SubmitResult,
  normaliseWord,
} from './gameplay';

describe('normaliseWord', () => {
  it('ignores case and surrounding whitespace', () => {
    expect(normaliseWord('  Index ')).toBe('index');
    expect(normaliseWord('B-TREE')).toBe('b-tree');
  });
  it('applies NFC', () => {
    expect(normaliseWord('é')).toBe(normaliseWord('é'));
  });
});

describe('SubmitRequest', () => {
  it('accepts word null and an empty answers list', () => {
    expect(
      SubmitRequest.safeParse({ answers: [{ questionId: 'q1', blank: 0, word: null }] }).success,
    ).toBe(true);
    expect(SubmitRequest.safeParse({ answers: [] }).success).toBe(true);
  });
  it('rejects a 101-character word', () => {
    expect(
      SubmitRequest.safeParse({ answers: [{ questionId: 'q1', blank: 0, word: 'a'.repeat(101) }] })
        .success,
    ).toBe(false);
  });
  it('rejects 501 answers', () => {
    const answers = Array.from({ length: 501 }, (_, i) => ({
      questionId: 'q1',
      blank: i,
      word: 'x',
    }));
    expect(SubmitRequest.safeParse({ answers }).success).toBe(false);
  });
  it('rejects a negative or fractional blank', () => {
    expect(
      SubmitRequest.safeParse({ answers: [{ questionId: 'q1', blank: -1, word: 'x' }] }).success,
    ).toBe(false);
    expect(
      SubmitRequest.safeParse({ answers: [{ questionId: 'q1', blank: 0.5, word: 'x' }] }).success,
    ).toBe(false);
  });
  it('rejects unknown keys', () => {
    expect(SubmitRequest.safeParse({ answers: [], extra: 1 }).success).toBe(false);
    expect(
      SubmitRequest.safeParse({
        answers: [{ questionId: 'q1', blank: 0, word: 'x', correct: true }],
      }).success,
    ).toBe(false);
  });
});

describe('result schemas', () => {
  it('SubmitResult accepts the contract example', () => {
    const example = {
      sessionId: '8a0c',
      puzzle: { id: 'pz-db-101', name: 'Databases 101', origin: 'upload' },
      submittedAt: '2026-10-11T14:03:22.000Z',
      score: 10,
      maxScore: 20,
      questions: [
        { id: 'q-1', order: 1, sentence: 'A ___ speeds up lookups at the cost of slower ___.' },
      ],
      review: [
        { questionId: 'q-1', blank: 0, submitted: 'Index', expected: 'index', correct: true },
        {
          questionId: 'q-1',
          blank: 1,
          submitted: null,
          expected: 'writes',
          correct: false,
          passage: {
            chunkId: 'ch-7',
            sourceId: 'src-3',
            excerpt: 'Every index must be updated on insert…',
          },
        },
      ],
      mastery: [{ conceptId: 'c-index', name: 'Indexes', before: 0.5, after: 0.455 }],
    };
    expect(SubmitResult.safeParse(example).success).toBe(true);
  });
  it('MasteryDto accepts the contract example', () => {
    expect(
      MasteryDto.safeParse({
        conceptId: 'c-index',
        name: 'Indexes',
        score: 0.455,
        attempts: 2,
        lastSeen: '2026-10-11T14:03:22.000Z',
      }).success,
    ).toBe(true);
  });
  it('MasteryChangeDto rejects values outside [0, 1]', () => {
    expect(
      MasteryChangeDto.safeParse({ conceptId: 'c', name: 'n', before: 1.1, after: 0.5 }).success,
    ).toBe(false);
    expect(
      MasteryChangeDto.safeParse({ conceptId: 'c', name: 'n', before: 0.5, after: -0.1 }).success,
    ).toBe(false);
  });
  it('PlayPuzzleDto is strict', () => {
    const ok = {
      id: 'p',
      name: 'n',
      origin: 'seed',
      questions: [{ id: 'q', order: 1, sentence: 's ___', blanks: 1 }],
      wordBank: ['a'],
    };
    expect(PlayPuzzleDto.safeParse(ok).success).toBe(true);
    expect(PlayPuzzleDto.safeParse({ ...ok, answers: ['a'] }).success).toBe(false);
  });
});
