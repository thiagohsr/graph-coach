// Row schemas of the named queries owned by 005 (packages/graph-kit/queries/*.cypher). Used with GraphKit.query.
import { z } from 'zod';

/** Counters written by add_step are always numbers, but a task created elsewhere may lack them. */
const count = z
  .number()
  .nullish()
  .transform((n) => n ?? 0);
const nullableString = z
  .string()
  .nullish()
  .transform((s) => s ?? null);

const taskColumns = {
  id: z.string(),
  kind: z.enum(['ingest', 'generate', 'cover']),
  status: z.enum(['queued', 'in_progress', 'awaiting_review', 'done', 'failed']),
  result: z
    .enum(['ok', 'nothing_usable', 'below_minimum'])
    .nullish()
    .transform((r) => r ?? null),
  error: nullableString,
  lastCompletedStep: nullableString,
  createdAt: z.number(),
  updatedAt: z.number(),
  modelCalls: count,
  inputTokens: count,
  outputTokens: count,
  embeddingTokens: count,
  requesterId: nullableString,
  sourceId: nullableString,
  puzzleId: nullableString,
  puzzleStatus: z
    .enum(['draft', 'published'])
    .nullish()
    .transform((s) => s ?? null),
  concepts: count,
  questions: count,
};

export const TaskReadRow = z.object(taskColumns);
export type TaskReadRow = z.infer<typeof TaskReadRow>;

/** A step as the task queries return it: a map of nulls when the task has no step yet. */
const LoadedStep = z.object({
  stepId: nullableString,
  node: nullableString,
  status: nullableString,
  log: nullableString,
  modelCalls: count,
  inputTokens: count,
  outputTokens: count,
  embeddingTokens: count,
  startedAt: z
    .number()
    .nullish()
    .transform((n) => n ?? null),
  finishedAt: z
    .number()
    .nullish()
    .transform((n) => n ?? null),
  order: z
    .number()
    .nullish()
    .transform((n) => n ?? null),
});

export const LoadTaskRow = z.object({ ...taskColumns, steps: z.array(LoadedStep) });
export type LoadTaskRow = z.infer<typeof LoadTaskRow>;

export const StepReadRow = z.object({
  stepId: z.string(),
  node: z.string(),
  status: z.enum(['active', 'complete', 'error']),
  log: nullableString,
  modelCalls: count,
  inputTokens: count,
  outputTokens: count,
  embeddingTokens: count,
  startedAt: z.number(),
  finishedAt: z
    .number()
    .nullish()
    .transform((n) => n ?? null),
  order: z.number(),
});
export type StepReadRow = z.infer<typeof StepReadRow>;

/** open_tasks: INTERNAL, for start-up resume. */
export const OpenTaskRow = z.object({
  id: z.string(),
  kind: z.enum(['ingest', 'generate', 'cover']),
  status: z.enum(['queued', 'in_progress', 'awaiting_review', 'done', 'failed']),
  lastCompletedStep: nullableString,
  requesterId: nullableString,
  sourceId: nullableString,
});
export type OpenTaskRow = z.infer<typeof OpenTaskRow>;

/** An open `cover` task with the concepts it concerns (open_tasks returns them; the start-up resume ignores them). */
export const CoverTaskRow = OpenTaskRow.extend({ conceptIds: z.array(z.string()) });
export type CoverTaskRow = z.infer<typeof CoverTaskRow>;

export const CoverConceptRow = z.object({ id: z.string(), name: z.string(), description: z.string() });
export type CoverConceptRow = z.infer<typeof CoverConceptRow>;

export const TaskCreatedRow = z.object({ taskId: z.string(), status: z.string() });

export const TaskUpdatedRow = z.object({
  taskId: z.string(),
  status: z.enum(['queued', 'in_progress', 'awaiting_review', 'done', 'failed']),
  result: z
    .enum(['ok', 'nothing_usable', 'below_minimum'])
    .nullish()
    .transform((r) => r ?? null),
  error: nullableString,
  lastCompletedStep: nullableString,
});

export const AddStepRow = z.object({
  stepId: z.string(),
  status: z.string(),
  modelCalls: count,
  inputTokens: count,
  outputTokens: count,
  embeddingTokens: count,
});

export const SourceChunkRow = z.object({
  sourceTitle: z.string(),
  sourceKind: z.enum(['text', 'markdown', 'url', 'prompt']),
  sourceContent: nullableString,
  /** JSON strings; set on prompt sources only. */
  sourceBrief: nullableString,
  sourceOutline: nullableString,
  id: nullableString,
  position: z
    .number()
    .nullish()
    .transform((n) => n ?? null),
  text: nullableString,
  hasEmbedding: z
    .boolean()
    .nullish()
    .transform((b) => b ?? false),
  concepts: z.array(
    z.object({
      id: nullableString,
      slug: nullableString,
      name: nullableString,
      description: nullableString,
    }),
  ),
});

export const ChunkEmbeddingRow = z.object({ id: z.string(), embedding: z.array(z.number()) });

export const WrittenRow = z.object({ written: z.number() });

export const NeighbourhoodRow = z.object({
  conceptId: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z
    .string()
    .nullish()
    .transform((s) => s ?? ''),
});

export const ConceptRefRow = z.object({ conceptId: z.string(), slug: z.string() });
export const CycleRow = z.object({ wouldCycle: z.boolean() });
export const LinkedRow = z.object({ linked: z.boolean() });
export const PuzzleCreatedRow = z.object({ puzzleId: z.string(), status: z.string() });

export const SourceIdRow = z.object({ sourceId: z.string() });

export const SourceByFingerprintRow = z.object({
  sourceId: z.string(),
  taskId: nullableString,
  taskStatus: nullableString,
});

export const SourceListRow = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.enum(['text', 'markdown', 'url', 'prompt']),
  createdAt: z.number(),
  access: z.enum(['owner', 'shared']),
  ownerName: z
    .string()
    .nullish()
    .transform((s) => s ?? ''),
  chunkCount: count,
  conceptCount: count,
  puzzleId: nullableString,
  taskId: nullableString,
  taskStatus: z
    .enum(['queued', 'in_progress', 'awaiting_review', 'done', 'failed'])
    .nullish()
    .transform((s) => s ?? null),
});
export type SourceListRow = z.infer<typeof SourceListRow>;

export const RemainingRow = z.object({
  remaining: z.number(),
  approved: z.number(),
  rejected: z.number(),
});

export const PublishedRow = z.object({
  id: z.string(),
  status: z.enum(['draft', 'published']),
  visibility: z.enum(['private', 'public']),
  origin: z.enum(['upload', 'prompt']),
  approved: z.number(),
});
