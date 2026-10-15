import { describe, expect, it } from 'vitest';
import type { AnswerKey } from './gameplay.dto';
import { grade, validateSubmission } from './grading';

const KEY: AnswerKey = [
  { questionId: 'q2', order: 2, sentence: 'B ___', answers: ['B-tree'], concepts: [] },
  { questionId: 'q1', order: 1, sentence: 'A ___ and ___', answers: ['index', 'writes'], concepts: [] },
  { questionId: 'q3', order: 3, sentence: 'C ___', answers: ['index'], concepts: [] },
];

const a = (questionId: string, blank: number, word: string | null) => ({ questionId, blank, word });

describe('grade', () => {
  it('grades correct, wrong, null, missing, and whitespace-only words', () => {
    const { blanks, score, maxScore } = grade(KEY, [a('q1', 0, 'index'), a('q1', 1, 'reads'), a('q2', 0, null), a('q3', 0, '   ')]);
    expect(blanks.map((b) => b.correct)).toEqual([true, false, false, false]);
    expect(score).toBe(10);
    expect(maxScore).toBe(40);
  });

  it('ignores case, surrounding whitespace, and NFC differences', () => {
    const key: AnswerKey = [{ questionId: 'q', order: 1, sentence: '___', answers: ['café'], concepts: [] }];
    expect(grade(key, [a('q', 0, '  CAFÉ ')]).score).toBe(10);
    expect(grade(KEY, [a('q1', 0, '  INDEX ')]).blanks[0]!.correct).toBe(true);
  });

  it('maxScore counts every blank even when answers is empty', () => {
    const r = grade(KEY, []);
    expect(r.maxScore).toBe(40);
    expect(r.score).toBe(0);
    expect(r.blanks).toHaveLength(4);
  });

  it('outputs one GradedBlank per blank sorted by order then blank, with the trimmed word or empty string', () => {
    const { blanks } = grade(KEY, [a('q1', 1, '  writes  ')]);
    expect(blanks.map((b) => [b.questionId, b.blank])).toEqual([
      ['q1', 0],
      ['q1', 1],
      ['q2', 0],
      ['q3', 0],
    ]);
    expect(blanks[1]!.word).toBe('writes');
    expect(blanks[0]!.word).toBe('');
    expect(blanks[0]!.expected).toBe('index');
  });

  it('the same word is correct in two blanks that share an expected word', () => {
    const r = grade(KEY, [a('q1', 0, 'index'), a('q3', 0, 'index')]);
    expect(r.score).toBe(20);
  });
});

describe('validateSubmission', () => {
  it('returns [] for a valid submission, including a repeated word', () => {
    expect(validateSubmission(KEY, [a('q1', 0, 'index'), a('q3', 0, 'index')])).toEqual([]);
    expect(validateSubmission(KEY, [])).toEqual([]);
  });

  it('flags an unknown question', () => {
    expect(validateSubmission(KEY, [a('nope', 0, 'x')])).toEqual([
      { path: 'answers.0.questionId', message: expect.any(String) },
    ]);
  });

  it('flags a negative or too-large blank', () => {
    const issues = validateSubmission(KEY, [a('q2', 1, 'x'), a('q1', -1, 'x'), a('q1', 2, 'x')]);
    expect(issues.map((i) => i.path)).toEqual(['answers.0.blank', 'answers.1.blank', 'answers.2.blank']);
  });

  it('flags a duplicate (questionId, blank)', () => {
    const issues = validateSubmission(KEY, [a('q1', 0, 'x'), a('q1', 0, 'y')]);
    expect(issues).toEqual([{ path: 'answers.1', message: expect.any(String) }]);
  });
});
