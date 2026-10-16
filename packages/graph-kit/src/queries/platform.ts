// Typed handles for the named queries owned by 002 (queries/*.cypher). They register nothing.
import { z } from 'zod';
import { typedQuery } from '../define';

export const LearnerRow = z.object({
  id: z.string(),
  displayName: z.string(),
  createdAt: z.number(),
  created: z.boolean(),
});
export type LearnerRow = z.infer<typeof LearnerRow>;

/** Creates the Learner node for an account, or finds it when it exists (a retry, or a linked seeded account). */
export const createLearner = typedQuery<
  { id: string; displayName: string; createdAt: number },
  LearnerRow
>('create_learner', LearnerRow);

export const CreationCountRow = z.object({
  userId: z.string(),
  uploadsThisMonth: z.number().int(),
  promptsThisMonth: z.number().int(),
  creationsLastHour: z.number().int(),
});
export type CreationCountRow = z.infer<typeof CreationCountRow>;

/** Puzzle creations per user: uploads and prompts this month, both kinds in the last hour (spec 002 data-model §2.3). */
export const creationCountsQuery = typedQuery<
  { userIds: string[]; monthStart: number; hourAgo: number; since: number },
  CreationCountRow
>('creation_counts', CreationCountRow);

export const UsageTotalRow = z.object({
  userId: z.string(),
  modelCalls: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  embeddingTokens: z.number().int(),
});
export type UsageTotalRow = z.infer<typeof UsageTotalRow>;

/** Model calls and tokens per user in the current month, over their tasks and decisions (data-model §2.4). */
export const usageTotalsQuery = typedQuery<
  { userIds: string[]; monthStart: number },
  UsageTotalRow
>('usage_totals', UsageTotalRow);

export const DeletedRow = z.object({ deleted: z.number().int() });
export type DeletedRow = z.infer<typeof DeletedRow>;

/** Compensation for a failed account creation: deletes a learner that has no relationships. */
export const deleteLearner = typedQuery<{ id: string }, DeletedRow>('delete_learner', DeletedRow);
