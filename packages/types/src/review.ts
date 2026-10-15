// Review, publishing, and sharing schemas, and the draft validator (spec 005). Pure and browser-safe.
import { z } from 'zod';
import { IsoDateTime } from './common';
import { Origin, TaskResult, TaskStatus } from './curator';

// ─── Draft review ────────────────────────────────────────────────────────────

export const DraftQuestionDto = z.object({
  id: z.string(),
  sentence: z.string(),
  answers: z.array(z.string()),
  distractors: z.array(z.string()),
  concepts: z.array(z.object({ id: z.string(), name: z.string() })),
  /** Always null when origin is `prompt`. */
  passage: z.object({ chunkId: z.string(), text: z.string() }).nullable(),
  /** Null when origin is `upload`. */
  critique: z
    .object({ verdict: z.enum(['pass', 'rewrite', 'reject']), note: z.string() })
    .nullable(),
  origin: Origin,
  puzzleId: z.string(),
  taskId: z.string().nullable(),
});
export type DraftQuestionDto = z.infer<typeof DraftQuestionDto>;

export const DraftUpdateRequest = z
  .object({
    sentence: z.string().min(1).max(300).optional(),
    answers: z.array(z.string().trim().min(1).max(40)).min(1).max(5).optional(),
    distractors: z.array(z.string().trim().min(1).max(40)).min(2).max(8).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Give at least one field to change',
  });
export type DraftUpdateRequest = z.infer<typeof DraftUpdateRequest>;

export const RejectRequest = z.object({ reason: z.string().trim().max(500).optional() });
export type RejectRequest = z.infer<typeof RejectRequest>;

/** Same body for approve and reject. */
export const ReviewOutcome = z.object({
  puzzle: z.object({
    id: z.string(),
    status: z.enum(['draft', 'published']),
    visibility: z.enum(['private', 'public']),
    origin: Origin,
  }),
  remainingDrafts: z.number().int(),
  /** Present only on the decision that closes the task. */
  task: z.object({ id: z.string(), status: TaskStatus, result: TaskResult.nullable() }).optional(),
  notPublishedReason: z
    .object({
      code: z.literal('below_minimum'),
      approved: z.number().int(),
      minQuestions: z.number().int(),
    })
    .optional(),
});
export type ReviewOutcome = z.infer<typeof ReviewOutcome>;

// ─── Visibility and sharing ──────────────────────────────────────────────────

export const VisibilityRequest = z.object({ visibility: z.enum(['public', 'private']) });
export type VisibilityRequest = z.infer<typeof VisibilityRequest>;

export const VisibilityResponse = z.object({
  id: z.string(),
  visibility: z.enum(['private', 'public']),
  origin: Origin,
});
export type VisibilityResponse = z.infer<typeof VisibilityResponse>;

export const ShareRequest = z
  .object({ email: z.string().trim().toLowerCase().email().max(254), withSource: z.boolean() })
  .strict();
export type ShareRequest = z.infer<typeof ShareRequest>;

export const ShareDto = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  withSource: z.boolean(),
  sharedAt: IsoDateTime,
});
export type ShareDto = z.infer<typeof ShareDto>;

// ─── Draft validator (FR-U08) ────────────────────────────────────────────────

export type DraftViolationCode =
  | 'no_blank'
  | 'blank_count_mismatch'
  | 'answer_format'
  | 'answer_not_in_passage'
  | 'answer_leaked'
  | 'too_few_distractors'
  | 'distractor_is_answer'
  | 'no_concept'
  | 'sentence_length'
  | 'duplicate';

export interface DraftViolation {
  code: DraftViolationCode;
  path: 'sentence' | 'answers' | 'distractors' | 'concepts';
  message: string;
}

export interface DraftToValidate {
  sentence: string;
  answers: string[];
  distractors: string[];
  conceptSlugs: string[];
}

export interface DraftContext {
  /** The passage the answers must come from; null skips the passage rule (prompt drafts, forms that have no passage). */
  chunkText: string | null;
  allowedSlugs: ReadonlySet<string>;
  seenIds?: ReadonlySet<string>;
  id?: string;
}

export type DraftValidation =
  { ok: true; conceptSlugs: string[] } | { ok: false; violations: DraftViolation[] };

const BLANK = '___';
const MIN_SENTENCE_CHARS = 20;
const MAX_SENTENCE_CHARS = 300;
const MAX_ANSWER_CHARS = 40;
const MAX_ANSWER_WORDS = 3;
const MIN_DISTRACTORS = 2;

/** Underscore runs of the sentence. */
function underscoreRuns(sentence: string): string[] {
  return sentence.match(/_+/g) ?? [];
}

/** The number of blanks: runs of exactly three underscores. */
export function countBlanks(sentence: string): number {
  return underscoreRuns(sentence).filter((run) => run.length === BLANK.length).length;
}

