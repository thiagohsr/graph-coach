// What the pipeline needs from the outside world (contracts/internal-interfaces.md §1.4). The agents package does not
// import NestJS or the graph client: the API passes these in. Times crossing a port are epoch milliseconds.
import type { PromptBrief } from '@coach/types';
import type { ChatProvider, EmbeddingsProvider } from '../llm/types';
import type { Outline } from './prompt/schemas';
import { ZERO_USAGE, addUsage, type Usage } from '../llm/usage';
import type { StepHandle, UsageTracer } from '../llm/usage-tracer';
import type { StepName } from './steps';

export type { Usage } from '../llm/usage';

export type TaskKindName = 'ingest' | 'generate' | 'cover';
export type TaskStatusName = 'queued' | 'in_progress' | 'awaiting_review' | 'done' | 'failed';
export type TaskResultName = 'ok' | 'nothing_usable' | 'below_minimum';
export type StepStatusName = 'active' | 'complete' | 'error';
export type SourceKindName = 'text' | 'markdown' | 'url' | 'prompt';

export const ALL_TASK_STATUSES: readonly TaskStatusName[] = [
  'queued',
  'in_progress',
  'awaiting_review',
  'done',
  'failed',
];

// ─── Rows ────────────────────────────────────────────────────────────────────

export interface StepRow {
  stepId: string;
  node: StepName;
  status: StepStatusName;
  log: string | null;
  usage: Usage;
  startedAt: number;
  finishedAt: number | null;
  order: number;
}

export interface TaskRow {
  id: string;
  kind: TaskKindName;
  status: TaskStatusName;
  result: TaskResultName | null;
  error: string | null;
  lastCompletedStep: StepName | null;
  createdAt: number;
  updatedAt: number;
  usage: Usage;
  requesterId: string | null;
  sourceId: string | null;
  puzzleId: string | null;
  puzzleStatus: 'draft' | 'published' | null;
  concepts: number;
  questions: number;
}

export interface TaskPatch {
  status?: TaskStatusName;
  result?: TaskResultName | null;
  error?: string | null;
  lastCompletedStep?: StepName | null;
}

/** What `update_task` returns for the row it changed. */
export interface TaskUpdate {
  taskId: string;
  status: TaskStatusName;
  result: TaskResultName | null;
  error: string | null;
  lastCompletedStep: StepName | null;
}

export interface AddStepInput {
  taskId: string;
  id: string;
  node: StepName;
  status: StepStatusName;
  log: string;
  order: number;
  startedAt: number;
  finishedAt: number | null;
  usage: Usage;
}

export interface KnownConcept {
  conceptId: string;
  slug: string;
  name: string;
  description: string;
}

export interface ChunkConcept {
  id: string;
  slug: string;
  name: string;
  description: string;
}

export interface ChunkRow {
  id: string;
  position: number;
  text: string;
  hasEmbedding: boolean;
  concepts: ChunkConcept[];
}

export interface SourceRead {
  source: {
    title: string;
    kind: SourceKindName;
    content: string | null;
    /** Prompt sources only. */
    brief: PromptBrief | null;
    /** Prompt sources only, once the planner has run. Internal: no endpoint returns it. */
    outline: Outline | null;
  };
  chunks: ChunkRow[];
}

export interface ChunkWrite {
  id: string;
  position: number;
  text: string;
  prevId: string | null;
  embedding: number[] | null;
}

export interface ConceptWrite {
  id: string;
  slug: string;
  name: string;
  description: string;
  chunkIds: string[];
}

export interface QuestionWrite {
  id: string;
  sentence: string;
  answers: string[];
  distractors: string[];
  order: number;
  chunkId: string;
  conceptSlugs: string[];
}

/** A prompt question: no chunk. `critique` is stored as a JSON string by the port. */
export interface GeneratedQuestionWrite {
  id: string;
  sentence: string;
  answers: string[];
  distractors: string[];
  order: number;
  conceptSlugs: string[];
  critique: { verdict: 'pass'; note: string; rewritten: boolean };
}

// ─── The graph port ──────────────────────────────────────────────────────────

/** A thin wrapper over the named queries, one method each. Nothing here is request-facing. */
export interface CuratorGraphPort {
  /** Internal read with no access check: pipeline use only. */
  loadTask(id: string): Promise<(TaskRow & { steps: StepRow[] }) | null>;
  /** Null when the expected status did not match. */
  updateTask(
    id: string,
    expected: readonly TaskStatusName[],
    patch: TaskPatch,
    now: number,
  ): Promise<TaskUpdate | null>;
  /** Writes (or replaces) one step and returns the task's usage totals, recomputed as the sum over its steps. */
  addStep(input: AddStepInput): Promise<Usage>;

