// Zod schemas of the rows the Coach queries return (data-model.md §3.1 to §3.9). Rows are parsed before use.
import { z } from 'zod';

const nullableNumber = z.number().nullable();
const nullableString = z.string().nullable();

export const RecentDecisionRow = z.object({
  masteryCount: z.number().int(),
  decisionId: nullableString,
  createdAt: nullableNumber,
  newAnswers: z.boolean(),
  goalText: nullableString,
});
export type RecentDecisionRow = z.infer<typeof RecentDecisionRow>;

export const PrereqRef = z.object({
  conceptId: z.string(),
  slug: z.string(),
  name: z.string(),
  distance: z.number(),
  score: z.number(),
  attempts: z.number(),
  lastSeen: z.number(),
  daysSince: z.number(),
  risk: z.number(),
});
export type PrereqRef = z.infer<typeof PrereqRef>;

export const WeakRow = z.object({
  conceptId: z.string(),
  slug: z.string(),
  name: z.string(),
  score: z.number(),
  attempts: z.number(),
  lastSeen: z.number(),
  daysSince: z.number(),
  risk: z.number(),
  weakestPrereq: PrereqRef.nullable(),
  cyclic: z.boolean(),
});
export type WeakRow = z.infer<typeof WeakRow>;

export const DecayedRow = z.object({
  conceptId: z.string(),
  slug: z.string(),
  name: z.string(),
  kind: z.enum(['unseen', 'decayed']),
  score: nullableNumber,
  attempts: z.number(),
  lastSeen: nullableNumber,
  daysSince: nullableNumber,
  risk: nullableNumber,
  openPrereqs: z.number(),
});
export type DecayedRow = z.infer<typeof DecayedRow>;

export const PuzzleRow = z.object({
  puzzleId: z.string(),
  name: z.string(),
  overlap: z.number(),
  coveredTargetIds: z.array(z.string()),
  targetQuestions: z.number(),
  lastPlayedAt: nullableNumber,
  playedRecently: z.boolean(),
});
export type PuzzleRow = z.infer<typeof PuzzleRow>;

const ConceptCount = z.object({ conceptId: z.string(), slug: z.string(), name: z.string(), questions: z.number() });
export type IntroConcept = z.infer<typeof ConceptCount>;

export const IntroPuzzleRow = z.object({
  puzzleId: z.string(),
  name: z.string(),
  rootConcepts: z.array(ConceptCount),
  topConcept: ConceptCount,
  rootCount: z.number(),
  conceptCount: z.number(),
  lastPlayedAt: nullableNumber,
  playedRecently: z.boolean(),
});
export type IntroPuzzleRow = z.infer<typeof IntroPuzzleRow>;

export const AnswerEvidenceRow = z.object({
  conceptId: z.string(),
  questionId: z.string(),
  sessionId: z.string(),
  submittedAt: z.number(),
  misses: z.number(),
});
export type AnswerEvidenceRow = z.infer<typeof AnswerEvidenceRow>;

const ConceptNameRef = z.object({ conceptId: z.string(), name: z.string() });

export const DecisionRow = z.object({
  id: z.string(),
  kind: z.enum(['recommendation', 'coverage_request']),
  summary: z.string(),
  createdAt: z.number(),
  flags: z.array(z.string()),
  ownerId: z.string(),
  puzzleId: nullableString,
  puzzleName: nullableString,
  targetConceptId: nullableString,
  targetName: nullableString,
  alternatives: z.array(ConceptNameRef),
  coverageTaskId: nullableString,
  /** Goal stretch: the concepts of the linked cover task, and of the goal the decision is toward. */
  coverageConcepts: z.array(ConceptNameRef).default([]),
  goalConcepts: z.array(ConceptNameRef).default([]),
});
export type DecisionRow = z.infer<typeof DecisionRow>;

export const PathRow = z.object({
  part: z.string(),
  fromLabel: z.string(),
  fromId: z.string(),
  fromData: z.record(z.unknown()),
  type: z.string(),
  toLabel: z.string(),
  toId: z.string(),
  toData: z.record(z.unknown()),
  role: nullableString,
  reason: z.string(),
  weight: nullableNumber,
});
export type PathRow = z.infer<typeof PathRow>;

export const GoalConceptRow = z.object({
  conceptId: z.string(),
  slug: z.string(),
  name: z.string(),
  score: z.number(),
  bestChunkId: nullableString,
  via: z.enum(['passage', 'name']),
});
export type GoalConceptRow = z.infer<typeof GoalConceptRow>;

export const UpsertGoalRow = z.object({
  goalId: z.string(),
  targetIds: z.array(z.string()),
  prerequisiteIds: z.array(z.string()),
});
export type UpsertGoalRow = z.infer<typeof UpsertGoalRow>;

export const CoverTaskRow = z.object({
  taskId: z.string(),
  status: z.string(),
  concerns: z.number(),
});
export type CoverTaskRow = z.infer<typeof CoverTaskRow>;

export const RecordDecisionRow = z.object({
  decisionId: z.string(),
  becauseCount: z.number(),
  linkedPuzzle: z.boolean(),
});
export type RecordDecisionRow = z.infer<typeof RecordDecisionRow>;
