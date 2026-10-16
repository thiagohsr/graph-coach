// In-memory CuratorGraphPort and StepRecorder for agent tests. It keeps the semantics of the real queries: writes are keyed
// (running them twice changes nothing), and task usage is recomputed as the sum of its steps.
import { RecordingUsageTracer } from '../../llm/recording-usage-tracer';
import { ZERO_USAGE, addUsage, type Usage } from '../../llm/usage';
import { stepId } from '../ids';
import {
  ALL_TASK_STATUSES,
  CuratorStepError,
  type AddStepInput,
  type ChunkRow,
  type ChunkWrite,
  type ConceptWrite,
  type CuratorDeps,
  type CuratorGraphPort,
  type GeneratedQuestionWrite,
  type KnownConcept,
  type PuzzleState,
  type QuestionWrite,
  type RemainingCounts,
  type SourceKindName,
  type SourceRead,
  type StepRecord,
  type StepRecorder,
  type StepRow,
  type TaskKindName,
  type TaskPatch,
  type TaskRow,
  type TaskStatusName,
  type TaskUpdate,
} from '../ports';
import type { PromptBrief } from '@coach/types';
import type { Outline } from '../prompt/schemas';
import type { StepName } from '../steps';
import type { StubChatProvider, StubEmbeddingsProvider } from '../../llm/stub';

interface FakeSource {
  id: string;
  ownerId: string;
  title: string;
  kind: SourceKindName;
  content: string | null;
  brief: PromptBrief | null;
  outline: Outline | null;
}
interface FakeChunk {
  id: string;
  sourceId: string;
  position: number;
  text: string;
  prevId: string | null;
  embedding: number[] | null;
}
interface FakeConcept {
  id: string;
  slug: string;
  name: string;
  description: string;
}
interface FakeQuestion extends QuestionWrite {
  puzzleId: string;
  status: 'draft' | 'approved' | 'rejected';
  concepts: string[];
  /** Prompt questions: `chunkId` is '' and these are set instead (GENERATED_FROM, critique). */
  generatedFrom?: string;
  critique?: GeneratedQuestionWrite['critique'];
}
interface FakeTask {
  id: string;
  kind: TaskKindName;
  status: TaskStatusName;
  result: TaskRow['result'];
  error: string | null;
  lastCompletedStep: StepName | null;
  requesterId: string;
  sourceId: string;
  createdAt: number;
  updatedAt: number;
}

export type NodeLabelCount =
  'Source' | 'Chunk' | 'Concept' | 'Puzzle' | 'Question' | 'Task' | 'Step';

const cosineDistance = (a: number[], b: number[]): number => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na === 0 || nb === 0 ? 1 : 1 - dot / (Math.sqrt(na) * Math.sqrt(nb));
};

export class FakeCuratorGraph implements CuratorGraphPort, StepRecorder {
  now = 1_760_000_000_000;
  readonly sources = new Map<string, FakeSource>();
  readonly chunks = new Map<string, FakeChunk>();
  readonly concepts = new Map<string, FakeConcept>();
  /** `${chunkId}|${slug}` */
  readonly mentions = new Set<string>();
  /** `${from}>${to}` -> confidence; `from` is the prerequisite */
  readonly prerequisites = new Map<string, number>();
  readonly puzzles = new Map<
    string,
    {
      id: string;
      ownerId: string;
      sourceId: string;
      name: string;
      origin: string;
      status: 'draft' | 'published';
      visibility: 'private' | 'public';
    }
  >();
  readonly questions = new Map<string, FakeQuestion>();
  readonly tasks = new Map<string, FakeTask>();
  readonly steps = new Map<string, StepRow & { taskId: string; attempt: number }>();
  /** `${taskId}|concept|${id}` and `${taskId}|question|${id}` */
  readonly produced = new Set<string>();
  /** Names of every write, in order. */
  readonly writeLog: string[] = [];
  /** Events seen by the recorder side, in order. */
  readonly events: Array<{
    kind: 'begin' | 'progress' | 'complete' | 'fail';
    node: StepName;
    log?: string;
    usage?: Usage;
  }> = [];

  /** Throw this from the named method the next time it is called (consumed on use). */
  failNext = new Map<string, Error>();

