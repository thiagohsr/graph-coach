// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { forward, type ProxyDeps } from './proxy';
import type { Session } from './session-cookie';
import type { FreshSession } from './token-refresh';

const session: Session = { accessToken: 'ACCESS', refreshToken: 'REFRESH', expiresAt: Date.now() + 3600_000 };
const refreshedSession: Session = { accessToken: 'ACCESS2', refreshToken: 'REFRESH2', expiresAt: Date.now() + 3600_000 };

type FetchMock = ReturnType<typeof vi.fn>;

function makeDeps(overrides: Partial<ProxyDeps> = {}): ProxyDeps & { fetch: FetchMock; ensureFresh: FetchMock } {
  const base = {
    apiUrl: 'http://api:3001/api',
    session,
    ensureFresh: vi.fn(async (s: Session): Promise<FreshSession | null> => ({ session: s, refreshed: false })),
    forwardedFor: '203.0.113.9',
    publicOrigin: 'http://localhost:3000',
    fetch: vi.fn(async () => Response.json({ ok: true })),
    sessionCookies: (s: Session) => [`gc_session.0=new-${s.accessToken}; Path=/; HttpOnly`],
    clearCookies: () => ['gc_session.0=; Path=/; Max-Age=0'],
  };
  return { ...base, ...overrides } as ProxyDeps & { fetch: FetchMock; ensureFresh: FetchMock };
}

const req = (path: string, init: RequestInit = {}) => new Request(`http://localhost:3000${path}`, init);

function upstreamCall(deps: { fetch: FetchMock }, n = 0): { url: string; init: RequestInit; headers: Headers } {
  const [url, init] = deps.fetch.mock.calls[n]! as [string, RequestInit];
  return { url, init, headers: new Headers(init.headers) };
}

