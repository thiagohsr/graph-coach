import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { GraphKit, type QueryParams } from '@coach/graph-kit';

const nullable = <T extends z.ZodTypeAny>(schema: T) =>
  schema.nullish().transform((value) => (value ?? null) as z.output<T> | null);

export const DraftRow = z.object({
  id: z.string(),
  sentence: z.string(),
  answers: z.array(z.string()),
  distractors: z.array(z.string()),
  status: z.enum(['draft', 'approved', 'rejected']),
  /** JSON string `{ verdict, note, rewritten }` for prompt-made drafts. */
  critique: nullable(z.string()),
  origin: z.enum(['upload', 'prompt']),
  hasBrief: z.boolean(),
  /** Each map holds nulls when the question tests nothing. */
  concepts: z.array(
    z.object({ id: nullable(z.string()), name: nullable(z.string()), slug: nullable(z.string()) }),
  ),
  chunkId: nullable(z.string()),
  chunkText: nullable(z.string()),
  puzzleId: z.string(),
  taskId: nullable(z.string()),
  questionOrder: nullable(z.number()),
});
export type DraftRow = z.output<typeof DraftRow>;

const IdRow = z.object({ id: z.string() });
const RemainingRow = z.object({
  remaining: z.number(),
  approved: z.number(),
  rejected: z.number(),
});
export type RemainingCounts = z.output<typeof RemainingRow>;

const PublishRow = z.object({
  id: z.string(),
  status: z.enum(['draft', 'published']),
  visibility: z.enum(['private', 'public']),
  origin: z.enum(['upload', 'prompt']),
  approved: z.number(),
});
export type PuzzleState = z.output<typeof PublishRow>;

const ShareRow = z.object({
  puzzleId: z.string(),
  status: z.enum(['draft', 'published']),
  hasSource: z.boolean(),
  targetId: nullable(z.string()),
  withSource: nullable(z.boolean()),
  at: nullable(z.number()),
});
export type ShareListRow = z.output<typeof ShareRow>;

const ShareResultRow = z.object({
  status: z.enum(['draft', 'published']),
  hasSource: z.boolean(),
  targetFound: z.boolean(),
  shared: z.boolean(),
  targetId: nullable(z.string()),
  withSource: nullable(z.boolean()),
  at: nullable(z.number()),
});
export type ShareResult = z.output<typeof ShareResultRow>;

const RemovedRow = z.object({ removed: z.number() });
const VisibilityRow = z.object({
  id: z.string(),
  status: z.enum(['draft', 'published']),
  visibility: z.enum(['private', 'public']),
  origin: z.enum(['upload', 'prompt']),
});
export type VisibilityResult = z.output<typeof VisibilityRow>;

const TaskOwnerRow = z.object({ requesterId: nullable(z.string()) });

/**
 * Review, publish, sharing, and visibility queries (spec 005). Every method that serves a request takes only the
 * caller's id as access parameter; no address or name ever reaches the graph.
 */
@Injectable()
export class ReviewGraph {
  constructor(@Inject(GraphKit) private readonly graph: GraphKit) {}

  private async rows<S extends z.ZodTypeAny>(
    name: string,
    params: QueryParams,
    schema: S,
  ): Promise<Array<z.output<S>>> {
    const rows = await this.graph.query(name, params);
    return rows.map((row) => schema.parse(row) as z.output<S>);
  }

  listDrafts(
    userId: string,
    filter: { status?: string | null; taskId?: string | null; questionId?: string | null } = {},
  ): Promise<DraftRow[]> {
    return this.rows(
      'list_drafts',
      {
        userId,
        status: filter.status ?? null,
        taskId: filter.taskId ?? null,
        questionId: filter.questionId ?? null,
      },
      DraftRow,
    );
  }

  /** Whether the caller requested this task (get_task is requester-only). */
  async requestedTask(taskId: string, userId: string): Promise<boolean> {
    const rows = await this.rows('get_task', { id: taskId, userId }, TaskOwnerRow);
    return rows.length > 0;
  }

  async updateDraft(input: {
    questionId: string;
    userId: string;
    sentence: string;
    answers: string[];
    distractors: string[];
  }): Promise<boolean> {
    return (await this.rows('update_draft', input, IdRow)).length > 0;
  }

  async approveQuestion(questionId: string, userId: string, now: number): Promise<boolean> {
    return (await this.rows('approve_question', { questionId, userId, now }, IdRow)).length > 0;
  }

  async rejectQuestion(
    questionId: string,
    userId: string,
    reason: string | null,
    now: number,
  ): Promise<boolean> {
    return (
      (await this.rows('reject_question', { questionId, userId, reason, now }, IdRow)).length > 0
    );
  }

  async remainingDrafts(taskId: string): Promise<RemainingCounts> {
    const [row] = await this.rows('remaining_drafts', { taskId }, RemainingRow);
    return row ?? { remaining: 0, approved: 0, rejected: 0 };
  }

  /** `minQuestions` null only reads the state. */
  async publishPuzzle(puzzleId: string, minQuestions: number | null): Promise<PuzzleState | null> {
    const [row] = await this.rows('publish_puzzle', { puzzleId, minQuestions }, PublishRow);
    return row ?? null;
  }

  listShares(puzzleId: string, userId: string): Promise<ShareListRow[]> {
    return this.rows('list_shares', { puzzleId, userId }, ShareRow);
  }

  async sharePuzzle(input: {
    puzzleId: string;
    userId: string;
    targetId: string;
    withSource: boolean;
    now: number;
  }): Promise<ShareResult | null> {
    const [row] = await this.rows('share_puzzle', input, ShareResultRow);
    return row ?? null;
  }

  /** Null = unknown puzzle or not the owner; otherwise the number of edges removed. */
  async unsharePuzzle(puzzleId: string, userId: string, targetId: string): Promise<number | null> {
    const [row] = await this.rows('unshare_puzzle', { puzzleId, userId, targetId }, RemovedRow);
    return row ? row.removed : null;
  }

  async setVisibility(
    puzzleId: string,
    userId: string,
    visibility: 'public' | 'private',
  ): Promise<VisibilityResult | null> {
    const [row] = await this.rows(
      'set_puzzle_visibility',
      { puzzleId, userId, visibility },
      VisibilityRow,
    );
    return row ?? null;
  }
}