  private guard(method: string): void {
    const error = this.failNext.get(method);
    if (error) {
      this.failNext.delete(method);
      throw error;
    }
  }

  // ─── Setup helpers ─────────────────────────────────────────────────────────

  addSource(input: {
    id: string;
    ownerId: string;
    title?: string;
    kind?: SourceKindName;
    content: string;
  }): void {
    this.sources.set(input.id, {
      id: input.id,
      ownerId: input.ownerId,
      title: input.title ?? 'Sample source',
      kind: input.kind ?? 'text',
      content: input.content,
      brief: null,
      outline: null,
    });
  }

  /** A prompt source: a brief and no text. */
  addPromptSource(input: { id: string; ownerId: string; title?: string; brief: PromptBrief }): void {
    this.sources.set(input.id, {
      id: input.id,
      ownerId: input.ownerId,
      title: input.title ?? 'Prompt source',
      kind: 'prompt',
      content: null,
      brief: input.brief,
      outline: null,
    });
  }

  addTask(input: {
    id: string;
    sourceId: string;
    requesterId: string;
    kind?: TaskKindName;
    status?: TaskStatusName;
  }): void {
    this.tasks.set(input.id, {
      id: input.id,
      kind: input.kind ?? 'ingest',
      status: input.status ?? 'queued',
      result: null,
      error: null,
      lastCompletedStep: null,
      requesterId: input.requesterId,
      sourceId: input.sourceId,
      createdAt: this.now,
      updatedAt: this.now,
    });
  }

  /** Node counts by label, for assertions. */
  count(label: NodeLabelCount): number {
    switch (label) {
      case 'Source':
        return this.sources.size;
      case 'Chunk':
        return this.chunks.size;
      case 'Concept':
        return this.concepts.size;
      case 'Puzzle':
        return this.puzzles.size;
      case 'Question':
        return this.questions.size;
      case 'Task':
        return this.tasks.size;
      case 'Step':
        return this.steps.size;
    }
  }

  countWrites(method: string): number {
    return this.writeLog.filter((name) => name === method).length;
  }

  stepsOf(taskId: string): StepRow[] {
    return [...this.steps.values()]
      .filter((s) => s.taskId === taskId)
      .sort((a, b) => a.order - b.order);
  }

  // ─── Task and step lifecycle ───────────────────────────────────────────────

  private usageOf(taskId: string): Usage {
    return this.stepsOf(taskId).reduce((sum, s) => addUsage(sum, s.usage), { ...ZERO_USAGE });
  }

  async loadTask(id: string): Promise<(TaskRow & { steps: StepRow[] }) | null> {
    this.guard('loadTask');
    const task = this.tasks.get(id);
    if (!task) return null;
    const puzzle = [...this.puzzles.values()].find((p) => p.sourceId === task.sourceId);
    return {
      id: task.id,
      kind: task.kind,
      status: task.status,
      result: task.result,
      error: task.error,
      lastCompletedStep: task.lastCompletedStep,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      usage: this.usageOf(id),
      requesterId: task.requesterId,
      sourceId: task.sourceId,
      puzzleId: puzzle?.id ?? null,
      puzzleStatus: puzzle?.status ?? null,
      concepts: [...this.produced].filter((p) => p.startsWith(`${id}|concept|`)).length,
      questions: [...this.produced].filter((p) => p.startsWith(`${id}|question|`)).length,
      steps: this.stepsOf(id),
    };
  }

  async updateTask(
    id: string,
    expected: readonly TaskStatusName[],
    patch: TaskPatch,
    now: number,
  ): Promise<TaskUpdate | null> {
    this.guard('updateTask');
    const task = this.tasks.get(id);
    if (!task || !expected.includes(task.status)) return null;
    this.writeLog.push('updateTask');
    if (patch.status !== undefined) task.status = patch.status;
    if (patch.result !== undefined) task.result = patch.result;
    if (patch.error !== undefined) task.error = patch.error;
    if (patch.lastCompletedStep !== undefined) task.lastCompletedStep = patch.lastCompletedStep;
    task.updatedAt = now;
    return {
      taskId: id,
      status: task.status,
      result: task.result,
      error: task.error,
      lastCompletedStep: task.lastCompletedStep,
    };
  }

