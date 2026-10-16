// Public surface of the Coach agent (contracts/coach-internal.md section 1).
export * from './constants';
export type { CoachFlag } from './flags';
export { CoachSettingsSchema, DEFAULT_COACH_SETTINGS, type CoachSettings } from './settings';
export { computeRisk, daysSince, round4 } from './risk';
export * from './rows';
export {
  createCoachQueries,
  type CoachQueries,
  type QueryFn,
  type RecordDecisionParams,
  type RecordDecisionResult,
} from './queries';
export type { CoachDeps, CoachInput, CoachLogger, CoachNode, CoachResult } from './deps';
export {
  CoachState,
  type CoachOutcome,
  type CoachStateType,
  type EvidenceItem,
  type EvidenceRole,
  type PuzzleChoice,
  type SelectedConcept,
  type Selection,
  type SelectionKind,
  type Signals,
} from './state';
export { selectTarget } from './select';
export { buildEvidence, type BuildEvidenceInput } from './evidence';
export { renderSummary, type AllowanceReason, type SummaryInput } from './summary';
export { buildDecisionPath, type DecisionPath, type PathEdge, type PathNode } from './path';
export { DecisionNotRecordedError, EvidenceMissingError, LearnerNotFoundError } from './errors';
export { normaliseGoal } from './nodes/check-recent';
export { phraseSummary, type PhraseResult } from './phrase';
export { goalSelection } from './goal';
export { coverTaskId, goalId, deterministicId } from './ids';
export type { GoalConcept, ResolvedGoal } from './state';
export {
  buildCoachGraph,
  routeAfterCheckRecent,
  routeAfterCollectSignals,
  routeAfterFindPuzzles,
  routeAfterRecordDecision,
  runCoach,
} from './graph';
