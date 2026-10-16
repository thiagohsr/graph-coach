// Test doubles for the Coach: stub queries that record every call, the worked example as query rows, and a
// recording usage tracer that can be set to throw.
import type { RunHandle, RunKind, StepHandle, UsageTracer } from '../../llm/usage-tracer';
import type { CoachQueries, RecordDecisionParams } from '../queries';
import { computeRisk, round4 } from '../risk';
import type {
  AnswerEvidenceRow,
  IntroPuzzleRow,
  PuzzleRow,
  RecentDecisionRow,
  WeakRow,
} from '../rows';

const DAY = 86_400_000;

/** The seed time T of the worked example (2026-10-11T12:00:00Z). */
export const T = Date.parse('2026-10-11T12:00:00Z');

export const WORKED_IDS = {
  learner: 'learner-1',
  btrees: 'c-b-trees',
  indexes: 'c-indexes',
  tablesRowsColumns: 'c-tables-rows-columns',
  storagePuzzle: 'p-storage',
  indexesPuzzle: 'p-indexes',
  sessionA: 's-A',
  sessionB: 's-B',
  sessionC: 's-C',
} as const;

const weak = (
  conceptId: string,
  slug: string,
  name: string,
  score: number,
  attempts: number,
  days: number,
  weakestPrereq: WeakRow['weakestPrereq'],
): WeakRow => ({
  conceptId,
  slug,
  name,
  score,
  attempts,
  lastSeen: T - days * DAY,
  daysSince: days,
  risk: computeRisk(score, days, 14),
  weakestPrereq,
  cyclic: false,
});

export interface WorkedExampleRows {
  recent: RecentDecisionRow;
  weak: WeakRow[];
  puzzles: PuzzleRow[];
  answers: AnswerEvidenceRow[];
}

/** The seeded scenario of the plan's "Worked example" as the rows the queries return. */
export function workedExampleRows(): WorkedExampleRows {
  const btrees = weak(WORKED_IDS.btrees, 'b-trees', 'B-trees', 0.12005, 4, 9, {
    conceptId: WORKED_IDS.tablesRowsColumns,
    slug: 'tables-rows-columns',
    name: 'Tables, rows and columns',
    distance: 2,
    score: 0.8285,
    attempts: 3,
    lastSeen: T - 12 * DAY,
    daysSince: 12,
    risk: computeRisk(0.8285, 12, 14),
  });
  const indexes = weak(WORKED_IDS.indexes, 'indexes', 'Indexes', 0.2562455, 6, 1, {
    conceptId: WORKED_IDS.btrees,
    slug: 'b-trees',
    name: 'B-trees',
    distance: 1,
    score: 0.12005,
    attempts: 4,
    lastSeen: T - 9 * DAY,
    daysSince: 9,
    risk: computeRisk(0.12005, 9, 14),
  });
  return {
    recent: {
      masteryCount: 13,
      decisionId: null,
      createdAt: null,
      newAnswers: false,
      goalText: null,
    },
    weak: [btrees, indexes],
    puzzles: [
      {
        puzzleId: WORKED_IDS.storagePuzzle,
        name: 'Databases 101: Storage and B-trees',
        overlap: 2,
        coveredTargetIds: [WORKED_IDS.btrees],
        targetQuestions: 4,
        lastPlayedAt: T - 9 * DAY,
        playedRecently: false,
      },
      {
        puzzleId: WORKED_IDS.indexesPuzzle,
        name: 'Databases 101: Indexes and Query Planning',
        overlap: 1,
        coveredTargetIds: [],
        targetQuestions: 0,
        lastPlayedAt: T - 1 * DAY,
        playedRecently: true,
      },
    ],
    answers: [
      // Newest first, as the query orders them. Sessions B and C: questions 2 and 3 of Indexes and Query Planning.
      {
        conceptId: WORKED_IDS.indexes,
        questionId: 'q-ix-2',
        sessionId: WORKED_IDS.sessionC,
        submittedAt: T - 1 * DAY,
        misses: 1,
      },
      {
        conceptId: WORKED_IDS.indexes,
        questionId: 'q-ix-3',
        sessionId: WORKED_IDS.sessionC,
        submittedAt: T - 1 * DAY,
        misses: 1,
      },
      {
        conceptId: WORKED_IDS.indexes,
        questionId: 'q-ix-2',
        sessionId: WORKED_IDS.sessionB,
        submittedAt: T - 2 * DAY,
        misses: 1,
      },
      {
        conceptId: WORKED_IDS.indexes,
        questionId: 'q-ix-3',
        sessionId: WORKED_IDS.sessionB,
        submittedAt: T - 2 * DAY,
        misses: 1,
      },
      // Session A: questions 3 to 6 of Storage and B-trees.
      {
        conceptId: WORKED_IDS.btrees,
        questionId: 'q-bt-3',
        sessionId: WORKED_IDS.sessionA,
        submittedAt: T - 9 * DAY,
        misses: 1,
      },
      {
        conceptId: WORKED_IDS.btrees,
        questionId: 'q-bt-4',
        sessionId: WORKED_IDS.sessionA,
        submittedAt: T - 9 * DAY,
        misses: 1,
      },
      {
        conceptId: WORKED_IDS.btrees,
        questionId: 'q-bt-5',
        sessionId: WORKED_IDS.sessionA,
        submittedAt: T - 9 * DAY,
        misses: 1,
      },
      {
        conceptId: WORKED_IDS.btrees,
        questionId: 'q-bt-6',
        sessionId: WORKED_IDS.sessionA,
        submittedAt: T - 9 * DAY,
        misses: 1,
      },
    ],
  };
}