  sourceChunks(sourceId: string): Promise<SourceRead | null>;
  /** Repository write of `Source.outline` (a JSON string), prompt runs only. */
  saveOutline(sourceId: string, outline: Outline): Promise<void>;
  chunkEmbeddings(sourceId: string): Promise<Array<{ id: string; embedding: number[] }>>;
  addChunks(sourceId: string, chunks: ChunkWrite[]): Promise<number>;
  /** No access parameters: returns concept fields only. */
  conceptNeighbourhood(
    embedding: number[],
    opts: { fetchK: number; maxDistance: number },
  ): Promise<KnownConcept[]>;
  upsertConcepts(
    taskId: string,
    concepts: ConceptWrite[],
    now: number,
  ): Promise<Array<{ conceptId: string; slug: string }>>;
  wouldCreateCycle(fromSlug: string, toSlug: string): Promise<boolean>;
  linkPrerequisite(fromSlug: string, toSlug: string, confidence: number): Promise<boolean>;
  createDraftPuzzle(input: {
    id: string;
    ownerId: string;
    sourceId: string;
    taskId: string;
    name: string;
    origin: 'upload' | 'prompt';
    now: number;
  }): Promise<void>;
  createDraftQuestions(
    puzzleId: string,
    taskId: string,
    questions: QuestionWrite[],
    now: number,
  ): Promise<number>;
  /** Prompt runs: the counterpart of createDraftQuestions, linked to the source instead of a chunk. */
  createGeneratedQuestions(
    puzzleId: string,
    taskId: string,
    sourceId: string,
    questions: GeneratedQuestionWrite[],
    now: number,
  ): Promise<number>;
}

// ─── Step recording ──────────────────────────────────────────────────────────

/** 005's stored-step handle; `StepHandle` (from ../llm) is the tracer's handle for the same step. */
export interface StepRecord {
  taskId: string;
  stepId: string;
  node: StepName;
  order: number;
  attempt: number;
  startedAt: number;
}

export interface StepRecorder {
  /** Step 'active' stored, then the event. */
  begin(taskId: string, node: StepName): Promise<StepRecord>;
  /** Live event only. */
  progress(handle: StepRecord, log: string): void;
  /** Step 'complete' with its usage, task totals recomputed, Task.lastCompletedStep set. */
  complete(
    handle: StepRecord,
    log: string,
    usage: Usage,
    counts?: Record<string, number>,
  ): Promise<void>;
  /** Step 'error' with the usage of the calls made before the failure. */
  fail(handle: StepRecord, error: CuratorStepError, usage: Usage): Promise<void>;
}

export class UsageMeter {
  private sum: Usage = { ...ZERO_USAGE };

  add(usage: Usage): void {
    this.sum = addUsage(this.sum, usage);
  }

  total(): Usage {
    return { ...this.sum };
  }
}

/** What `withStep` gives a node. */
export interface StepContext {
  meter: UsageMeter;
  trace: StepHandle;
  record: StepRecord;
  /** A live progress line (event only, nothing stored). */
  progress(log: string): void;
}

// ─── Dependencies ────────────────────────────────────────────────────────────

export interface CuratorParams {
  chunkSizeChars: number;
  chunkOverlapChars: number;
}

export interface CuratorDeps {
  graph: CuratorGraphPort;
  chat: ChatProvider;
  embeddings: EmbeddingsProvider;
  recorder: StepRecorder;
  tracer: UsageTracer;
  /** Bound to the accounts service. False = blocked or unknown. */
  isActive: (userId: string) => Promise<boolean>;
  params: CuratorParams;
  /** Epoch milliseconds. */
  now: () => number;
  /** Test hook: overrides STEP_TIMEOUT_MS. */
  stepTimeoutMs?: number;
}

export type CuratorErrorCode =
  | 'PROVIDER_UNAVAILABLE'
  | 'INVALID_MODEL_OUTPUT'
  | 'GRAPH_UNAVAILABLE'
  | 'STEP_TIMEOUT'
  | 'INCONSISTENT_STATE'
  | 'ACCOUNT_BLOCKED';

/** `code` is written into `Task.error` as "<node>: <CODE>: <message>"; it is not an HTTP error code. */
export class CuratorStepError extends Error {
  constructor(
    readonly node: StepName,
    readonly code: CuratorErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'CuratorStepError';
  }

  /** The string stored in Task.error. Never contains source text or provider output. */
  toTaskError(): string {
    return `${this.node}: ${this.code}: ${this.message}`;
  }
}
