import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { ZERO_USAGE } from '@coach/agents/llm';
import { PromptBrief } from '@coach/types';
import {
  Outline,
  type AddStepInput,
  type GeneratedQuestionWrite,
  type ChunkWrite,
  type ConceptWrite,
  type CuratorGraphPort,
  type KnownConcept,
  type QuestionWrite,
  type SourceRead,
  type StepName,
  type StepRow,
  type TaskPatch,
  type TaskRow,
  type TaskStatusName,
  type TaskUpdate,
  type Usage,
} from '@coach/agents/curator';
import { GraphKit, type QueryParams } from '@coach/graph-kit';
import {
  AddStepRow,
  ChunkEmbeddingRow,
  ConceptRefRow,
  CycleRow,
  LinkedRow,
  LoadTaskRow,
  NeighbourhoodRow,
  OpenTaskRow,
  PuzzleCreatedRow,
  SourceByFingerprintRow,
  SourceChunkRow,
  SourceIdRow,
  SourceListRow,
  TaskCreatedRow,
  TaskUpdatedRow,
  WrittenRow,
} from './curator.rows';
import { SourceDetailRow } from './source-detail.row';

/**
 * The Curator's access to the graph: one method per named query, mapping rows to the port's types. It implements the
 * pipeline's port and adds the writes and reads that the request-facing services need. Times are epoch milliseconds.
 */
@Injectable()
export class CuratorGraph implements CuratorGraphPort {
  constructor(@Inject(GraphKit) private readonly graph: GraphKit) {}

  private async rows<S extends z.ZodTypeAny>(
    name: string,
    params: QueryParams,
    schema: S,
  ): Promise<Array<z.output<S>>> {
    const rows = await this.graph.query(name, params);
    return rows.map((row) => schema.parse(row) as z.output<S>);
  }

  // ─── Task and step lifecycle ───────────────────────────────────────────────

  /** Pipeline use only: there is no access check. Request handlers read through TaskReadQueries. */
  async loadTask(id: string): Promise<(TaskRow & { steps: StepRow[] }) | null> {
    const [row] = await this.rows('load_task', { id }, LoadTaskRow);
    if (!row) return null;
    const steps: StepRow[] = row.steps
      .filter((s) => s.stepId !== null && s.order !== null)
      .map((s) => ({
        stepId: s.stepId!,
        node: s.node as StepName,
        status: s.status as StepRow['status'],
        log: s.log,
        usage: usageOf(s),
        startedAt: s.startedAt ?? 0,
        finishedAt: s.finishedAt,
        order: s.order!,
      }))
      .sort((a, b) => a.order - b.order);
    return { ...toTaskRow(row), steps };
  }

  async createTask(input: {
    id: string;
    kind: 'ingest' | 'generate';
    requesterId: string;
    sourceId: string;
    now: number;
  }): Promise<boolean> {
    const rows = await this.rows('create_task', input, TaskCreatedRow);
    return rows.length > 0;
  }

  /** Pipeline use only (start-up resume): the open tasks of the given kinds, oldest first. */
  async openTasks(statuses: string[], kinds: string[]): Promise<OpenTaskRow[]> {
    return this.rows('open_tasks', { statuses, kinds }, OpenTaskRow);
  }

  async updateTask(
    id: string,
    expected: readonly TaskStatusName[],
    patch: TaskPatch,
    now: number,
  ): Promise<TaskUpdate | null> {
    const [row] = await this.rows(
      'update_task',
      { id, expectedStatuses: [...expected], patch: patch as QueryParams, now },
      TaskUpdatedRow,
    );
    return row ? { ...row, lastCompletedStep: row.lastCompletedStep as StepName | null } : null;
  }

  async addStep(input: AddStepInput): Promise<Usage> {
    const [row] = await this.rows(
      'add_step',
      {
        taskId: input.taskId,
        id: input.id,
        node: input.node,
        status: input.status,
        log: input.log,
        order: input.order,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
        usage: { ...input.usage },
      },
      AddStepRow,
    );
    if (!row) throw new Error(`Task ${input.taskId} does not exist`);
    return usageOf(row);
  }

  // ─── Sources and chunks ────────────────────────────────────────────────────

  async sourceChunks(sourceId: string): Promise<SourceRead | null> {
    const rows = await this.rows('source_chunks', { sourceId }, SourceChunkRow);
    const first = rows[0];
    if (!first) return null;
    return {
      source: {
        title: first.sourceTitle,
        kind: first.sourceKind,
        content: first.sourceContent,
        brief: parseJson(first.sourceBrief, PromptBrief),
        // An outline that no longer parses is treated as missing: the run plans again.
        outline: parseJson(first.sourceOutline, Outline),
      },
      chunks: rows
        .filter((r) => r.id !== null)
        .map((r) => ({
          id: r.id!,
          position: r.position ?? 0,
          text: r.text ?? '',
          hasEmbedding: r.hasEmbedding,
          concepts: r.concepts
            .filter((c) => c.id !== null && c.slug !== null)
            .map((c) => ({
              id: c.id!,
              slug: c.slug!,
              name: c.name ?? c.slug!,
              description: c.description ?? '',
            })),
        })),
    };
  }

