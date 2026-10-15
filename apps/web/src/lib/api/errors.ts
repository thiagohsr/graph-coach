import type { ErrorCode } from '@coach/types';

/** Codes that exist only in the browser client. */
export type ClientErrorCode = 'CONTRACT_MISMATCH' | 'NETWORK' | 'UNKNOWN';

export interface FieldIssue {
  path: string;
  message: string;
}

export interface ApiClientErrorInit {
  status: number;
  code: ErrorCode | ClientErrorCode;
  message: string;
  issues?: FieldIssue[];
  /** Machine code per issue path, when the server sends one (admin updates: `out_of_range`, `read_only`, …). */
  issueCodes?: Record<string, string>;
  reasons?: string[];
  retryAt?: Date | null;
  window?: string;
  kind?: 'upload' | 'prompt';
  canRedeemCode?: boolean;
}

/** Every failed call of `apiFetch` rejects with this (plan.md "Data Layer"). */
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: ErrorCode | ClientErrorCode;
  readonly issues: FieldIssue[];
  readonly issueCodes: Record<string, string>;
  readonly reasons: string[];
  readonly retryAt: Date | null;
  readonly window: string | undefined;
  readonly kind: 'upload' | 'prompt' | undefined;
  readonly canRedeemCode: boolean | undefined;

  constructor(init: ApiClientErrorInit) {
    super(init.message);
    this.name = 'ApiClientError';
    this.status = init.status;
    this.code = init.code;
    this.issues = init.issues ?? [];
    this.issueCodes = init.issueCodes ?? {};
    this.reasons = init.reasons ?? [];
    this.retryAt = init.retryAt ?? null;
    this.window = init.window;
    this.kind = init.kind;
    this.canRedeemCode = init.canRedeemCode;
  }
}

export function isApiClientError(e: unknown): e is ApiClientError {
  return e instanceof ApiClientError;
}

export function isCode(e: unknown, code: ErrorCode | ClientErrorCode): e is ApiClientError {
  return e instanceof ApiClientError && e.code === code;
}

export function isStatus(e: unknown, status: number): e is ApiClientError {
  return e instanceof ApiClientError && e.status === status;
}

/**
 * The time a rate-limited call may be repeated: `details.resetAt` when present and valid, else
 * now + the `Retry-After` header in seconds, else null.
 */
export function parseRetryAt(
  details: unknown,
  retryAfterHeader: string | null | undefined,
  now: number = Date.now(),
): Date | null {
  if (details && typeof details === 'object' && 'resetAt' in details) {
    const resetAt = (details as { resetAt: unknown }).resetAt;
    if (typeof resetAt === 'string') {
      const d = new Date(resetAt);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds >= 0) return new Date(now + seconds * 1000);
  }
  return null;
}
