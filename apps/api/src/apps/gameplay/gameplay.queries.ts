// Row schemas of the named queries owned by 003 (queries/*.cypher in @coach/graph-kit). Used with GraphKit.query.
import { z } from 'zod';
import { PuzzleOrigin } from '@coach/types';

export const AnswerKeyRow = z.object({
  questionId: z.string(),
  order: z.number(),
  sentence: z.string(),
  answers: z.array(z.string()),
  concepts: z.array(z.object({ id: z.string(), name: z.string() })),
});

export const SessionRow = z.object({
  sessionId: z.string(),
  puzzleId: z.string(),
  puzzleName: z.string(),
  puzzleOrigin: PuzzleOrigin,
  startedAt: z.number(),
  submittedAt: z.number().nullable(),
  score: z.number().nullable(),
  maxScore: z.number().nullable(),
  answers: z.array(
    z.object({
      questionId: z.string(),
      order: z.number(),
      blank: z.number(),
      word: z.string(),
      correct: z.boolean(),
    }),
  ),
  masteryChanges: z.array(
    z.object({ conceptId: z.string(), name: z.string(), before: z.number(), after: z.number() }),
  ),
});
export type SessionRow = z.infer<typeof SessionRow>;

export const MasteryRow = z.object({
  conceptId: z.string(),
  name: z.string(),
  score: z.number(),
  attempts: z.number(),
  lastSeen: z.number(),
});
export type MasteryRow = z.infer<typeof MasteryRow>;

export const GroundingRow = z.object({
  questionId: z.string(),
  chunkId: z.string(),
  sourceId: z.string(),
  text: z.string(),
});
export type GroundingRow = z.infer<typeof GroundingRow>;

export const SessionIdRow = z.object({ sessionId: z.string() });

export const RecordRow = z.object({
  sessionId: z.string(),
  answersWritten: z.number(),
  conceptsUpdated: z.number(),
});
