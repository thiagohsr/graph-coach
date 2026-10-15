import type { z } from 'zod';
import { ZERO_USAGE, type Usage } from './usage';

export interface ProviderErrorInit {
  provider: string;
  label?: string;
  cause?: unknown;
  /** Usage spent before the error; defaults to ZERO_USAGE (no request was sent). */
  usage?: Usage;
}

export class ProviderError extends Error {
  readonly provider: string;
  readonly label?: string;
  override readonly cause?: unknown;
  readonly usage: Usage;

  constructor(message: string, init: ProviderErrorInit) {
    super(message);
    this.name = new.target.name;
    this.provider = init.provider;
    if (init.label !== undefined) this.label = init.label;
    if (init.cause !== undefined) this.cause = init.cause;
    this.usage = init.usage ?? { ...ZERO_USAGE };
  }
}

/** Network error, timeout, 5xx, 429 from the provider. */
export class ProviderUnavailableError extends ProviderError {}

/** Bad key, unknown model, wrong vector length. */
export class ProviderConfigError extends ProviderError {}

export class ProviderOutputError extends ProviderError {
  readonly issues: z.ZodIssue[];
  readonly raw: string;

  constructor(message: string, init: ProviderErrorInit & { issues: z.ZodIssue[]; raw: string }) {
    super(message, init);
    this.issues = init.issues;
    this.raw = init.raw;
  }
}

/** Replaces the usage carried by an error (the shared loops sum attempts). */
export function attachUsage<E extends ProviderError>(error: E, usage: Usage): E {
  (error as { usage: Usage }).usage = usage;
  return error;
}

/**
 * Translates an error thrown by a provider SDK. 429, 408, 5xx, timeouts, aborts, and network failures are
 * "unavailable"; other 4xx (bad key, unknown model) are configuration problems.
 */
export function translateProviderError(
  error: unknown,
  init: { provider: string; label?: string; usage: Usage },
): ProviderError {
  if (error instanceof ProviderError) return attachUsage(error, init.usage);
  const e = error as { status?: unknown; status_code?: unknown; message?: unknown; name?: unknown } | null;
  const status =
    typeof e?.status === 'number' ? e.status : typeof e?.status_code === 'number' ? e.status_code : undefined;
  const reason = typeof e?.message === 'string' ? e.message : String(error);
  const base = { provider: init.provider, cause: error, usage: init.usage, ...(init.label ? { label: init.label } : {}) };
  if (status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429) {
    return new ProviderConfigError(`${init.provider} rejected the request (${status}): ${reason}`, base);
  }
  return new ProviderUnavailableError(`${init.provider} is unavailable: ${reason}`, base);
}
