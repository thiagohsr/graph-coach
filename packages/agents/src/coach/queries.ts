// The query adapter: one method per named query, passing exactly the parameters each file declares
// (GraphKit.query rejects missing and unused ones), empty lists and '' instead of null, rows parsed with rows.ts.
import {
  AnswerEvidenceRow,
  CoverTaskRow,
  DecayedRow,
  DecisionRow,
  GoalConceptRow,
  UpsertGoalRow,
  IntroPuzzleRow,
  PathRow,
  PuzzleRow,
  RecentDecisionRow,
  RecordDecisionRow,
  WeakRow,
} from './rows';
import type { EvidenceItem } from './state';

/** Structural type so this folder does not import graph-kit. Matches GraphKit.query(name, params). */
export type QueryFn = <T = Record<string, unknown>>(name: string, params: Record<string, unknown>) => Promise<T[]>;

export interface RecordDecisionParams {
  decisionId: string;
  learnerId: string;
  kind: 'recommendation' | 'coverage_request';
  summary: string;
  flags: string[];
  now: number;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  embeddingTokens: number;
  /** '' when no puzzle was chosen. */
  puzzleId: string;
  /** '' outside the goal stretch. */
  goalId: string;
  evidence: EvidenceItem[];
}

export interface RecordDecisionResult {
  decisionId: string;
  becauseCount: number;
  linkedPuzzle: boolean;
}

/**
 * In the three puzzle queries `userId` is the learner the Coach decides for (the `$userId` of 002's canPlay fragment).
 * In decisionPath, `learnerId` is the decision's learner and `userId` is the viewer.
 */
export interface CoachQueries {
  recentDecision(p: { learnerId: string; since: number }): Promise<RecentDecisionRow | null>;
  weakConceptsWithWeakPrereqs(p: {
    learnerId: string;
    now: number;
    decayDays: number;
    threshold: number;
    depth: number;
    scopeIds: string[];
  }): Promise<WeakRow[]>;
  decayedOrUnseenConcepts(p: {
    userId: string;
    now: number;
    before: number;
    decayDays: number;
    depth: number;
    scopeIds: string[];
    limit: number;
  }): Promise<DecayedRow[]>;
  playablePuzzlesCovering(p: {
    userId: string;
    targetIds: string[];
    recentSince: number;
    limit: number;
  }): Promise<PuzzleRow[]>;
  introPuzzles(p: { userId: string; recentSince: number; limit: number }): Promise<IntroPuzzleRow[]>;
  conceptAnswerEvidence(p: {
    learnerId: string;
    conceptIds: string[];
    limit: number;
  }): Promise<AnswerEvidenceRow[]>;
  recordDecision(p: RecordDecisionParams): Promise<RecordDecisionResult | null>;
  getDecision(p: { decisionId: string }): Promise<DecisionRow | null>;
  /** `userId` is the viewer. */
  decisionPath(p: { decisionId: string; learnerId: string; userId: string; depth: number }): Promise<PathRow[]>;
  /**
   * Goal stretch. `userId` is the learner; `minSimilarity` is a similarity (the query turns FalkorDB's cosine distance
   * into `1 - distance` before comparing). `goalText` is normalised, `goalSlugText` has hyphens for spaces.
   */
  resolveGoalConcepts(p: {
    userId: string;
    embedding: number[];
    k: number;
    minSimilarity: number;
    goalText: string;
    goalSlugText: string;
    limit: number;
  }): Promise<GoalConceptRow[]>;
  /** Null when `targets` is empty (the goal is still written). */
  upsertGoal(p: {
    goalId: string;
    learnerId: string;
    text: string;
    now: number;
    targets: Array<{ conceptId: string; score: number }>;
    depth: number;
  }): Promise<UpsertGoalRow | null>;
  /** Null when the decision does not belong to the learner. */
  createCoverTask(p: {
    taskId: string;
    learnerId: string;
    decisionId: string;
    conceptIds: string[];
    now: number;
  }): Promise<CoverTaskRow | null>;
}

function parseRows<T>(schema: { parse(value: unknown): T }, rows: unknown[]): T[] {
  return rows.map((row) => schema.parse(row));
}

