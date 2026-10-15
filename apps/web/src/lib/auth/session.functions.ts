import { DevLoginRequest, DevLoginResponse, DevUserDto, MeDto } from '@coach/types';
import { createServerFn } from '@tanstack/react-start';
import { appendResponseHeader, getRequest } from '@tanstack/react-start/server';
import type { SessionState } from './guards';

// Server functions of contracts/web-server.md §3.1. Their bodies run on the server only; server-only
// modules are imported dynamically inside the handlers so they never reach the browser bundle.
// Start's call shape is `fn({ data })`, so `devLoginFn({ email })` of the task text is `devLoginFn({ data: { email } })`.

function setCookies(cookies: string[]) {
  if (cookies.length > 0) appendResponseHeader('Set-Cookie', cookies);
}

/** The user, `{ blocked: true }`, or null when there is no usable session (cookies cleared). */
export const getSessionFn = createServerFn({ method: 'GET' }).handler(async (): Promise<SessionState> => {
  const { createWebContext } = await import('~/server/context');
  const ctx = createWebContext(getRequest());
  if (!ctx.session) return null;

  const fresh = await ctx.ensureFresh(ctx.session);
  if (!fresh) {
    setCookies(ctx.clearCookies());
    return null;
  }
  if (fresh.refreshed) setCookies(ctx.sessionCookies(fresh.session));

  const headers: Record<string, string> = { Authorization: `Bearer ${fresh.session.accessToken}`, Accept: 'application/json' };
  if (ctx.forwardedFor) headers['X-Forwarded-For'] = ctx.forwardedFor;

  let res: Response;
  try {
    res = await fetch(`${ctx.env.apiUrl}/auth/me`, { headers });
  } catch {
    throw new Error('Service unavailable.');
  }

  if (res.status === 200) {
    const parsed = MeDto.safeParse(await res.json().catch(() => undefined));
    if (!parsed.success) throw new Error('Unexpected response from the server (GET /auth/me).');
    return parsed.data;
  }
  if (res.status === 403) {
    const body = (await res.json().catch(() => undefined)) as { error?: { code?: string } } | undefined;
    if (body?.error?.code === 'ACCOUNT_BLOCKED') return { blocked: true };
  }
  if (res.status === 401 || res.status === 403) {
    // The API does not accept this session: it is over. Sign-in starts again.
    setCookies(ctx.clearCookies());
    return null;
  }
  throw new Error('Service unavailable.');
});

/** Clears every session cookie; returns where the browser should go next (a full-page navigation). */
export const logoutFn = createServerFn({ method: 'POST' }).handler(async (): Promise<{ redirectTo: string }> => {
  const [{ createWebContext }, { buildLogoutUrl }] = await Promise.all([import('~/server/context'), import('~/server/oidc')]);
  const ctx = createWebContext(getRequest());
  setCookies(ctx.clearCookies());
  if (ctx.oidc) {
    return { redirectTo: buildLogoutUrl({ cognitoDomain: ctx.oidc.cognitoDomain, clientId: ctx.oidc.clientId, publicOrigin: ctx.publicOrigin }) };
  }
  return { redirectTo: '/login' };
});

export type DevLoginResult = { ok: true } | { ok: false; code: 'INVALID_CREDENTIALS' | 'UNAVAILABLE'; message: string };

/** Development sign-in: seals the API's token into the session cookie and never returns it. */
export const devLoginFn = createServerFn({ method: 'POST' })
  .validator((input: { email: string }) => DevLoginRequest.parse(input))
  .handler(async ({ data }): Promise<DevLoginResult> => {
    const { createWebContext } = await import('~/server/context');
    const ctx = createWebContext(getRequest());
    if (ctx.env.authMode !== 'dev') throw new Error('Development sign-in is not enabled.');

    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (ctx.forwardedFor) headers['X-Forwarded-For'] = ctx.forwardedFor;
    let res: Response;
    try {
      res = await fetch(`${ctx.env.apiUrl}/auth/dev-login`, { method: 'POST', headers, body: JSON.stringify({ email: data.email }) });
    } catch {
      return { ok: false, code: 'UNAVAILABLE', message: 'Service unavailable.' };
    }
    if (res.status === 401) return { ok: false, code: 'INVALID_CREDENTIALS', message: 'That account does not exist in the seed data.' };
    const parsed = res.ok ? DevLoginResponse.safeParse(await res.json().catch(() => undefined)) : null;
    if (!parsed?.success) return { ok: false, code: 'UNAVAILABLE', message: 'Service unavailable.' };

    setCookies(ctx.sessionCookies({ accessToken: parsed.data.accessToken, expiresAt: Date.now() + parsed.data.expiresIn * 1000 }));
    return { ok: true };
  });

export const getAuthModeFn = createServerFn({ method: 'GET' }).handler(async (): Promise<'cognito' | 'dev'> => {
  const { getEnv } = await import('~/server/env');
  return getEnv().authMode;
});

/** The seeded demo accounts for the development picker. Called without a session. */
export const getDevUsersFn = createServerFn({ method: 'GET' }).handler(async (): Promise<DevUserDto[]> => {
  const { createWebContext } = await import('~/server/context');
  const ctx = createWebContext(getRequest());
  if (ctx.env.authMode !== 'dev') throw new Error('Development sign-in is not enabled.');
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (ctx.forwardedFor) headers['X-Forwarded-For'] = ctx.forwardedFor;
  let res: Response;
  try {
    res = await fetch(`${ctx.env.apiUrl}/auth/dev-users`, { headers });
  } catch {
    throw new Error('Service unavailable.');
  }
  if (!res.ok) throw new Error('Service unavailable.');
  const parsed = DevUserDto.array().safeParse(await res.json().catch(() => undefined));
  if (!parsed.success) throw new Error('Unexpected response from the server (GET /auth/dev-users).');
  return parsed.data;
});
