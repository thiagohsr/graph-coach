import { Annotation } from '@langchain/langgraph';
import { ZERO_USAGE, addUsage, type Usage } from '../llm/usage';
import type { CoachFlag } from '@coach/types';
import type { DecayedRow, GoalConceptRow, RecentDecisionRow, WeakRow } from './rows';

export interface Signals {
  tier: 1 | 2 | 3;
  weak: WeakRow[];
  other: DecayedRow[];
}

/** A concept as the selection and the evidence builder see it. Null numbers mean never practised. */
export interface SelectedConcept {
  conceptId: string;
  slug: string;
  name: string;
  score: number | null;
  attempts: number;
  lastSeen: number | null;
  daysSince: number | null;
  risk: number | null;
}

/** `goal`: nothing in the goal's scope had signals or content, so the goal's best concept is the target (stretch). */
export type SelectionKind = 'weak' | 'unseen' | 'decayed' | 'all_mastered' | 'cold_start' | 'goal';

/** A concept the goal resolved to; `score` is a similarity for a passage match, 1 for a name match. */
export interface GoalConcept {
  conceptId: string;
  slug: string;
  name: string;
  score: number;
}

/** The stored goal and what it resolved to (stretch). An unmatched goal has empty `concepts`, `targetIds`, and `scopeIds`. */
export interface ResolvedGoal {
  goalId: string;
  concepts: GoalConcept[];
  targetIds: string[];
  /** Targets plus their upstream prerequisites; limits the candidate queries. */
  scopeIds: string[];
  /** One row per concept matched through a passage (`via = 'passage'`); the only source of `passage` evidence. */
  passages: GoalConceptRow[];
}

export interface Selection {
  kind: SelectionKind;
  target: SelectedConcept;
  /** Weak concepts that depend on the target (never contains the target), highest risk first. */
  drivers: SelectedConcept[];
  /** Other weak groups' targets, best first. `risk` is the group's rank. */
  alternatives: SelectedConcept[];
}

export interface PuzzleChoice {
  puzzleId: string;
  name: string;
  coversTarget: boolean;
  playedRecently: boolean;
}

export type EvidenceRole = 'target' | 'driver' | 'alternative' | 'answer' | 'session' | 'passage';

export interface EvidenceItem {
  label: 'Concept' | 'Session' | 'Question' | 'Chunk';
  nodeId: string;
  role: EvidenceRole;
  reason: string;
  weight: number;
}

export type CoachOutcome = 'reused' | 'recorded' | 'no_content';

const last = <T>(initial: () => T) =>
  Annotation<T>({ reducer: (_current: T, update: T) => update, default: initial });

export const CoachState = Annotation.Root({
  // input
  learnerId: Annotation<string>(),
  goalText: last<string | null>(() => null),
  now: Annotation<number>(),
  runId: Annotation<string>(),
  // working channels (last value wins)
  recent: last<RecentDecisionRow | null>(() => null),
  goal: last<ResolvedGoal | null>(() => null),
  signals: last<Signals | null>(() => null),
  selection: last<Selection | null>(() => null),
  puzzle: last<PuzzleChoice | null>(() => null),
  missingConceptIds: last<string[]>(() => []),
  evidence: last<EvidenceItem[]>(() => []),
  summary: last<string | null>(() => null),
  kind: last<'recommendation' | 'coverage_request'>(() => 'recommendation'),
  flags: Annotation<CoachFlag[]>({
    reducer: (a: CoachFlag[], b: CoachFlag[]) => [...new Set([...a, ...b])].sort() as CoachFlag[],
    default: () => [],
  }),
  usage: Annotation<Usage>({
    reducer: (a: Usage, b: Usage) => addUsage(a, b),
    default: () => ZERO_USAGE,
  }),
  // output
  decisionId: last<string | null>(() => null),
  coverageTaskId: last<string | null>(() => null),
  outcome: last<CoachOutcome | null>(() => null),
});

export type CoachStateType = typeof CoachState.State;