export function createCoachQueries(query: QueryFn): CoachQueries {
  return {
    async recentDecision(p) {
      const rows = await query('recent_decision', { learnerId: p.learnerId, since: p.since });
      const [row] = parseRows(RecentDecisionRow, rows);
      return row ?? null;
    },
    async weakConceptsWithWeakPrereqs(p) {
      const rows = await query('weak_concepts_with_weak_prereqs', {
        learnerId: p.learnerId,
        now: p.now,
        decayDays: p.decayDays,
        threshold: p.threshold,
        depth: p.depth,
        scopeIds: p.scopeIds,
      });
      return parseRows(WeakRow, rows);
    },
    async decayedOrUnseenConcepts(p) {
      const rows = await query('decayed_or_unseen_concepts', {
        userId: p.userId,
        now: p.now,
        before: p.before,
        decayDays: p.decayDays,
        depth: p.depth,
        scopeIds: p.scopeIds,
        limit: p.limit,
      });
      return parseRows(DecayedRow, rows);
    },
    async playablePuzzlesCovering(p) {
      const rows = await query('playable_puzzles_covering', {
        userId: p.userId,
        targetIds: p.targetIds,
        recentSince: p.recentSince,
        limit: p.limit,
      });
      return parseRows(PuzzleRow, rows);
    },
    async introPuzzles(p) {
      const rows = await query('intro_puzzles', { userId: p.userId, recentSince: p.recentSince, limit: p.limit });
      return parseRows(IntroPuzzleRow, rows);
    },
    async conceptAnswerEvidence(p) {
      const rows = await query('concept_answer_evidence', {
        learnerId: p.learnerId,
        conceptIds: p.conceptIds,
        limit: p.limit,
      });
      return parseRows(AnswerEvidenceRow, rows);
    },
    async recordDecision(p) {
      const rows = await query('record_decision', {
        decisionId: p.decisionId,
        learnerId: p.learnerId,
        kind: p.kind,
        summary: p.summary,
        flags: p.flags,
        now: p.now,
        modelCalls: p.modelCalls,
        inputTokens: p.inputTokens,
        outputTokens: p.outputTokens,
        embeddingTokens: p.embeddingTokens,
        puzzleId: p.puzzleId,
        goalId: p.goalId,
        evidence: p.evidence.map((e) => ({
          label: e.label,
          nodeId: e.nodeId,
          role: e.role,
          reason: e.reason,
          weight: e.weight,
        })),
      });
      const [row] = parseRows(RecordDecisionRow, rows);
      return row ?? null;
    },
    async getDecision(p) {
      const rows = await query('get_decision', { decisionId: p.decisionId });
      const [row] = parseRows(DecisionRow, rows);
      return row ?? null;
    },
    async decisionPath(p) {
      const rows = await query('decision_path', {
        decisionId: p.decisionId,
        learnerId: p.learnerId,
        userId: p.userId,
        depth: p.depth,
      });
      return parseRows(PathRow, rows);
    },
    async resolveGoalConcepts(p) {
      const rows = await query('resolve_goal_concepts', {
        userId: p.userId,
        embedding: p.embedding,
        k: p.k,
        minSimilarity: p.minSimilarity,
        goalText: p.goalText,
        goalSlugText: p.goalSlugText,
        limit: p.limit,
      });
      return parseRows(GoalConceptRow, rows);
    },
    async upsertGoal(p) {
      const rows = await query('upsert_goal', {
        goalId: p.goalId,
        learnerId: p.learnerId,
        text: p.text,
        now: p.now,
        targets: p.targets.map((t) => ({ conceptId: t.conceptId, score: t.score })),
        depth: p.depth,
      });
      const [row] = parseRows(UpsertGoalRow, rows);
      return row ?? null;
    },
    async createCoverTask(p) {
      const rows = await query('create_cover_task', {
        taskId: p.taskId,
        learnerId: p.learnerId,
        decisionId: p.decisionId,
        conceptIds: p.conceptIds,
        now: p.now,
      });
      const [row] = parseRows(CoverTaskRow, rows);
      return row ?? null;
    },
  };
}
