// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  buildAuthorizeUrl,
  buildLogoutUrl,
  callbackHandler,
  exchangeCode,
  generatePkce,
  refreshTokens,
  startLoginHandler,
  type OidcDeps,
} from './oidc';
import { parseCookieHeader, parseSetCookie, readSession, readTransaction, unseal } from './session-cookie';

const secret = 'k'.repeat(32);
const NOW = 1_800_000_000_000;

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

function makeDeps(fetchImpl: FetchFn, overrides: Partial<OidcDeps> = {}): OidcDeps & { fetch: ReturnType<typeof vi.fn> } {
  const fetchMock = vi.fn(fetchImpl);
  return {
    cognitoDomain: 'auth.example.com',
    clientId: 'client-123',
    publicOrigin: 'https://coach.example.com',
    apiUrl: 'http://api:3001/api',
    secret,
    secure: true,
    now: () => NOW,
    ...overrides,
    fetch: fetchMock as unknown as typeof fetch,
  } as OidcDeps & { fetch: ReturnType<typeof vi.fn> };
}

const noFetch: FetchFn = async () => {
  throw new Error('fetch must not be called');
};

function setCookies(res: Response): string[] {
  return res.headers.getSetCookie();
}

function cookieMap(res: Response): Record<string, string> {
  const jar: Record<string, string> = {};
  for (const h of setCookies(res)) {
    const c = parseSetCookie(h);
    if (c.maxAge !== 0) jar[c.name] = c.value;
  }
  return jar;
}

function expiredNames(res: Response): string[] {
  return setCookies(res)
    .map(parseSetCookie)
    .filter((c) => c.maxAge === 0)
    .map((c) => c.name);
}

describe('PKCE and the authorize address', () => {
  it('generates an S256 challenge of the verifier', () => {
    const { verifier, challenge } = generatePkce();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
  });

  it('carries the required parameters', () => {
    const url = new URL(
      buildAuthorizeUrl({
        cognitoDomain: 'auth.example.com',
        clientId: 'client-123',
        publicOrigin: 'https://coach.example.com',
        state: 'st',
        codeChallenge: 'ch',
        provider: 'email',
      }),
    );
    expect(url.origin + url.pathname).toBe('https://auth.example.com/oauth2/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'client-123',
      redirect_uri: 'https://coach.example.com/auth/callback',
      scope: 'openid email profile',
      state: 'st',
      code_challenge: 'ch',
      code_challenge_method: 'S256',
    });
  });

  it('adds the identity-provider hint for google only', () => {
    const base = {
      cognitoDomain: 'auth.example.com',
      clientId: 'c',
      publicOrigin: 'https://coach.example.com',
      state: 's',
      codeChallenge: 'x',
    };
    expect(new URL(buildAuthorizeUrl({ ...base, provider: 'google' })).searchParams.get('identity_provider')).toBe('Google');
    expect(new URL(buildAuthorizeUrl({ ...base, provider: 'email' })).searchParams.has('identity_provider')).toBe(false);
  });
});