  async addStep(input: AddStepInput): Promise<Usage> {
    this.guard('addStep');
    this.writeLog.push('addStep');
    const existing = this.steps.get(input.id);
    this.steps.set(input.id, {
      stepId: input.id,
      taskId: input.taskId,
      attempt: existing?.attempt ?? 0,
      node: input.node,
      status: input.status,
      log: input.log,
      usage: { ...input.usage },
      startedAt: existing?.startedAt ?? input.startedAt,
      finishedAt: input.finishedAt,
      order: existing?.order ?? input.order,
    });
    return this.usageOf(input.taskId);
  }

  // ─── Recorder side ─────────────────────────────────────────────────────────

  async begin(taskId: string, node: StepName): Promise<StepRecord> {
    const current = this.stepsOf(taskId);
    const attempt = current.filter((s) => s.node === node && s.status === 'error').length + 1;
    const id = stepId(taskId, node, attempt);
    const existing = current.find((s) => s.stepId === id);
    const order = existing?.order ?? current.length + 1;
    const startedAt = existing?.startedAt ?? this.now;
    await this.addStep({
      taskId,
      id,
      node,
      status: 'active',
      log: '',
      order,
      startedAt,
      finishedAt: null,
      usage: { ...ZERO_USAGE },
    });
    const step = this.steps.get(id)!;
    step.attempt = attempt;
    this.events.push({ kind: 'begin', node });
    return { taskId, stepId: id, node, order, attempt, startedAt };
  }

  progress(handle: StepRecord, log: string): void {
    this.events.push({ kind: 'progress', node: handle.node, log });
  }

  async complete(handle: StepRecord, log: string, usage: Usage): Promise<void> {
    await this.addStep({
      taskId: handle.taskId,
      id: handle.stepId,
      node: handle.node,
      status: 'complete',
      log,
      order: handle.order,
      startedAt: handle.startedAt,
      finishedAt: this.now,
      usage,
    });
    await this.updateTask(
      handle.taskId,
      ALL_TASK_STATUSES,
      { lastCompletedStep: handle.node },
      this.now,
    );
    this.events.push({ kind: 'complete', node: handle.node, log, usage });
  }

  async fail(handle: StepRecord, error: CuratorStepError, usage: Usage): Promise<void> {
    await this.addStep({
      taskId: handle.taskId,
      id: handle.stepId,
      node: handle.node,
      status: 'error',
      log: error.toTaskError(),
      order: handle.order,
      startedAt: handle.startedAt,
      finishedAt: this.now,
      usage,
    });
    this.events.push({ kind: 'fail', node: handle.node, log: error.toTaskError(), usage });
  }

  // ─── Pipeline reads and writes ─────────────────────────────────────────────

  private chunkRows(sourceId: string): ChunkRow[] {
    return [...this.chunks.values()]
      .filter((c) => c.sourceId === sourceId)
      .sort((a, b) => a.position - b.position)
      .map((c) => ({
        id: c.id,
        position: c.position,
        text: c.text,
        hasEmbedding: c.embedding !== null,
        concepts: [...this.mentions]
          .filter((m) => m.startsWith(`${c.id}|`))
          .map((m) => this.concepts.get(m.slice(c.id.length + 1))!)
          .filter(Boolean)
          .map(({ id, slug, name, description }) => ({ id, slug, name, description })),
      }));
  }

  async sourceChunks(sourceId: string): Promise<SourceRead | null> {
    this.guard('sourceChunks');
    const source = this.sources.get(sourceId);
    if (!source) return null;
    return {
      source: {
        title: source.title,
        kind: source.kind,
        content: source.content,
        brief: source.brief,
        outline: source.outline,
      },
      chunks: this.chunkRows(sourceId),
    };
  }

  async saveOutline(sourceId: string, outline: Outline): Promise<void> {
    this.guard('saveOutline');
    this.writeLog.push('saveOutline');
    const source = this.sources.get(sourceId);
    if (!source) throw new Error(`Source ${sourceId} does not exist`);
    source.outline = outline;
  }

