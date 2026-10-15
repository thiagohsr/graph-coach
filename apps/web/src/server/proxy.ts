import { originAllowed } from './trust';
import type { Session } from './session-cookie';
import type { FreshSession } from './token-refresh';

// The forwarding layer (contracts/web-server.md §5-§6): one pure function over a Request and its
// dependencies. The catch-all server route is a thin adapter that supplies the dependencies.

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const DEFAULT_TIMEOUT_MS = 30_000;

export interface ProxyDeps {
  /** Upstream base URL including `/api`, no trailing slash. */
  apiUrl: string;
  session: Session | null;
  ensureFresh: (session: Session, options?: { force?: boolean }) => Promise<FreshSession | null>;
  /** The `X-Forwarded-For` value for the upstream call (see trust.ts). */
  forwardedFor: string | undefined;
  publicOrigin: string;
  fetch: typeof fetch;
  /** `Set-Cookie` values that store a (refreshed) session. */
  sessionCookies: (session: Session) => string[];
  /** `Set-Cookie` values that expire every session cookie. */
  clearCookies: () => string[];
  /** Time to wait for response headers from the API. */
  timeoutMs?: number;
}

function errorResponse(status: number, code: string, message: string, cookies: string[] = []): Response {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(JSON.stringify({ error: { code, message } }), { status, headers });
}

const notFound = () => errorResponse(404, 'NOT_FOUND', 'Not found.');

/** The part of the path after `/api/`, or null when the path is not one we forward. */
export function extractSplat(pathname: string): string | null {
  if (!pathname.startsWith('/api/')) return null;
  const splat = pathname.slice('/api/'.length);
  if (splat === '') return null;
  const lower = splat.toLowerCase();
  if (splat.includes('..') || splat.includes('//') || splat.includes('\\') || splat.includes('\0')) return null;
  if (lower.includes('%2f') || lower.includes('%5c') || lower.includes('%2e') || lower.includes('%00')) return null;
  return splat;
}

function upstreamHeaders(request: Request, accessToken: string | null, forwardedFor: string | undefined): Headers {
  const headers = new Headers();
  for (const name of ['content-type', 'accept', 'last-event-id']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  if (forwardedFor) headers.set('X-Forwarded-For', forwardedFor);
  return headers;
}

interface Attempt {
  response: Response | null;
  timedOut: boolean;
}

async function callUpstream(
  url: string,
  method: string,
  headers: Headers,
  body: ArrayBuffer | undefined,
  clientSignal: AbortSignal,
  deps: ProxyDeps,
): Promise<Attempt> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const onClientAbort = () => controller.abort();
  if (clientSignal.aborted) controller.abort();
  else clientSignal.addEventListener('abort', onClientAbort, { once: true });

  try {
    const init: RequestInit = { method, headers, signal: controller.signal, redirect: 'manual' };
    if (body !== undefined) init.body = body;
    const response = await deps.fetch(url, init);
    // The time limit covers the wait for headers only; a stream may stay open longer.
    clearTimeout(timer);
    return { response, timedOut: false };
  } catch {
    clearTimeout(timer);
    clientSignal.removeEventListener('abort', onClientAbort);
    return { response: null, timedOut };
  }
}

function relay(upstream: Response, cookies: string[]): Response {
  const headers = new Headers();
  const contentType = upstream.headers.get('Content-Type');
  if (contentType) headers.set('Content-Type', contentType);
  for (const name of ['Retry-After', 'Cache-Control']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (contentType?.toLowerCase().startsWith('text/event-stream')) {
    headers.set('Content-Type', 'text/event-stream');
    headers.set('Cache-Control', 'no-cache, no-transform');
    headers.set('X-Accel-Buffering', 'no');
  }
  for (const c of cookies) headers.append('Set-Cookie', c);
  const noBody = upstream.status === 204 || upstream.status === 205 || upstream.status === 304;
  return new Response(noBody ? null : upstream.body, { status: upstream.status, headers });
}

export async function forward(request: Request, deps: ProxyDeps): Promise<Response> {
  const method = request.method.toUpperCase();
  if (!ALLOWED_METHODS.has(method)) return notFound();

  const url = new URL(request.url);
  const splat = extractSplat(url.pathname);
  if (splat === null) return notFound();

  // Token-issuing paths are never relayed: their responses contain a token.
  if (splat.toLowerCase().replace(/\/+$/, '') === 'auth/dev-login') return notFound();

  if (UNSAFE_METHODS.has(method) && !originAllowed(request.headers.get('Origin'), deps.publicOrigin)) {
    return errorResponse(403, 'FORBIDDEN', 'Cross-site request refused.');
  }

  // Bodies are read into memory so that they can be sent again after a refresh.
  const body = method === 'GET' ? undefined : await request.arrayBuffer();
  const target = `${deps.apiUrl}/${splat}${url.search}`;
  const isHealth = splat.toLowerCase().replace(/\/+$/, '') === 'health';

  let cookies: string[] = [];
  let accessToken: string | null = null;
  let session = deps.session;

  if (!isHealth) {
    if (!session) return errorResponse(401, 'UNAUTHENTICATED', 'Sign in required.');
    const fresh = await deps.ensureFresh(session);
    if (!fresh) return errorResponse(401, 'UNAUTHENTICATED', 'Your session has ended.', deps.clearCookies());
    session = fresh.session;
    accessToken = fresh.session.accessToken;
    if (fresh.refreshed) cookies = deps.sessionCookies(fresh.session);
  }

  const send = (token: string | null) =>
    callUpstream(target, method, upstreamHeaders(request, token, deps.forwardedFor), body, request.signal, deps);

  let attempt = await send(accessToken);

  if (attempt.response?.status === 401 && session && !isHealth) {
    void attempt.response.body?.cancel().catch(() => undefined);
    const retry = session.refreshToken ? await deps.ensureFresh(session, { force: true }) : null;
    if (!retry) return errorResponse(401, 'UNAUTHENTICATED', 'Your session has ended.', deps.clearCookies());
    cookies = deps.sessionCookies(retry.session);
    attempt = await send(retry.session.accessToken);
    if (attempt.response?.status === 401) {
      // A 401 that survives one refresh: the session is over.
      void attempt.response.body?.cancel().catch(() => undefined);
      return errorResponse(401, 'UNAUTHENTICATED', 'Your session has ended.', deps.clearCookies());
    }
  }

  if (!attempt.response) {
    return attempt.timedOut
      ? errorResponse(504, 'INTERNAL', 'The API did not answer in time.', cookies)
      : errorResponse(502, 'INTERNAL', 'The API is unreachable.', cookies);
  }
  return relay(attempt.response, cookies);
}