const squash = (text: string) => text.replace(/\s+/gu, ' ').trim();
const fold = (text: string) => squash(text).toLowerCase();
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whole-word, case-insensitive, whitespace-normalised occurrence of `needle` in `haystack`. */
function containsWord(haystack: string, needle: string): boolean {
  const n = squash(needle);
  if (n === '') return false;
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRegExp(n).replace(/ /g, '\\s+')}(?![\\p{L}\\p{N}])`,
    'iu',
  );
  return pattern.test(squash(haystack));
}

/**
 * Every rule of data-model §5 "Draft rules"; all violations are returned, never only the first. Never throws.
 * On success the concept slugs are those that exist in `ctx.allowedSlugs` (unknown slugs are dropped first).
 */
export function validateDraft(draft: DraftToValidate, ctx: DraftContext): DraftValidation {
  const violations: DraftViolation[] = [];
  const add = (code: DraftViolationCode, path: DraftViolation['path'], message: string) =>
    violations.push({ code, path, message });

  const sentence = typeof draft.sentence === 'string' ? draft.sentence : '';
  const answers = Array.isArray(draft.answers) ? draft.answers : [];
  const distractors = Array.isArray(draft.distractors) ? draft.distractors : [];

  const blanks = countBlanks(sentence);
  const longRun = underscoreRuns(sentence).some((run) => run.length > BLANK.length);
  if (blanks === 0 || longRun) {
    add('no_blank', 'sentence', 'Mark each blank with exactly three underscores (___).');
  }
  if (blanks > 0 && blanks !== answers.length) {
    add(
      'blank_count_mismatch',
      'answers',
      `The sentence has ${blanks} blank${blanks === 1 ? '' : 's'} but ${answers.length} answer${answers.length === 1 ? '' : 's'}.`,
    );
  }

  const length = sentence.trim().length;
  if (length < MIN_SENTENCE_CHARS || length > MAX_SENTENCE_CHARS) {
    add(
      'sentence_length',
      'sentence',
      `The sentence must be ${MIN_SENTENCE_CHARS} to ${MAX_SENTENCE_CHARS} characters long.`,
    );
  }

  answers.forEach((answer, index) => {
    const text = typeof answer === 'string' ? answer : '';
    const words = squash(text) === '' ? 0 : squash(text).split(' ').length;
    if (
      text !== text.trim() ||
      text.length < 1 ||
      text.length > MAX_ANSWER_CHARS ||
      words > MAX_ANSWER_WORDS ||
      text.includes(BLANK) ||
      text.trim() === ''
    ) {
      add(
        'answer_format',
        'answers',
        `Answer ${index + 1} must be 1 to ${MAX_ANSWER_CHARS} characters and at most ${MAX_ANSWER_WORDS} words, with no spaces at the ends and no blank marker.`,
      );
    }
  });

  if (ctx.chunkText !== null) {
    const passage = ctx.chunkText;
    answers.forEach((answer, index) => {
      if (typeof answer === 'string' && answer.trim() !== '' && !containsWord(passage, answer)) {
        add(
          'answer_not_in_passage',
          'answers',
          `Answer ${index + 1} does not appear in the passage.`,
        );
      }
    });
  }

  const unblanked = sentence.replace(/_+/g, ' ');
  answers.forEach((answer, index) => {
    if (typeof answer === 'string' && answer.trim() !== '' && containsWord(unblanked, answer)) {
      add(
        'answer_leaked',
        'sentence',
        `Answer ${index + 1} also appears in the sentence outside its blank.`,
      );
    }
  });

  const distinct = new Set(
    distractors
      .filter((d) => typeof d === 'string')
      .map(fold)
      .filter((d) => d !== ''),
  );
  if (distinct.size < MIN_DISTRACTORS) {
    add(
      'too_few_distractors',
      'distractors',
      `Give at least ${MIN_DISTRACTORS} different distractors.`,
    );
  }
  const answerKeys = new Set(answers.filter((a) => typeof a === 'string').map(fold));
  if (distractors.some((d) => typeof d === 'string' && answerKeys.has(fold(d)))) {
    add('distractor_is_answer', 'distractors', 'A distractor is the same as an answer.');
  }

  const slugs = [
    ...new Set((draft.conceptSlugs ?? []).filter((slug) => ctx.allowedSlugs.has(slug))),
  ];
  if (slugs.length === 0)
    add('no_concept', 'concepts', 'Link the question to at least one known concept.');

  if (ctx.id !== undefined && ctx.seenIds?.has(ctx.id)) {
    add('duplicate', 'sentence', 'This question is already in the set.');
  }

  return violations.length === 0 ? { ok: true, conceptSlugs: slugs } : { ok: false, violations };
}