  async chunkEmbeddings(sourceId: string): Promise<Array<{ id: string; embedding: number[] }>> {
    this.guard('chunkEmbeddings');
    return [...this.chunks.values()]
      .filter((c) => c.sourceId === sourceId && c.embedding !== null)
      .map((c) => ({ id: c.id, embedding: c.embedding! }));
  }

  async addChunks(sourceId: string, chunks: ChunkWrite[]): Promise<number> {
    this.guard('addChunks');
    this.writeLog.push('addChunks');
    for (const row of chunks) {
      const existing = this.chunks.get(row.id);
      this.chunks.set(row.id, {
        id: row.id,
        sourceId,
        position: row.position,
        text: row.text,
        prevId: row.prevId,
        embedding: row.embedding ?? existing?.embedding ?? null,
      });
    }
    return chunks.length;
  }

  async conceptNeighbourhood(
    embedding: number[],
    opts: { fetchK: number; maxDistance: number },
  ): Promise<KnownConcept[]> {
    this.guard('conceptNeighbourhood');
    const near = [...this.chunks.values()]
      .filter((c) => c.embedding !== null)
      .map((c) => ({ chunk: c, distance: cosineDistance(embedding, c.embedding!) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, opts.fetchK)
      .filter((n) => n.distance <= opts.maxDistance);
    const found = new Map<string, { concept: FakeConcept; hits: number; best: number }>();
    for (const { chunk, distance } of near) {
      for (const mention of this.mentions) {
        if (!mention.startsWith(`${chunk.id}|`)) continue;
        const concept = this.concepts.get(mention.slice(chunk.id.length + 1));
        if (!concept) continue;
        const entry = found.get(concept.slug) ?? { concept, hits: 0, best: Infinity };
        entry.hits += 1;
        entry.best = Math.min(entry.best, distance);
        found.set(concept.slug, entry);
      }
    }
    return [...found.values()]
      .sort((a, b) => a.best - b.best || b.hits - a.hits)
      .slice(0, 15)
      .map(({ concept }) => ({
        conceptId: concept.id,
        slug: concept.slug,
        name: concept.name,
        description: concept.description,
      }));
  }

  async upsertConcepts(
    taskId: string,
    concepts: ConceptWrite[],
  ): Promise<Array<{ conceptId: string; slug: string }>> {
    this.guard('upsertConcepts');
    this.writeLog.push('upsertConcepts');
    const out: Array<{ conceptId: string; slug: string }> = [];
    for (const row of concepts) {
      let concept = this.concepts.get(row.slug);
      if (!concept) {
        concept = { id: row.id, slug: row.slug, name: row.name, description: row.description };
        this.concepts.set(row.slug, concept);
      }
      this.produced.add(`${taskId}|concept|${concept.id}`);
      for (const chunkId of row.chunkIds)
        if (this.chunks.has(chunkId)) this.mentions.add(`${chunkId}|${row.slug}`);
      out.push({ conceptId: concept.id, slug: concept.slug });
    }
    return out;
  }

  private reaches(from: string, to: string, seen = new Set<string>()): boolean {
    if (from === to) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    for (const key of this.prerequisites.keys()) {
      const [a, b] = key.split('>');
      if (a === from && this.reaches(b!, to, seen)) return true;
    }
    return false;
  }

  async wouldCreateCycle(fromSlug: string, toSlug: string): Promise<boolean> {
    this.guard('wouldCreateCycle');
    return fromSlug === toSlug || this.reaches(toSlug, fromSlug);
  }

  async linkPrerequisite(fromSlug: string, toSlug: string, confidence: number): Promise<boolean> {
    this.guard('linkPrerequisite');
    if (!this.concepts.has(fromSlug) || !this.concepts.has(toSlug)) return false;
    if (await this.wouldCreateCycle(fromSlug, toSlug)) return false;
    this.writeLog.push('linkPrerequisite');
    const key = `${fromSlug}>${toSlug}`;
    if (!this.prerequisites.has(key)) this.prerequisites.set(key, confidence);
    return true;
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
    this.guard('createDraftPuzzle');
    this.writeLog.push('createDraftPuzzle');
    if (!this.puzzles.has(input.id)) {
      this.puzzles.set(input.id, {
        id: input.id,
        ownerId: input.ownerId,
        sourceId: input.sourceId,
        name: input.name,
        origin: input.origin,
        status: 'draft',
        visibility: 'private',
      });
    }
  }

  async createDraftQuestions(
    puzzleId: string,
    taskId: string,
    questions: QuestionWrite[],
  ): Promise<number> {
    this.guard('createDraftQuestions');
    this.writeLog.push('createDraftQuestions');
    let written = 0;
    for (const q of questions) {
      if (!this.puzzles.has(puzzleId) || !this.chunks.has(q.chunkId)) continue;
      const concepts = q.conceptSlugs.filter((slug) => this.concepts.has(slug));
      if (!this.questions.has(q.id))
        this.questions.set(q.id, { ...q, puzzleId, status: 'draft', concepts });
      this.produced.add(`${taskId}|question|${q.id}`);
      written += 1;
    }
    return written;
  }

  async createGeneratedQuestions(
    puzzleId: string,
    taskId: string,
    sourceId: string,
    questions: GeneratedQuestionWrite[],
  ): Promise<number> {
    this.guard('createGeneratedQuestions');
    this.writeLog.push('createGeneratedQuestions');
    const source = this.sources.get(sourceId);
    let written = 0;
    for (const q of questions) {
      if (!this.puzzles.has(puzzleId) || source?.kind !== 'prompt') continue;
      const concepts = q.conceptSlugs.filter((slug) => this.concepts.has(slug));
      if (!this.questions.has(q.id)) {
        this.questions.set(q.id, {
          id: q.id,
          sentence: q.sentence,
          answers: q.answers,
          distractors: q.distractors,
          order: q.order,
          chunkId: '',
          conceptSlugs: q.conceptSlugs,
          puzzleId,
          status: 'draft',
          concepts,
          generatedFrom: sourceId,
          critique: q.critique,
        });
      }
      this.produced.add(`${taskId}|question|${q.id}`);
      written += 1;
    }
    return written;
  }

  async remainingDrafts(taskId: string): Promise<RemainingCounts> {
    this.guard('remainingDrafts');
    const counts = { remaining: 0, approved: 0, rejected: 0 };
    for (const key of this.produced) {
      const [id, kind, questionId] = key.split('|');
      if (id !== taskId || kind !== 'question') continue;
      const status = this.questions.get(questionId!)?.status;
      if (status === 'draft') counts.remaining += 1;
      else if (status === 'approved') counts.approved += 1;
      else if (status === 'rejected') counts.rejected += 1;
    }
    return counts;
  }

  async publishPuzzle(puzzleId: string, minQuestions: number | null): Promise<PuzzleState | null> {
    this.guard('publishPuzzle');
    const puzzle = this.puzzles.get(puzzleId);
    if (!puzzle) return null;
    const approved = [...this.questions.values()].filter(
      (q) => q.puzzleId === puzzleId && q.status === 'approved',
    ).length;
    if (minQuestions !== null && puzzle.status === 'draft' && approved >= minQuestions) {
      this.writeLog.push('publishPuzzle');
      puzzle.status = 'published';
    }
    return {
      id: puzzle.id,
      status: puzzle.status,
      visibility: puzzle.visibility,
      origin: puzzle.origin as 'upload' | 'prompt',
      approved,
    };
  }
}

/** Everything an agent test needs: the fake graph, a recording tracer, and `CuratorDeps` built on them. */
export function makeDeps(options: {
  graph: FakeCuratorGraph;
  chat: StubChatProvider;
  embeddings: StubEmbeddingsProvider;
  tracer?: RecordingUsageTracer;
  isActive?: CuratorDeps['isActive'];
  params?: Partial<CuratorDeps['params']>;
  stepTimeoutMs?: number;
}): CuratorDeps & { tracer: RecordingUsageTracer } {
  const tracer = options.tracer ?? new RecordingUsageTracer();
  return {
    graph: options.graph,
    chat: options.chat,
    embeddings: options.embeddings,
    recorder: options.graph,
    tracer,
    isActive: options.isActive ?? (async () => true),
    params: { chunkSizeChars: 1200, chunkOverlapChars: 150, ...options.params },
    now: () => options.graph.now,
    ...(options.stepTimeoutMs !== undefined ? { stepTimeoutMs: options.stepTimeoutMs } : {}),
  };
}

export { RecordingUsageTracer };
