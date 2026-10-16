// Coach DTOs (spec 004, data-model.md §4; flag values are defined in contracts/coach-api.md).
import { z } from 'zod';
import { IsoDateTime } from './common';

export const CoachFlag = z.enum([
  'cold_start',
  'unseen',
  'decayed',
  'all_mastered',
  'prerequisite_first',
  'coverage_gap',
  'no_puzzle',
  'repeat',
  'goal_unmatched',
  'coverage_requested',
  'coverage_not_requested',
]);
export type CoachFlag = z.infer<typeof CoachFlag>;

const ConceptRef = z.object({ conceptId: z.string(), name: z.string() });
const PuzzleRef = z.object({ id: z.string(), name: z.string() });

export const RecommendationRequest = z
  .object({
    goal: z.string().trim().min(3).max(280).optional(),
  })
  .strict();
export type RecommendationRequest = z.infer<typeof RecommendationRequest>;

const CoverageGap = z.object({ concepts: z.array(ConceptRef).min(1) });

export const RecommendationDto = z.object({
  decisionId: z.string(),
  puzzle: PuzzleRef.nullable(),
  target: ConceptRef.nullable(),
  summary: z.string(),
  alternatives: z.array(ConceptRef),
  flags: z.array(CoachFlag),
  /** Present exactly when `flags` contains `coverage_gap`. */
  coverageGap: CoverageGap.optional(),
  coverageTaskId: z.string().optional(),
  reused: z.boolean(),
});
export type RecommendationDto = z.infer<typeof RecommendationDto>;

export const DecisionDto = z.object({
  id: z.string(),
  kind: z.enum(['recommendation', 'coverage_request']),
  summary: z.string(),
  createdAt: IsoDateTime,
  puzzle: PuzzleRef.nullable(),
  target: ConceptRef.nullable(),
  flags: z.array(CoachFlag),
});
export type DecisionDto = z.infer<typeof DecisionDto>;

export const DecisionPathDto = z.object({
  nodes: z.array(
    z.object({
      id: z.string(),
      label: z.enum([
        'Decision',
        'Agent',
        'Learner',
        'Puzzle',
        'Concept',
        'Session',
        'Question',
        'Chunk',
        'Goal',
        'Task',
      ]),
      title: z.string(),
      props: z.record(z.unknown()),
    }),
  ),
  edges: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      type: z.string(),
      reason: z.string().optional(),
      weight: z.number().optional(),
      role: z.enum(['target', 'driver', 'alternative', 'answer', 'session', 'passage']).optional(),
    }),
  ),
  steps: z.array(z.string()),
});
export type DecisionPathDto = z.infer<typeof DecisionPathDto>;
