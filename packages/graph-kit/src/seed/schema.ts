// Shapes of the files under seed/ (data-model.md §6.4). Users are strict: no password or identity may appear.
import { z } from 'zod';

export const SeedRole = z.enum(['learner', 'reviewer', 'admin']);

export const SeedConcept = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  prerequisites: z.array(z.string()),
});

export const SeedQuestion = z.object({
  order: z.number().int().positive(),
  sentence: z.string(),
  answers: z.array(z.string()).min(1),
  distractors: z.array(z.string()).min(2),
  /** Concept slugs. */
  tests: z.array(z.string()).min(1),
});

export const SeedPuzzle = z.object({
  key: z.string(),
  name: z.string(),
  distractors: z.array(z.string()),
  questions: z.array(SeedQuestion).min(6),
});

export const SeedUser = z
  .object({
    key: z.string(),
    email: z.string().email(),
    displayName: z.string(),
    role: SeedRole,
  })
  .strict();

export const SeedAnswer = z.object({
  /** Question order within the puzzle. */
  order: z.number().int(),
  blank: z.number().int().nonnegative(),
  /** null = the blank was left empty (stored as ''). */
  word: z.string().nullable(),
  correct: z.boolean(),
});

export const SeedMasteryChange = z.object({
  concept: z.string(),
  before: z.number().min(0).max(1),
  after: z.number().min(0).max(1),
});

export const SeedSession = z.object({
  key: z.string(),
  puzzle: z.string(),
  submittedDaysAgo: z.number().positive(),
  answers: z.array(SeedAnswer),
  masteryChanges: z.array(SeedMasteryChange),
});

export const SeedMastery = z.object({
  concept: z.string(),
  score: z.number().min(0).max(1),
  attempts: z.number().int().positive(),
  lastSeenDaysAgo: z.number().nonnegative(),
});

export const SeedScenario = z.object({
  learner: z.string(),
  sessions: z.array(SeedSession),
  mastery: z.array(SeedMastery),
});

export const SeedSource = z.object({
  file: z.string(),
  title: z.string(),
  kind: z.enum(['text', 'markdown']),
  words: z.number().int(),
  topic: z.string(),
  origin: z.literal('synthetic'),
  /** Words counted in the file by `readSeedDir`; absent when the file is missing. */
  actualWords: z.number().int().nonnegative().optional(),
});

export const SeedData = z.object({
  concepts: z.array(SeedConcept),
  puzzles: z.array(SeedPuzzle),
  users: z.array(SeedUser),
  scenario: SeedScenario,
  sources: z.array(SeedSource),
});
export type SeedData = z.infer<typeof SeedData>;
export type SeedPuzzleData = z.infer<typeof SeedPuzzle>;

export interface SeedIssue {
  file: string;
  path: string;
  message: string;
}

export type SeedUserKey = 'learner' | 'learner2' | 'reviewer' | 'admin';
export type ScenarioKey = 'A' | 'B' | 'C' | 'D' | 'E';
