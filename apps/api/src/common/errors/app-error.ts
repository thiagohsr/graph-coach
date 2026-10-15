import type { ConflictDetails, ErrorCode, RateLimitDetails, ValidationDetails } from '@coach/types';

/** Kinds of puzzle creation that the allowance and rate-limit details refer to. */
type CreationKind = 'upload' | 'prompt';

/**
 * An error with a code from the canonical `ErrorCode` list and the HTTP status that goes with it.
 * Modules throw these classes; they never build error bodies or pick status numbers (contracts §5.6).
 */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** 422 VALIDATION_FAILED. details: ValidationDetails. */
export class ValidationFailedError extends AppError {
  constructor(issues: ValidationDetails['issues'], message = 'Validation failed') {
    super('VALIDATION_FAILED', message, 422, { issues } satisfies ValidationDetails);
  }
}

/** 422 with a specific code. details: ValidationDetails (issues and/or reasons). */
export class DomainInvalidError extends AppError {
  constructor(
    code: 'SOURCE_REJECTED' | 'DRAFT_INVALID' | 'CODE_INVALID' | 'VALIDATION_FAILED',
    message: string,
    details?: ValidationDetails,
  ) {
    super(code, message, 422, details);
  }
}

/** 401 UNAUTHENTICATED, or INVALID_CREDENTIALS for a failed development sign-in. */
export class UnauthenticatedError extends AppError {
  constructor(
    message = 'Authentication required',
    code: 'UNAUTHENTICATED' | 'INVALID_CREDENTIALS' = 'UNAUTHENTICATED',
  ) {
    super(code, message, 401);
  }
}

/** 403 FORBIDDEN. Role only; thrown by RolesGuard. Services do not throw it for ownership. */
export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to do this') {
    super('FORBIDDEN', message, 403);
  }
}

/** 403 ACCOUNT_BLOCKED. Thrown by AuthGuard and the development sign-in. */
export class AccountBlockedError extends AppError {
  constructor(message = 'This account is blocked') {
    super('ACCOUNT_BLOCKED', message, 403);
  }
}

/** 404 NOT_FOUND. Missing, or not visible to the caller: the same answer for both. */
export class NotFoundError extends AppError {
  constructor(resource: string) {
    super('NOT_FOUND', `${resource} not found`, 404);
  }
}

/** 409. code defaults to CONFLICT. */
export class ConflictError extends AppError {
  constructor(
    message: string,
    options: {
      code?:
        | 'CONFLICT'
        | 'SESSION_ALREADY_SUBMITTED'
        | 'SESSION_NOT_SUBMITTED'
        | 'NO_PLAYABLE_CONTENT'
        | 'TASK_NOT_FAILED'
        | 'ALREADY_DECIDED';
      details?: ConflictDetails;
    } = {},
  ) {
    super(options.code ?? 'CONFLICT', message, 409, options.details);
  }
}

/** 405 ADMIN_MODEL_READ_ONLY. */
export class MethodNotAllowedError extends AppError {
  constructor(message: string) {
    super('ADMIN_MODEL_READ_ONLY', message, 405);
  }
}

/** 429. code defaults to RATE_LIMITED. details: RateLimitDetails. The filter adds Retry-After. */
export class RateLimitedError extends AppError {
  readonly retryAfterSeconds: number;

  constructor(
    result: { resetAt: Date; retryAfterSeconds: number; window?: string },
    code: 'RATE_LIMITED' | 'CREATION_LIMIT_REACHED' = 'RATE_LIMITED',
    message = code === 'CREATION_LIMIT_REACHED'
      ? 'Puzzle creation limit reached'
      : 'Too many requests',
    extra: { kind?: CreationKind; canRedeemCode?: boolean } = {},
  ) {
    const details: RateLimitDetails = {
      retryAfterSeconds: result.retryAfterSeconds,
      resetAt: result.resetAt.toISOString(),
      ...(result.window !== undefined ? { window: result.window } : {}),
      ...(extra.kind !== undefined ? { kind: extra.kind } : {}),
      ...(extra.canRedeemCode !== undefined ? { canRedeemCode: extra.canRedeemCode } : {}),
    };
    super(code, message, 429, details);
    this.retryAfterSeconds = result.retryAfterSeconds;
  }
}

/** 503 with one of the unavailable codes. */
export class UnavailableError extends AppError {
  constructor(
    code:
      | 'GRAPH_UNAVAILABLE'
      | 'SQL_UNAVAILABLE'
      | 'PROVIDER_UNAVAILABLE'
      | 'DECISION_NOT_RECORDED'
      | 'CREATION_PAUSED',
    message: string,
  ) {
    super(code, message, 503);
  }
}
