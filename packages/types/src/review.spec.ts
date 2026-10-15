import { describe, expect, it } from 'vitest';
import {
  DraftUpdateRequest,
  ShareRequest,
  countBlanks,
  validateDraft,
  type DraftContext,
  type DraftToValidate,
  type DraftViolationCode,
} from './review';

const PASSAGE =
  'A database index speeds up lookups because a B-tree keeps keys sorted. Writes become slower, since every index must be updated.';

const ctx = (over: Partial<DraftContext> = {}): DraftContext => ({
  chunkText: PASSAGE,
  allowedSlugs: new Set(['indexes', 'b-trees']),
  ...over,
});

const good = (over: Partial<DraftToValidate> = {}): DraftToValidate => ({
  sentence: 'A database ___ speeds up lookups because a B-tree keeps keys sorted.',
  answers: ['index'],
  distractors: ['cache', 'table'],
  conceptSlugs: ['indexes'],
  ...over,
});

function codesOf(draft: DraftToValidate, context = ctx()): DraftViolationCode[] {
  const result = validateDraft(draft, context);
  return result.ok ? [] : result.violations.map((v) => v.code);
}

describe('countBlanks', () => {
  it('counts runs of exactly three underscores', () => {
    expect(countBlanks('a ___ and a ___.')).toBe(2);
    expect(countBlanks('none here')).toBe(0);
    expect(countBlanks('four ____ is not a blank')).toBe(0);
    expect(countBlanks('snake_case has one underscore')).toBe(0);
  });
});

describe('validateDraft', () => {
  it('accepts a good draft and returns the known concept slugs only', () => {
    const result = validateDraft(good({ conceptSlugs: ['indexes', 'unknown', 'indexes'] }), ctx());
    expect(result).toEqual({ ok: true, conceptSlugs: ['indexes'] });
  });

  it('accepts a draft with two blanks and two answers', () => {
    const result = validateDraft(
      good({
        sentence:
          'A database ___ speeds up lookups but makes ___ slower, as a B-tree keeps keys sorted.',
        answers: ['index', 'Writes'],
      }),
      ctx(),
    );
    expect(result.ok).toBe(true);
  });

  const failing: Array<[DraftViolationCode, DraftToValidate, Partial<DraftContext>?]> = [
    [
      'no_blank',
      good({
        sentence: 'A database index speeds up lookups because a B-tree keeps keys sorted.',
        answers: ['index'],
      }),
    ],
    [
      'no_blank',
      good({ sentence: 'A database ____ speeds up lookups because a B-tree keeps keys sorted.' }),
    ],
    ['blank_count_mismatch', good({ answers: ['index', 'keys'] })],
    ['answer_format', good({ answers: [' index '] })],
    ['answer_format', good({ answers: ['a b c d'] })],
    ['answer_format', good({ answers: ['x'.repeat(41)] })],
    ['answer_not_in_passage', good({ answers: ['hashmap'] })],
    [
      'answer_leaked',
      good({ sentence: 'A database ___ speeds up lookups because an index keeps keys sorted.' }),
    ],
    ['too_few_distractors', good({ distractors: ['cache'] })],
    ['too_few_distractors', good({ distractors: ['cache', ' Cache '] })],
    ['distractor_is_answer', good({ distractors: ['Index', 'table'] })],
    ['no_concept', good({ conceptSlugs: ['nothing-known'] })],
    ['sentence_length', good({ sentence: 'An ___ helps.', answers: ['index'] })],
    [
      'sentence_length',
      good({ sentence: `A database ___ ${'speeds up lookups '.repeat(20)}`, answers: ['index'] }),
    ],
    ['duplicate', good(), { id: 'q1', seenIds: new Set(['q1']) }],
  ];

  for (const [code, draft, over] of failing) {
    it(`reports ${code}`, () => {
      const result = validateDraft(draft, ctx(over));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.violations.map((v) => v.code)).toContain(code);
      for (const violation of result.violations) {
        expect(violation.code).toBeTruthy();
        expect(['sentence', 'answers', 'distractors', 'concepts']).toContain(violation.path);
        expect(violation.message.length).toBeGreaterThan(0);
      }
    });
  }

  it('matches answers in the passage ignoring case and whitespace, and by whole word', () => {
    expect(codesOf(good({ answers: ['INDEX'] }))).toEqual([]);
    expect(
      codesOf(
        good({
          answers: ['b-tree'],
          sentence: 'A database index speeds up lookups because a ___ keeps keys sorted.',
        }),
      ),
    ).toEqual([]);
    expect(codesOf(good({ answers: ['inde'] }))).toContain('answer_not_in_passage');
    const spaced = ctx({ chunkText: 'Query   plans\nchoose  indexes wisely.' });
    expect(
      codesOf(
        good({
          sentence: 'The planner chooses ___ using statistics.',
          answers: ['query plans'],
          distractors: ['a', 'b'],
        }),
        spaced,
      ),
    ).toEqual([]);
  });

  it('skips the passage rule when chunkText is null and still applies the others', () => {
    expect(codesOf(good({ answers: ['hashmap'] }), ctx({ chunkText: null }))).toEqual([]);
    expect(
      codesOf(
        good({ answers: ['hashmap'], distractors: ['hashmap', 'x'] }),
        ctx({ chunkText: null }),
      ),
    ).toContain('distractor_is_answer');
  });

  it('reports every failed rule, not only the first', () => {
    const codes = codesOf({
      sentence: 'short',
      answers: ['a b c d'],
      distractors: ['x'],
      conceptSlugs: [],
    });
    expect(codes).toEqual(
      expect.arrayContaining([
        'no_blank',
        'sentence_length',
        'answer_format',
        'too_few_distractors',
        'no_concept',
      ]),
    );
  });

  it('never throws on malformed input', () => {
    expect(() => validateDraft({} as DraftToValidate, ctx())).not.toThrow();
  });
});

describe('request schemas', () => {
  it('DraftUpdateRequest is strict and needs at least one field', () => {
    expect(DraftUpdateRequest.safeParse({}).success).toBe(false);
    expect(DraftUpdateRequest.safeParse({ conceptIds: ['x'] }).success).toBe(false);
    expect(DraftUpdateRequest.safeParse({ sentence: 'An ___ here.' }).success).toBe(true);
    expect(DraftUpdateRequest.safeParse({ distractors: ['one'] }).success).toBe(false);
  });

  it('ShareRequest trims and lower-cases the address', () => {
    const parsed = ShareRequest.parse({ email: '  Ann@Example.TEST ', withSource: true });
    expect(parsed.email).toBe('ann@example.test');
    expect(
      ShareRequest.safeParse({ email: 'x@example.test', withSource: true, extra: 1 }).success,
    ).toBe(false);
  });
});