describe('forward: building the upstream request', () => {
  it('forwards with the Bearer token from the session to {API_URL}/{splat}{search}', async () => {
    const deps = makeDeps();
    const res = await forward(req('/api/puzzles?x=1&y=2', { headers: { accept: 'application/json' } }), deps);
    expect(res.status).toBe(200);
    const { url, init, headers } = upstreamCall(deps);
    expect(url).toBe('http://api:3001/api/puzzles?x=1&y=2');
    expect(init.method).toBe('GET');
    expect(headers.get('Authorization')).toBe('Bearer ACCESS');
    expect(headers.get('Accept')).toBe('application/json');
  });

  it('does not forward browser Authorization, Cookie, Origin, Host, or X-Forwarded-*, and sets X-Forwarded-For from deps', async () => {
    const deps = makeDeps();
    await forward(
      req('/api/puzzles', {
        headers: {
          authorization: 'Bearer BROWSER',
          cookie: 'gc_session.0=secret',
          origin: 'http://localhost:3000',
          'x-forwarded-for': '6.6.6.6',
          'x-forwarded-host': 'evil.example',
          'last-event-id': '7',
          'x-custom': 'dropped',
        },
      }),
      deps,
    );
    const { headers } = upstreamCall(deps);
    expect(headers.get('Authorization')).toBe('Bearer ACCESS');
    expect(headers.has('Cookie')).toBe(false);
    expect(headers.has('Origin')).toBe(false);
    expect(headers.has('X-Forwarded-Host')).toBe(false);
    expect(headers.has('X-Custom')).toBe(false);
    expect(headers.get('X-Forwarded-For')).toBe('203.0.113.9');
    expect(headers.get('Last-Event-ID')).toBe('7');
  });

  it('forwards the method and body of writes with their Content-Type', async () => {
    const deps = makeDeps();
    await forward(
      req('/api/puzzles/p1/shares', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a@b.c' }) }),
      deps,
    );
    const { init, headers } = upstreamCall(deps);
    expect(init.method).toBe('PUT');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(Buffer.from(init.body as ArrayBuffer).toString()).toBe('{"email":"a@b.c"}');
  });
});

describe('forward: refusals', () => {
  it('refuses auth/dev-login without calling upstream', async () => {
    for (const path of ['/api/auth/dev-login', '/api/Auth/Dev-Login', '/api/auth/dev-login/']) {
      const deps = makeDeps();
      const res = await forward(req(path, { method: 'POST', body: '{}' }), deps);
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe('NOT_FOUND');
      expect(deps.fetch).not.toHaveBeenCalled();
    }
  });

  it('answers 401 UNAUTHENTICATED without calling upstream when there is no session', async () => {
    const deps = makeDeps({ session: null });
    const res = await forward(req('/api/puzzles'), deps);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHENTICATED');
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('forwards health without a session and without a token', async () => {
    const deps = makeDeps({ session: null });
    const res = await forward(req('/api/health'), deps);
    expect(res.status).toBe(200);
    expect(deps.fetch).toHaveBeenCalledTimes(1);
    expect(upstreamCall(deps).url).toBe('http://api:3001/api/health');
    expect(upstreamCall(deps).headers.has('Authorization')).toBe(false);
  });

  it('refuses a foreign Origin on POST, PUT, PATCH, and DELETE but not on GET', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const deps = makeDeps();
      const res = await forward(req('/api/puzzles/p1/shares', { method, headers: { origin: 'http://evil.example' }, body: method === 'DELETE' ? undefined : '{}' }), deps);
      expect(res.status, method).toBe(403);
      expect((await res.json()).error.code).toBe('FORBIDDEN');
      expect(deps.fetch).not.toHaveBeenCalled();
    }
    const deps = makeDeps();
    expect((await forward(req('/api/puzzles', { headers: { origin: 'http://evil.example' } }), deps)).status).toBe(200);
  });

  it('accepts the public origin and a missing Origin on writes', async () => {
    const deps = makeDeps();
    expect((await forward(req('/api/x', { method: 'POST', headers: { origin: 'http://localhost:3000' }, body: '{}' }), deps)).status).toBe(200);
    expect((await forward(req('/api/x', { method: 'POST', body: '{}' }), deps)).status).toBe(200);
  });

  it('answers 404 for other methods and for bad paths', async () => {
    const deps = makeDeps();
    expect((await forward(req('/api/puzzles', { method: 'OPTIONS' }), deps)).status).toBe(404);
    expect((await forward(req('/api/puzzles', { method: 'HEAD' }), deps)).status).toBe(404);
    for (const path of ['/api/a//b', '/api/a%2Fb', '/api/a%2fb', '/api/a%5Cb', '/api/a%5cb', '/api/a%2e%2e/b', '/api/%00', '/api/', '/apix/b']) {
      const res = await forward(req(path), deps);
      expect(res.status, path).toBe(404);
    }
    expect(deps.fetch).not.toHaveBeenCalled();
  });
});

describe('forward: responses', () => {
  it('passes status, body, Retry-After, and Cache-Control through and drops upstream Set-Cookie', async () => {
    const deps = makeDeps({
      fetch: vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'slow' } }), {
            status: 429,
            headers: { 'Content-Type': 'application/json', 'Retry-After': '30', 'Cache-Control': 'no-store', 'Set-Cookie': 'evil=1', 'X-Internal': 'drop' },
          }),
      ),
    });
    const res = await forward(req('/api/puzzles'), deps);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('30');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(res.headers.has('Set-Cookie')).toBe(false);
    expect(res.headers.has('X-Internal')).toBe(false);
    expect((await res.json()).error.code).toBe('RATE_LIMITED');
  });

  it('passes a 204 through with no body', async () => {
    const deps = makeDeps({ fetch: vi.fn(async () => new Response(null, { status: 204 })) });
    const res = await forward(req('/api/puzzles/p1/shares/u1', { method: 'DELETE' }), deps);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
  });

  it('passes a 403 ACCOUNT_BLOCKED through unchanged and keeps the session', async () => {
    const deps = makeDeps({
      fetch: vi.fn(async () => Response.json({ error: { code: 'ACCOUNT_BLOCKED', message: 'Blocked' } }, { status: 403 })),
    });
    const res = await forward(req('/api/puzzles'), deps);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('ACCOUNT_BLOCKED');
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it('sets the rewritten cookies when the session was refreshed', async () => {
    const deps = makeDeps({
      ensureFresh: vi.fn(async () => ({ session: refreshedSession, refreshed: true })),
    });
    const res = await forward(req('/api/puzzles'), deps);
    expect(upstreamCall(deps).headers.get('Authorization')).toBe('Bearer ACCESS2');
    expect(res.headers.getSetCookie()).toEqual(['gc_session.0=new-ACCESS2; Path=/; HttpOnly']);
  });

  it('answers 401 and clears the cookies when the refresh fails', async () => {
    const deps = makeDeps({ ensureFresh: vi.fn(async () => null) });
    const res = await forward(req('/api/puzzles'), deps);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHENTICATED');
    expect(res.headers.getSetCookie()).toEqual(['gc_session.0=; Path=/; Max-Age=0']);
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('refreshes once and retries once on an upstream 401', async () => {
    const calls: string[] = [];
    const deps = makeDeps({
      fetch: vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
        const auth = new Headers(init?.headers).get('Authorization')!;
        calls.push(auth);
        return auth === 'Bearer ACCESS2'
          ? Response.json({ ok: 'second' })
          : Response.json({ error: { code: 'UNAUTHENTICATED', message: 'no' } }, { status: 401 });
      }),
      ensureFresh: vi.fn(async (_s: Session, opts?: { force?: boolean }) =>
        opts?.force ? { session: refreshedSession, refreshed: true } : { session, refreshed: false },
      ),
    });
    const res = await forward(req('/api/puzzles', { method: 'POST', body: '{"a":1}', headers: { 'content-type': 'application/json' } }), deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: 'second' });
    expect(calls).toEqual(['Bearer ACCESS', 'Bearer ACCESS2']);
    expect(deps.ensureFresh).toHaveBeenCalledWith(session, { force: true });
    // The body was sent again on the retry.
    expect(Buffer.from(upstreamCall(deps, 1).init.body as ArrayBuffer).toString()).toBe('{"a":1}');
    expect(res.headers.getSetCookie()).toEqual(['gc_session.0=new-ACCESS2; Path=/; HttpOnly']);
  });

  it('passes a second 401 on and clears the cookies', async () => {
    const deps = makeDeps({
      fetch: vi.fn(async () => Response.json({ error: { code: 'UNAUTHENTICATED', message: 'no' } }, { status: 401 })),
      ensureFresh: vi.fn(async (_s: Session, opts?: { force?: boolean }) =>
        opts?.force ? { session: refreshedSession, refreshed: true } : { session, refreshed: false },
      ),
    });
    const res = await forward(req('/api/puzzles'), deps);
    expect(res.status).toBe(401);
    expect(deps.fetch).toHaveBeenCalledTimes(2);
    expect(res.headers.getSetCookie()).toEqual(['gc_session.0=; Path=/; Max-Age=0']);
  });

  it('clears the cookies when an upstream 401 cannot be refreshed', async () => {
    const deps = makeDeps({
      fetch: vi.fn(async () => Response.json({ error: { code: 'UNAUTHENTICATED', message: 'no' } }, { status: 401 })),
      ensureFresh: vi.fn(async (_s: Session, opts?: { force?: boolean }) => (opts?.force ? null : { session, refreshed: false })),
    });
    const res = await forward(req('/api/puzzles'), deps);
    expect(res.status).toBe(401);
    expect(deps.fetch).toHaveBeenCalledTimes(1);
    expect(res.headers.getSetCookie()).toEqual(['gc_session.0=; Path=/; Max-Age=0']);
  });

  it('does not retry an upstream 401 for a session without a refresh token, and clears the cookies', async () => {
    const dev: Session = { accessToken: 'DEV', expiresAt: Date.now() + 60_000 };
    const deps = makeDeps({
      session: dev,
      fetch: vi.fn(async () => Response.json({ error: { code: 'UNAUTHENTICATED', message: 'no' } }, { status: 401 })),
    });
    const res = await forward(req('/api/puzzles'), deps);
    expect(res.status).toBe(401);
    expect(deps.fetch).toHaveBeenCalledTimes(1);
    expect(res.headers.getSetCookie()).toEqual(['gc_session.0=; Path=/; Max-Age=0']);
  });
});

