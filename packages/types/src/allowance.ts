import { z } from 'zod';
import { IsoDateTime } from './common';
import { RateLimitDetails } from './errors';

/** upload = a source of kind text, markdown, or url; prompt = a source of kind prompt. */
export const CreationKind = z.enum(['upload', 'prompt']);
export type CreationKind = z.infer<typeof CreationKind>;

/** details of 429 CREATION_LIMIT_REACHED */
export const CreationLimitDetails = RateLimitDetails.extend({
  window: z.enum(['hour', 'month']),
  kind: CreationKind,
  resetAt: IsoDateTime,
  canRedeemCode: z.boolean(),
});
export type CreationLimitDetails = z.infer<typeof CreationLimitDetails>;

const KindAllowance = z.object({
  used: z.number().int().nonnegative(),
  /** null = unlimited (reviewer, admin) */
  allowance: z.number().int().nonnegative().nullable(),
  bonus: z.number().int().nonnegative(),
  /** First instant of the next calendar month, UTC. */
  resetsAt: IsoDateTime,
});

/** GET /me/allowance */
export const AllowanceDto = z.object({
  upload: KindAllowance,
  prompt: KindAllowance,
  hourly: z.object({
    used: z.number().int().nonnegative(),
    /** null = unlimited */
    limit: z.number().int().nonnegative().nullable(),
    /** Present only while in the future. */
    liftedUntil: IsoDateTime.optional(),
  }),
  creationEnabled: z.boolean(),
});
export type AllowanceDto = z.infer<typeof AllowanceDto>;

export const RedeemRequest = z.object({ code: z.string().trim().min(1).max(64) });
export type RedeemRequest = z.infer<typeof RedeemRequest>;

export const RedeemResult = z.object({
  sourceRuns: z.number().int().nonnegative(),
  promptRuns: z.number().int().nonnegative(),
  limitsLiftedUntil: IsoDateTime.optional(),
});
export type RedeemResult = z.infer<typeof RedeemResult>;