  async saveOutline(sourceId: string, outline: Outline): Promise<void> {
    const rows = await this.rows(
      'save_outline',
      { sourceId, outline: JSON.stringify(outline) },
      SourceIdRow,
    );
    if (rows.length === 0) throw new Error(`Prompt source ${sourceId} does not exist`);
  }

  async chunkEmbeddings(sourceId: string): Promise<Array<{ id: string; embedding: number[] }>> {
    return this.rows('chunk_embeddings', { sourceId }, ChunkEmbeddingRow);
  }

  async addChunks(sourceId: string, chunks: ChunkWrite[]): Promise<number> {
    const [row] = await this.rows(
      'add_chunks',
      { sourceId, chunks: chunks as unknown as QueryParams[] },
      WrittenRow,
    );
    return row?.written ?? 0;
  }

  async conceptNeighbourhood(
    embedding: number[],
    opts: { fetchK: number; maxDistance: number },
  ): Promise<KnownConcept[]> {
    return this.rows(
      'concept_neighbourhood',
      { embedding, fetchK: opts.fetchK, maxDistance: opts.maxDistance },
      NeighbourhoodRow,
    );
  }

  async upsertConcepts(
    taskId: string,
    concepts: ConceptWrite[],
    now: number,
  ): Promise<Array<{ conceptId: string; slug: string }>> {
    return this.rows(
      'upsert_concepts',
      { taskId, concepts: concepts as unknown as QueryParams[], now },
      ConceptRefRow,
    );
  }

  async wouldCreateCycle(fromSlug: string, toSlug: string): Promise<boolean> {
    const [row] = await this.rows('would_create_cycle', { fromSlug, toSlug }, CycleRow);
    return row?.wouldCycle ?? false;
  }

  async linkPrerequisite(fromSlug: string, toSlug: string, confidence: number): Promise<boolean> {
    const [row] = await this.rows('link_prerequisite', { fromSlug, toSlug, confidence }, LinkedRow);
    return row?.linked ?? false;
  }

  async createDraftPuzzle(input: {
    id: string;
    ownerId: string;
    sourceId: string;
    taskId: string;
    name: string;
    origin: 'upload' | 'prompt';
    now: number;
  }): Promise<void> {
    const rows = await this.rows('create_draft_puzzle', input, PuzzleCreatedRow);
    if (rows.length === 0)
      throw new Error('The draft puzzle could not be created: owner, source, or task is missing');
  }

  async createDraftQuestions(
    puzzleId: string,
    taskId: string,
    questions: QuestionWrite[],
    now: number,
  ): Promise<number> {
    const [row] = await this.rows(
      'create_draft_questions',
      { puzzleId, taskId, questions: questions as unknown as QueryParams[], now },
      WrittenRow,
    );
    return row?.written ?? 0;
  }

  async createGeneratedQuestions(
    puzzleId: string,
    taskId: string,
    sourceId: string,
    questions: GeneratedQuestionWrite[],
    now: number,
  ): Promise<number> {
    const [row] = await this.rows(
      'create_generated_questions',
      {
        puzzleId,
        taskId,
        sourceId,
        questions: questions.map((question) => ({
          ...question,
          critique: JSON.stringify(question.critique),
        })) as unknown as QueryParams[],
        now,
      },
      WrittenRow,
    );
    return row?.written ?? 0;
  }

  // ─── Intake and listing (request-facing services) ─────────────────────────

  async sourceByFingerprint(ownerId: string, fingerprint: string) {
    const [row] = await this.rows(
      'source_by_fingerprint',
      { ownerId, fingerprint },
      SourceByFingerprintRow,
    );
    return row ?? null;
  }

  async createSource(input: {
    id: string;
    ownerId: string;
    title: string;
    kind: string;
    fingerprint: string | null;
    content: string | null;
    brief: string | null;
    now: number;
  }): Promise<boolean> {
    const rows = await this.rows('create_source', input, SourceIdRow);
    return rows.length > 0;
  }

  /** Only the caller's id goes to the query (callerParams): the sources they own or were given. */
  async listSources(userId: string): Promise<SourceListRow[]> {
    return this.rows('list_sources', { userId }, SourceListRow);
  }

  /** The source with its text or brief when the caller passes canReadSource (owner, or shared with the source). */
  async getSource(sourceId: string, userId: string): Promise<SourceDetailRow | null> {
    const [row] = await this.rows('get_source', { sourceId, userId }, SourceDetailRow);
    return row ?? null;
  }
}

function parseJson<S extends z.ZodTypeAny>(text: string | null, schema: S): z.output<S> | null {
  if (text === null) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? (parsed.data as z.output<S>) : null;
  } catch {
    return null;
  }
}

function usageOf(source: {
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  embeddingTokens: number;
}): Usage {
  return {
    ...ZERO_USAGE,
    modelCalls: source.modelCalls,
    inputTokens: source.inputTokens,
    outputTokens: source.outputTokens,
    embeddingTokens: source.embeddingTokens,
  };
}

export function toTaskRow(row: z.output<typeof LoadTaskRow>): TaskRow {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    result: row.result,
    error: row.error,
    lastCompletedStep: row.lastCompletedStep as StepName | null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    usage: usageOf(row),
    requesterId: row.requesterId,
    sourceId: row.sourceId,
    puzzleId: row.puzzleId,
    puzzleStatus: row.puzzleStatus,
    concepts: row.concepts,
    questions: row.questions,
  };
}
