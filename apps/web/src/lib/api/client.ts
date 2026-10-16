import { ApiError } from '@coach/types';
import type { z } from 'zod';
import { ApiClientError, parseRetryAt, type FieldIssue } from './errors';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiFetchOptions<S extends z.ZodTypeAny | undefined> {
  method?: HttpMethod;
  body?: unknown;
  schema?: S;
  signal?: AbortSignal;
}

function readIssues(details: unknown): FieldIssue[] {
  if (!details || typeof details !== 'object' || !('issues' in details)) return [];
  const issues = (details as { issues: unknown }).issues;
  if (!Array.isArray(issues)) return [];
  return issues.flatMap((i) => {
    if (
      i &&
      typeof i === 'object' &&
      typeof (i as FieldIssue).path === 'string' &&
      typeof (i as FieldIssue).message === 'string'
    ) {
      return [{ path: (i as FieldIssue).path, message: (i as FieldIssue).message }];
    }
    return [];
  });
}

function readIssueCodes(details: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!details || typeof details !== 'object' || !('issues' in details)) return out;
  const issues = (details as { issues: unknown }).issues;
  if (!Array.isArray(issues)) return out;
  for (const i of issues) {
    if (
      i &&
      typeof i === 'object' &&
      typeof (i as { path?: unknown }).path === 'string' &&
      typeof (i as { code?: unknown }).code === 'string'
    ) {
      out[(i as { path: string }).path] = (i as { code: string }).code;
    }
  }
  return out;
}

function readReasons(details: unknown): string[] {
  if (!details || typeof details !== 'object' || !('reasons' in details)) return [];
  const reasons = (details as { reasons: unknown }).reasons;
  return Array.isArray(reasons) ? reasons.filter((r): r is string => typeof r === 'string') : [];
}

async function toError(response: Response): Promise<ApiClientError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  const parsed = ApiError.safeParse(body);
  if (!parsed.success) {
    return new ApiClientError({
      status: response.status,
      code: response.status >= 500 ? 'INTERNAL' : 'UNKNOWN',
      message:
        response.status >= 500 ? 'Service unavailable.' : `Request failed (${response.status}).`,
      retryAt: parseRetryAt(undefined, response.headers.get('Retry-After')),
    });
  }
  const { code, message, details } = parsed.data.error;
  const d = details && typeof details === 'object' ? (details as Record<string, unknown>) : {};
  return new ApiClientError({
    status: response.status,
    code,
    message,
    issues: readIssues(details),
    issueCodes: readIssueCodes(details),
    reasons: readReasons(details),
    retryAt:
      response.status === 429 ? parseRetryAt(details, response.headers.get('Retry-After')) : null,
    window: typeof d.window === 'string' ? d.window : undefined,
    kind: d.kind === 'upload' || d.kind === 'prompt' ? d.kind : undefined,
    canRedeemCode: typeof d.canRedeemCode === 'boolean' ? d.canRedeemCode : undefined,
  });
}

/**
 * The one way the browser talks to the API: same-origin `/api<canonical path>` (the forwarding route adds
 * the token). Returns the schema output; rejects with ApiClientError.
 */
export async function apiFetch<S extends z.ZodTypeAny>(
  path: string,
  options: ApiFetchOptions<S> & { schema: S },
): Promise<z.output<S>>;
export async function apiFetch(path: string, options?: ApiFetchOptions<undefined>): Promise<void>;
export async function apiFetch(
  path: string,
  options: ApiFetchOptions<z.ZodTypeAny | undefined> = {},
): Promise<unknown> {
  const { method = 'GET', body, schema, signal } = options;
  const headers = new Headers({ Accept: 'application/json' });
  const init: RequestInit = { method, headers, credentials: 'same-origin', signal: signal ?? null };
  if (body !== undefined) {
    headers.set('Content-Type', 'application/json');
    init.body = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(`/api${path}`, init);
  } catch {
    throw new ApiClientError({ status: 0, code: 'NETWORK', message: 'Service unavailable.' });
  }

  if (!response.ok) throw await toError(response);
  if (response.status === 204 || !schema) return undefined;

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    json = undefined;
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    // Logged so a drifting contract is visible during development.
    console.error(`Unexpected response from ${method} ${path}`, parsed.error.issues);
    throw new ApiClientError({
      status: response.status,
      code: 'CONTRACT_MISMATCH',
      message: `Unexpected response from the server (${method} ${path}).`,
    });
  }
  return parsed.data;
}