describe('startLoginHandler', () => {
  it('redirects to the authorize address and stores state, verifier, and a sanitised redirect', async () => {
    const deps = makeDeps(noFetch);
    const res = await startLoginHandler(
      new Request('https://coach.example.com/auth/login?provider=google&redirect=%2Fcoach%3Fx%3D1'),
      deps,
    );
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('Location')!);
    expect(location.host).toBe('auth.example.com');
    expect(location.searchParams.get('identity_provider')).toBe('Google');

    const tx = readTransaction(cookieMap(res), secret);
    expect(tx).not.toBeNull();
    expect(tx!.state).toBe(location.searchParams.get('state'));
    expect(tx!.redirect).toBe('/coach?x=1');
    expect(createHash('sha256').update(tx!.codeVerifier).digest('base64url')).toBe(location.searchParams.get('code_challenge'));
    expect(parseSetCookie(setCookies(res)[0]!)).toMatchObject({ name: 'gc_auth_tx', maxAge: 600, secure: true });
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('uses no hint for e-mail and replaces an unsafe redirect with /puzzles', async () => {
    const res = await startLoginHandler(
      new Request('https://coach.example.com/auth/login?provider=email&redirect=https%3A%2F%2Fevil.example'),
      makeDeps(noFetch),
    );
    expect(new URL(res.headers.get('Location')!).searchParams.has('identity_provider')).toBe(false);
    expect(readTransaction(cookieMap(res), secret)!.redirect).toBe('/puzzles');
  });

  it('uses a fresh state and verifier every time', async () => {
    const a = readTransaction(cookieMap(await startLoginHandler(new Request('https://x/auth/login?provider=email'), makeDeps(noFetch))), secret)!;
    const b = readTransaction(cookieMap(await startLoginHandler(new Request('https://x/auth/login?provider=email'), makeDeps(noFetch))), secret)!;
    expect(a.state).not.toBe(b.state);
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
  });
});

// --- callback ------------------------------------------------------------------------------------------------

const tx = { state: 'good-state', codeVerifier: 'verifier-value', redirect: '/coach' };

async function callbackRequest(query: string, withTx = true, overrideTx: Partial<typeof tx> = {}): Promise<Request> {
  const deps = makeDeps(noFetch);
  const headers: Record<string, string> = {};
  if (withTx) {
    const { writeTransaction } = await import('./session-cookie');
    const header = writeTransaction({ ...tx, ...overrideTx }, { secret, secure: false });
    const c = parseSetCookie(header);
    headers.cookie = `${c.name}=${c.value}`;
  }
  void deps;
  return new Request(`https://coach.example.com/auth/callback?${query}`, { headers });
}

const tokenResponse = (extra: Record<string, unknown> = {}) =>
  Response.json({ access_token: 'ACCESS', refresh_token: 'REFRESH', id_token: 'IDTOKEN', expires_in: 3600, token_type: 'Bearer', ...extra });

function routedFetch(me: () => Response | Promise<Response>, token: () => Response | Promise<Response> = () => tokenResponse()): FetchFn {
  return async (url) => {
    if (String(url).startsWith('https://auth.example.com/oauth2/token')) return token();
    if (String(url) === 'http://api:3001/api/auth/me') return me();
    throw new Error(`unexpected url ${url}`);
  };
}

const meOk = () => Response.json({ id: 'u1', name: 'A', email: 'a@x.io', role: 'learner', status: 'active' });
const apiError = (status: number, code: string) => Response.json({ error: { code, message: code } }, { status });

describe('callbackHandler', () => {
  it('maps a provider error to /login?error=provider without calling anything', async () => {
    const deps = makeDeps(noFetch);
    const res = await callbackHandler(await callbackRequest('error=access_denied&state=good-state'), deps);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/login?error=provider');
    expect(expiredNames(res)).toContain('gc_auth_tx');
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('rejects a missing transaction cookie without calling the token endpoint', async () => {
    const deps = makeDeps(noFetch);
    const res = await callbackHandler(await callbackRequest('code=c&state=good-state', false), deps);
    expect(res.headers.get('Location')).toBe('/login?error=state');
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('rejects a state mismatch or a missing code without calling the token endpoint', async () => {
    const deps = makeDeps(noFetch);
    const mismatch = await callbackHandler(await callbackRequest('code=c&state=other'), deps);
    expect(mismatch.headers.get('Location')).toBe('/login?error=state');
    expect(expiredNames(mismatch)).toContain('gc_auth_tx');
    const noCode = await callbackHandler(await callbackRequest('state=good-state'), deps);
    expect(noCode.headers.get('Location')).toBe('/login?error=state');
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('maps a failed code exchange to /login?error=exchange', async () => {
    const deps = makeDeps(routedFetch(meOk, () => Response.json({ error: 'invalid_grant' }, { status: 400 })));
    const res = await callbackHandler(await callbackRequest('code=c&state=good-state'), deps);
    expect(res.headers.get('Location')).toBe('/login?error=exchange');
    expect(expiredNames(res)).toContain('gc_auth_tx');
    expect(Object.keys(cookieMap(res))).toEqual([]);
  });

  it('treats an exchange without an access token, or a network failure, as an exchange error', async () => {
    const noToken = makeDeps(routedFetch(meOk, () => Response.json({ id_token: 'x' })));
    expect((await callbackHandler(await callbackRequest('code=c&state=good-state'), noToken)).headers.get('Location')).toBe(
      '/login?error=exchange',
    );
    const down = makeDeps(async () => {
      throw new TypeError('network');
    });
    expect((await callbackHandler(await callbackRequest('code=c&state=good-state'), down)).headers.get('Location')).toBe(
      '/login?error=exchange',
    );
  });

  it('exchanges the code with the client id and verifier only, form-encoded, no client secret', async () => {
    const deps = makeDeps(routedFetch(meOk));
    await callbackHandler(await callbackRequest('code=the-code&state=good-state'), deps);
    const [url, init] = deps.fetch.mock.calls[0]!;
    expect(url).toBe('https://auth.example.com/oauth2/token');
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('Content-Type')).toBe('application/x-www-form-urlencoded');
    expect(headers.has('Authorization')).toBe(false);
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      grant_type: 'authorization_code',
      code: 'the-code',
      redirect_uri: 'https://coach.example.com/auth/callback',
      client_id: 'client-123',
      code_verifier: 'verifier-value',
    });
  });

  it('calls GET /auth/me with the Bearer access token and the ID token, seals a session without the ID token, and redirects', async () => {
    const deps = makeDeps(routedFetch(meOk), { forwardedFor: '203.0.113.5' });
    const res = await callbackHandler(await callbackRequest('code=c&state=good-state'), deps);

    const [, meInit] = deps.fetch.mock.calls[1]!;
    const meHeaders = new Headers(meInit.headers);
    expect(deps.fetch.mock.calls[1]![0]).toBe('http://api:3001/api/auth/me');
    expect(meHeaders.get('Authorization')).toBe('Bearer ACCESS');
    expect(meHeaders.get('X-Id-Token')).toBe('IDTOKEN');
    expect(meHeaders.get('X-Forwarded-For')).toBe('203.0.113.5');

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/coach');
    const jar = cookieMap(res);
    expect(readSession(jar, secret)).toEqual({ accessToken: 'ACCESS', refreshToken: 'REFRESH', expiresAt: NOW + 3600_000 });
    // The ID token is never stored: not in the sealed payload and not in any cookie text.
    const first = jar['gc_session.0']!;
    const sealed = unseal<Record<string, unknown>>(first.slice(first.indexOf('.') + 1), secret);
    expect(sealed).not.toHaveProperty('idToken');
    expect(Object.values(jar).join('')).not.toContain('IDTOKEN');
    expect(expiredNames(res)).toContain('gc_auth_tx');
  });

  it('seals the session and goes to /blocked for 403 ACCOUNT_BLOCKED', async () => {
    const deps = makeDeps(routedFetch(() => apiError(403, 'ACCOUNT_BLOCKED')));
    const res = await callbackHandler(await callbackRequest('code=c&state=good-state'), deps);
    expect(res.headers.get('Location')).toBe('/blocked');
    expect(readSession(cookieMap(res), secret)?.accessToken).toBe('ACCESS');
  });

  it('writes no session and goes to /login?error=unverified for 403 FORBIDDEN', async () => {
    const deps = makeDeps(routedFetch(() => apiError(403, 'FORBIDDEN')));
    const res = await callbackHandler(await callbackRequest('code=c&state=good-state'), deps);
    expect(res.headers.get('Location')).toBe('/login?error=unverified');
    expect(Object.keys(cookieMap(res))).toEqual([]);
  });

  it.each([
    ['401', () => apiError(401, 'UNAUTHENTICATED')],
    ['500', () => apiError(500, 'INTERNAL')],
    ['503', () => apiError(503, 'SQL_UNAVAILABLE')],
  ])('writes no session and goes to /login?error=account for %s', async (_label, me) => {
    const res = await callbackHandler(await callbackRequest('code=c&state=good-state'), makeDeps(routedFetch(me)));
    expect(res.headers.get('Location')).toBe('/login?error=account');
    expect(Object.keys(cookieMap(res))).toEqual([]);
  });

  it('writes no session and goes to /login?error=account when the API is unreachable', async () => {
    const deps = makeDeps(
      routedFetch(() => {
        throw new TypeError('ECONNREFUSED');
      }),
    );
    const res = await callbackHandler(await callbackRequest('code=c&state=good-state'), deps);
    expect(res.headers.get('Location')).toBe('/login?error=account');
    expect(Object.keys(cookieMap(res))).toEqual([]);
  });

  it('expires leftover session chunks from an earlier, larger session', async () => {
    const deps = makeDeps(routedFetch(meOk));
    const req = await callbackRequest('code=c&state=good-state');
    const withOld = new Request(req.url, {
      headers: { cookie: `${req.headers.get('cookie')}; gc_session.0=1.x; gc_session.1=y; gc_session.2=z` },
    });
    const res = await callbackHandler(withOld, deps);
    expect(expiredNames(res)).toEqual(expect.arrayContaining(['gc_session.1', 'gc_session.2']));
    expect(parseCookieHeader(withOld.headers.get('cookie'))['gc_session.2']).toBe('z');
  });
});

describe('exchangeCode and refreshTokens', () => {
  it('refreshTokens sends the client id and the refresh token only', async () => {
    const deps = makeDeps(async () => Response.json({ access_token: 'A2', expires_in: 1800 }));
    const out = await refreshTokens('R1', deps);
    expect(out).toEqual({ accessToken: 'A2', expiresIn: 1800 });
    const [url, init] = deps.fetch.mock.calls[0]!;
    expect(url).toBe('https://auth.example.com/oauth2/token');
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'R1',
      client_id: 'client-123',
    });
    expect(new Headers(init.headers).has('Authorization')).toBe(false);
  });

  it('refreshTokens returns a rotated refresh token and null on refusal', async () => {
    const rotated = makeDeps(async () => Response.json({ access_token: 'A2', refresh_token: 'R2', expires_in: 60 }));
    expect(await refreshTokens('R1', rotated)).toEqual({ accessToken: 'A2', refreshToken: 'R2', expiresIn: 60 });
    const refused = makeDeps(async () => Response.json({ error: 'invalid_grant' }, { status: 400 }));
    expect(await refreshTokens('R1', refused)).toBeNull();
    const down = makeDeps(async () => {
      throw new TypeError('network');
    });
    expect(await refreshTokens('R1', down)).toBeNull();
  });

  it('exchangeCode returns the tokens including the ID token', async () => {
    const deps = makeDeps(async () => tokenResponse());
    expect(await exchangeCode('c', 'v', deps)).toEqual({ accessToken: 'ACCESS', refreshToken: 'REFRESH', idToken: 'IDTOKEN', expiresIn: 3600 });
  });
});

describe('buildLogoutUrl', () => {
  it('carries the client id and the return address', () => {
    const url = new URL(buildLogoutUrl({ cognitoDomain: 'auth.example.com', clientId: 'client-123', publicOrigin: 'https://coach.example.com' }));
    expect(url.origin + url.pathname).toBe('https://auth.example.com/logout');
    expect(Object.fromEntries(url.searchParams)).toEqual({ client_id: 'client-123', logout_uri: 'https://coach.example.com/login' });
  });
});