export const roundedRisk = (score: number, days: number): number =>
  round4(computeRisk(score, days, 14));

export interface QueryCall {
  name: keyof CoachQueries;
  params: unknown;
}

export interface StubCoachQueries extends CoachQueries {
  readonly calls: QueryCall[];
  /** Parameters of every record_decision call. */
  readonly recorded: RecordDecisionParams[];
  callsTo(name: keyof CoachQueries): QueryCall[];
}

/** Records every call; returns the worked example unless overridden. */
export function createStubCoachQueries(overrides: Partial<CoachQueries> = {}): StubCoachQueries {
  const rows = workedExampleRows();
  const calls: QueryCall[] = [];
  const recorded: RecordDecisionParams[] = [];

  const defaults: CoachQueries = {
    recentDecision: async () => rows.recent,
    weakConceptsWithWeakPrereqs: async () => rows.weak,
    decayedOrUnseenConcepts: async () => [],
    playablePuzzlesCovering: async () => rows.puzzles,
    introPuzzles: async (): Promise<IntroPuzzleRow[]> => [],
    conceptAnswerEvidence: async () => rows.answers,
    recordDecision: async (p) => ({
      decisionId: p.decisionId,
      becauseCount: p.evidence.length,
      linkedPuzzle: p.puzzleId !== '',
    }),
    getDecision: async () => null,
    decisionPath: async () => [],
    resolveGoalConcepts: async () => [],
    upsertGoal: async (p) =>
      p.targets.length === 0
        ? null
        : { goalId: p.goalId, targetIds: p.targets.map((t) => t.conceptId), prerequisiteIds: [] },
    createCoverTask: async (p) => ({
      taskId: p.taskId,
      status: 'queued',
      concerns: p.conceptIds.length,
    }),
  };

  const merged = { ...defaults, ...overrides } as CoachQueries;
  const wrapped = {} as Record<string, unknown>;
  for (const name of Object.keys(defaults) as Array<keyof CoachQueries>) {
    wrapped[name] = async (params: never) => {
      calls.push({ name, params });
      if (name === 'recordDecision') recorded.push(params as RecordDecisionParams);
      return (merged[name] as (p: never) => Promise<unknown>)(params);
    };
  }
  return Object.assign(wrapped as unknown as CoachQueries, {
    calls,
    recorded,
    callsTo: (name: keyof CoachQueries) => calls.filter((c) => c.name === name),
  });
}

export interface TracerCall {
  method: 'startRun' | 'startStep' | 'recordCall' | 'endStep' | 'endRun' | 'flush';
  args: unknown[];
}

export interface RecordingTracer extends UsageTracer {
  readonly calls: TracerCall[];
  /** When set, every tracer method throws this error (after recording the call). */
  failWith: Error | null;
  callsTo(method: TracerCall['method']): TracerCall[];
}

/** A UsageTracer that records the arguments of every call and can be set to throw. */
export function createRecordingTracer(): RecordingTracer {
  const calls: TracerCall[] = [];
  const tracer: RecordingTracer = {
    enabled: true,
    calls,
    failWith: null,
    callsTo: (method) => calls.filter((c) => c.method === method),
    startRun(run: { id: string; kind: RunKind; userId: string }): RunHandle {
      calls.push({ method: 'startRun', args: [run] });
      if (tracer.failWith) throw tracer.failWith;
      return { runId: run.id };
    },
    startStep(run: RunHandle, node: string): StepHandle {
      calls.push({ method: 'startStep', args: [run, node] });
      if (tracer.failWith) throw tracer.failWith;
      return { runId: run.runId, node };
    },
    recordCall(...args: Parameters<UsageTracer['recordCall']>): void {
      calls.push({ method: 'recordCall', args });
      if (tracer.failWith) throw tracer.failWith;
    },
    endStep(...args: Parameters<UsageTracer['endStep']>): void {
      calls.push({ method: 'endStep', args });
      if (tracer.failWith) throw tracer.failWith;
    },
    endRun(...args: Parameters<UsageTracer['endRun']>): void {
      calls.push({ method: 'endRun', args });
      if (tracer.failWith) throw tracer.failWith;
    },
    async flush(): Promise<void> {
      calls.push({ method: 'flush', args: [] });
    },
  };
  return tracer;
}
