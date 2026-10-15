import { z } from 'zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, isCode, isStatus } from './errors';
import { apiFetch } from './client';

const Thing = z.object({ id: z.string(), n: z.number() });

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    ...init,
  });
}

function envelope(status: number, code: string, message: string, details?: unknown, headers?: Record<string, string>) {
  return json({ error: { code, message, ...(details === undefined ? {} : { details }) } }, { status, headers });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
});

async function catchError(p: Promise<unknown>): Promise<ApiClientError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiClientError);
    return e as ApiClientError;
  }
  throw new Error('expected a rejection');
}

describe('apiFetch success', () => {
  it('calls /api<path> same-origin and returns the schema output', async () => {
    fetchMock.mockResolvedValue(json({ id: 'a', n: 1, extra: 'dropped' }));
    const out = await apiFetch('/things/a', { schema: Thing });
    expect(out).toEqual({ id: 'a', n: 1 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/things/a');
    expect(init.method ?? 'GET').toBe('GET');
    expect(init.credentials).toBe('same-origin');
  });

  it('sends the given method and a JSON body', async () => {
    fetchMock.mockResolvedValue(json({ id: 'a', n: 2 }));
    await apiFetch('/things/a', { method: 'PUT', body: { n: 2 }, schema: Thing });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(JSON.stringify({ n: 2 }));
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  });

  it('sends DELETE with no body and resolves 204 to undefined without parsing', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const out = await apiFetch('/things/a', { method: 'DELETE' });
    expect(out).toBeUndefined();
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
  });
});

describe('apiFetch contract mismatch', () => {
  it('throws CONTRACT_MISMATCH when a 2xx body fails its schema', async () => {
    fetchMock.mockResolvedValue(json({ id: 1 }));
    const err = await catchError(apiFetch('/things/a', { schema: Thing }));
    expect(err.code).toBe('CONTRACT_MISMATCH');
    expect(err.status).toBe(200);
    expect(err.message).toContain('/things/a');
  });
});

describe('apiFetch errors', () => {
  it('maps a canonical envelope to status, code, and message', async () => {
    fetchMock.mockResolvedValue(envelope(404, 'NOT_FOUND', 'No such puzzle'));
    const err = await catchError(apiFetch('/puzzles/x', { schema: Thing }));
    expect(err).toMatchObject({ status: 404, code: 'NOT_FOUND', message: 'No such puzzle' });
    expect(isCode(err, 'NOT_FOUND')).toBe(true);
    expect(isStatus(err, 404)).toBe(true);
    expect(isCode(new Error('x'), 'NOT_FOUND')).toBe(false);
  });

  it('keeps 403 ACCOUNT_BLOCKED distinct from 403 FORBIDDEN', async () => {
    fetchMock.mockResolvedValueOnce(envelope(403, 'ACCOUNT_BLOCKED', 'Blocked'));
    fetchMock.mockResolvedValueOnce(envelope(403, 'FORBIDDEN', 'No'));
    const blocked = await catchError(apiFetch('/x', { schema: Thing }));
    const forbidden = await catchError(apiFetch('/x', { schema: Thing }));
    expect(blocked.code).toBe('ACCOUNT_BLOCKED');
    expect(forbidden.code).toBe('FORBIDDEN');
    expect(blocked.status).toBe(403);
    expect(forbidden.status).toBe(403);
  });

  it('exposes issues and reasons of a 422', async () => {
    fetchMock.mockResolvedValue(
      envelope(422, 'SOURCE_REJECTED', 'Rejected', {
        issues: [{ path: 'content', message: 'Too short', code: 'too_small' }],
        reasons: ['Too short'],
      }),
    );
    const err = await catchError(apiFetch('/sources', { method: 'POST', body: {}, schema: Thing }));
    expect(err.issues).toEqual([{ path: 'content', message: 'Too short' }]);
    expect(err.reasons).toEqual(['Too short']);
  });

  it('defaults issues and reasons to empty lists', async () => {
    fetchMock.mockResolvedValue(envelope(409, 'CONFLICT', 'Nope'));
    const err = await catchError(apiFetch('/x', { schema: Thing }));
    expect(err.issues).toEqual([]);
    expect(err.reasons).toEqual([]);
    expect(err.retryAt).toBeNull();
  });

  it('sets retryAt from details.resetAt on a 429 and exposes the creation-limit details', async () => {
    fetchMock.mockResolvedValue(
      envelope(429, 'CREATION_LIMIT_REACHED', 'Limit', {
        retryAfterSeconds: 600,
        resetAt: '2026-10-15T12:00:00.000Z',
        window: 'month',
        kind: 'prompt',
        canRedeemCode: true,
      }),
    );
    const err = await catchError(apiFetch('/sources', { method: 'POST', body: {}, schema: Thing }));
    expect(err.retryAt?.toISOString()).toBe('2026-10-15T12:00:00.000Z');
    expect(err.window).toBe('month');
    expect(err.kind).toBe('prompt');
    expect(err.canRedeemCode).toBe(true);
  });

  it('falls back to now + Retry-After seconds', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-15T10:00:00.000Z'));
    fetchMock.mockResolvedValue(envelope(429, 'RATE_LIMITED', 'Slow down', undefined, { 'Retry-After': '90' }));
    const err = await catchError(apiFetch('/x', { schema: Thing }));
    expect(err.retryAt?.toISOString()).toBe('2026-10-15T10:01:30.000Z');
  });

  it('leaves retryAt null when no time is given', async () => {
    fetchMock.mockResolvedValue(envelope(429, 'RATE_LIMITED', 'Slow down'));
    const err = await catchError(apiFetch('/x', { schema: Thing }));
    expect(err.retryAt).toBeNull();
    expect(err.window).toBeUndefined();
    expect(err.kind).toBeUndefined();
    expect(err.canRedeemCode).toBeUndefined();
  });

  it('treats a non-envelope error body as a generic error with the status', async () => {
    fetchMock.mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 }));
    const err = await catchError(apiFetch('/x', { schema: Thing }));
    expect(err.status).toBe(502);
    expect(err.code).toBe('INTERNAL');
  });

  it('throws code NETWORK when fetch rejects', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const err = await catchError(apiFetch('/x', { schema: Thing }));
    expect(err.code).toBe('NETWORK');
    expect(err.status).toBe(0);
  });
});
