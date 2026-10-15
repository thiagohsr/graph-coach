import { z } from 'zod';
import { IsoDateTime } from './common';

// Exactly the list in the canonical contract (reconciliation section B as amended by I14 and J11).
// A new code is added there first.
export const ErrorCode = z.enum([
  'VALIDATION_FAILED', // 400 only for unparseable JSON; 422 for any value that fails its schema
  'UNAUTHENTICATED', // 401
  'INVALID_CREDENTIALS', // 401
  'FORBIDDEN', // 403, role only, never ownership
  'ACCOUNT_BLOCKED', // 403, every endpoint, for a blocked account
  'NOT_FOUND', // 404, missing or not visible to the caller
  'ADMIN_MODEL_READ_ONLY', // 405
  'CONFLICT', // 409
  'SESSION_ALREADY_SUBMITTED', // 409
  'SESSION_NOT_SUBMITTED', // 409
  'NO_PLAYABLE_CONTENT', // 409
  'TASK_NOT_FAILED', // 409
  'ALREADY_DECIDED', // 409
  'SOURCE_REJECTED', // 422
  'DRAFT_INVALID', // 422
  'CODE_INVALID', // 422, the one answer for any refused code
  'RATE_LIMITED', // 429
  'CREATION_LIMIT_REACHED', // 429, details: window 'hour' | 'month', kind, resetAt, canRedeemCode
  'INTERNAL', // 500
  'GRAPH_UNAVAILABLE', // 503
  'SQL_UNAVAILABLE', // 503
  'PROVIDER_UNAVAILABLE', // 503
  'DECISION_NOT_RECORDED', // 503
  'CREATION_PAUSED', // 503
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ApiError = z.object({
  error: z.object({ code: ErrorCode, message: z.string(), details: z.unknown().optional() }),
});
export type ApiError = z.infer<typeof ApiError>;

export const ValidationDetails = z.object({
  issues: z.array(z.object({ path: z.string(), message: z.string(), code: z.string().optional() })),
  /** 005 puts guard reasons here; 006 puts field codes in issues[].code. */
  reasons: z.array(z.string()).optional(),
});
export type ValidationDetails = z.infer<typeof ValidationDetails>;

/** details of 429; CREATION_LIMIT_REACHED adds window, kind, and canRedeemCode (see CreationLimitDetails). */
export const RateLimitDetails = z.object({
  retryAfterSeconds: z.number().int().nonnegative(),
  resetAt: IsoDateTime,
  window: z.string().optional(),
  kind: z.enum(['upload', 'prompt']).optional(),
  canRedeemCode: z.boolean().optional(),
});
export type RateLimitDetails = z.infer<typeof RateLimitDetails>;

export const ConflictDetails = z.object({ field: z.string().optional() });
export type ConflictDetails = z.infer<typeof ConflictDetails>;
