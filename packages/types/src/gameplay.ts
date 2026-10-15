// Gameplay and mastery (spec 003): schemas, constants, and the one definition of word equality.
import { z } from 'zod';

export const POINTS_PER_BLANK = 10;
export const UNSEEN_MASTERY = 0.5;
export const MAX_WORD_LENGTH = 100;
export const MAX_ANSWERS_PER_SUBMIT = 500;
export const PASSAGE_EXCERPT_MAX = 280;

/** The only word equality: NFC, trimmed, lower-cased. Server side only; the web client must not pre-grade with it. */
export const normaliseWord = (w: string): string => w.normalize('NFC').trim().toLowerCase();

// Gameplay ids are opaque strings (puzzles and questions may be seeded with readable ids).
const GId = z.string().min(1).max(64);
const ConceptRef = z.object({ id: GId, name: z.string() });

export const PuzzleOrigin = z.enum(['seed', 'upload', 'prompt']);
export type PuzzleOrigin = z.infer<typeof PuzzleOrigin>;

export const PuzzleSummaryDto = z.object({
  id: GId,
  name: z.string(),
  visibility: z.enum(['private', 'public']),
  origin: PuzzleOrigin,
  access: z.enum(['owner', 'shared', 'public']),
  ownerName: z.string(),
  sourceShared: z.boolean(),
  sourceId: GId.optional(),
  questionCount: z.number().int().nonnegative(),
  concepts: z.array(ConceptRef),
});
export type PuzzleSummaryDto = z.infer<typeof PuzzleSummaryDto>;

// Strict: any extra key is a parse error (FR-G01).
export const PlayQuestionDto = z
  .object({
    id: GId,
    order: z.number().int(),
    sentence: z.string(),
    blanks: z.number().int().positive(),
  })
  .strict();
export type PlayQuestionDto = z.infer<typeof PlayQuestionDto>;

export const PlayPuzzleDto = z
  .object({
    id: GId,
    name: z.string(),
    origin: PuzzleOrigin,
    questions: z.array(PlayQuestionDto).min(1),
    wordBank: z.array(z.string()),
  })
  .strict();
export type PlayPuzzleDto = z.infer<typeof PlayPuzzleDto>;

export const StartSessionResponse = z.object({ sessionId: GId });
export type StartSessionResponse = z.infer<typeof StartSessionResponse>;

export const SubmitAnswer = z
  .object({
    questionId: GId,
    blank: z.number().int().nonnegative(),
    word: z.string().max(MAX_WORD_LENGTH).nullable(),
  })
  .strict();
export type SubmitAnswer = z.infer<typeof SubmitAnswer>;

export const SubmitRequest = z
  .object({
    answers: z.array(SubmitAnswer).max(MAX_ANSWERS_PER_SUBMIT),
  })
  .strict();
export type SubmitRequest = z.infer<typeof SubmitRequest>;

export const PassageExcerptDto = z.object({
  chunkId: GId,
  sourceId: GId,
  excerpt: z.string().max(PASSAGE_EXCERPT_MAX + 1),
});
export type PassageExcerptDto = z.infer<typeof PassageExcerptDto>;

export const ResultQuestionDto = z.object({ id: GId, order: z.number().int(), sentence: z.string() });
export type ResultQuestionDto = z.infer<typeof ResultQuestionDto>;

export const ReviewItemDto = z.object({
  questionId: GId,
  blank: z.number().int().nonnegative(),
  submitted: z.string().nullable(),
  expected: z.string(),
  correct: z.boolean(),
  passage: PassageExcerptDto.optional(),
});
export type ReviewItemDto = z.infer<typeof ReviewItemDto>;

export const MasteryChangeDto = z.object({
  conceptId: GId,
  name: z.string(),
  before: z.number().min(0).max(1),
  after: z.number().min(0).max(1),
});
export type MasteryChangeDto = z.infer<typeof MasteryChangeDto>;

export const SubmitResult = z.object({
  sessionId: GId,
  puzzle: z.object({ id: GId, name: z.string(), origin: PuzzleOrigin }),
  submittedAt: z.string().datetime(),
  score: z.number().int().nonnegative(),
  maxScore: z.number().int().nonnegative(),
  questions: z.array(ResultQuestionDto),
  review: z.array(ReviewItemDto),
  mastery: z.array(MasteryChangeDto),
});
export type SubmitResult = z.infer<typeof SubmitResult>;

export const MasteryDto = z.object({
  conceptId: GId,
  name: z.string(),
  score: z.number().min(0).max(1),
  attempts: z.number().int().positive(),
  lastSeen: z.string().datetime(),
});
export type MasteryDto = z.infer<typeof MasteryDto>;