describe('forward: streams', () => {
  it('relays an event stream chunk by chunk with the no-buffering headers', async () => {
    const encoder = new TextEncoder();
    let push!: (s: string) => void;
    let end!: () => void;
    const upstreamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        push = (s) => controller.enqueue(encoder.encode(s));
        end = () => controller.close();
      },
    });
    const deps = makeDeps({
      fetch: vi.fn(async () => new Response(upstreamBody, { status: 200, headers: { 'Content-Type': 'text/event-stream', 'Content-Encoding': 'gzip' } })),
    });
    const res = await forward(req('/api/tasks/t1/events'), deps);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(res.headers.get('Cache-Control')).toBe('no-cache, no-transform');
    expect(res.headers.get('X-Accel-Buffering')).toBe('no');
    expect(res.headers.has('Content-Encoding')).toBe(false);

    const reader = res.body!.getReader();
    push(': ping\n\n');
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(': ping\n\n');
    push('id: 1\ndata: {}\n\n');
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('id: 1\ndata: {}\n\n');
    end();
    expect((await reader.read()).done).toBe(true);
  });

  it('aborts the upstream request when the browser closes the connection', async () => {
    const controller = new AbortController();
    let upstreamSignal: AbortSignal | undefined;
    const deps = makeDeps({
      fetch: vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
        upstreamSignal = init?.signal as AbortSignal;
        return new Response('x', { headers: { 'Content-Type': 'text/event-stream' } });
      }),
    });
    await forward(new Request('http://localhost:3000/api/tasks/t1/events', { signal: controller.signal }), deps);
    expect(upstreamSignal?.aborted).toBe(false);
    controller.abort();
    expect(upstreamSignal?.aborted).toBe(true);
  });
});

describe('forward: upstream failures', () => {
  it('answers 502 INTERNAL when fetch rejects', async () => {
    const deps = makeDeps({ fetch: vi.fn(async () => { throw new TypeError('ECONNREFUSED'); }) });
    const res = await forward(req('/api/puzzles'), deps);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: { code: 'INTERNAL', message: 'The API is unreachable.' } });
  });

  it('answers 504 INTERNAL when no headers arrive within the time limit', async () => {
    const deps = makeDeps({
      timeoutMs: 20,
      fetch: vi.fn(
        (_url: URL | RequestInfo, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            (init?.signal as AbortSignal).addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
      ),
    });
    const res = await forward(req('/api/puzzles'), deps);
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({ error: { code: 'INTERNAL', message: 'The API did not answer in time.' } });
  });
});
