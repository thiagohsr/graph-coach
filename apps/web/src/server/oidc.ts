import { createHash, randomBytes } from 'node:crypto';
import { safeRedirect } from '../lib/auth/guards';
import {
  clearSession,
  clearTransaction,
  parseCookieHeader,
  readTransaction,
  sessionCookieNames,
  writeSession,
  writeTransaction,
  type Session,
} from './session-cookie';
import type { TokenResult } from './token-refresh';

// Sign-in with the identity provider's hosted page: authorization code with PKCE (contracts/web-server.md §3).
// Every function is pure over `OidcDeps`; nothing here reads the environment or calls the network except
// through `deps.fetch`.

export interface OidcDeps {
  cognitoDomain: string;
  clientId: string;
  /** Public origin of this site, no trailing slash: builds the callback and sign-out return addresses. */
  publicOrigin: string;
  /** Upstream API base URL including `/api`. */
  apiUrl: string;
  secret: string;
  secure: boolean;
  fetch: typeof fetch;
  now?: () => number;
  /** `X-Forwarded-For` value to send on the `/auth/me` call. */
  forwardedFor?: string | undefined;
}

export type Provider = 'google' | 'email';

export interface ExchangeResult extends TokenResult {
  idToken?: string;
}

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

export function callbackUrl(publicOrigin: string): string {
  return `${publicOrigin}/auth/callback`;
}

export function buildAuthorizeUrl(args: {
  cognitoDomain: string;
  clientId: string;
  publicOrigin: string;
  state: string;
  codeChallenge: string;
  provider: Provider;
}): string {
  const url = new URL(`https://${args.cognitoDomain}/oauth2/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', args.clientId);
  url.searchParams.set('redirect_uri', callbackUrl(args.publicOrigin));
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', args.state);
  url.searchParams.set('code_challenge', args.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  // To verify against the pool (research V13): the hint name and the provider name.
  if (args.provider === 'google') url.searchParams.set('identity_provider', 'Google');
  return url.toString();
}

export function buildLogoutUrl(args: {
  cognitoDomain: string;
  clientId: string;
  publicOrigin: string;
}): string {
  const url = new URL(`https://${args.cognitoDomain}/logout`);
  url.searchParams.set('client_id', args.clientId);
  url.searchParams.set('logout_uri', `${args.publicOrigin}/login`);
  return url.toString();
}

function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers });
}

/** `GET /auth/login?provider=&redirect=`: stores the transaction and sends the browser to the provider. */
export async function startLoginHandler(request: Request, deps: OidcDeps): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const provider: Provider = params.get('provider') === 'google' ? 'google' : 'email';
  const { verifier, challenge } = generatePkce();
  const state = randomBytes(24).toString('base64url');
  const target = buildAuthorizeUrl({
    cognitoDomain: deps.cognitoDomain,
    clientId: deps.clientId,
    publicOrigin: deps.publicOrigin,
    state,
    codeChallenge: challenge,
    provider,
  });
  const cookie = writeTransaction(
    { state, codeVerifier: verifier, redirect: safeRedirect(params.get('redirect')) },
    { secret: deps.secret, secure: deps.secure },
  );
  return redirect(target, [cookie]);
}

async function tokenRequest(
  body: Record<string, string>,
  deps: OidcDeps,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await deps.fetch(`https://${deps.cognitoDomain}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(body).toString(),
    });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    return json && typeof json === 'object' ? (json as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function toResult(json: Record<string, unknown>): ExchangeResult | null {
  if (typeof json.access_token !== 'string' || !json.access_token) return null;
  const expiresIn =
    typeof json.expires_in === 'number' && json.expires_in > 0 ? json.expires_in : 3600;
  const out: ExchangeResult = { accessToken: json.access_token, expiresIn };
  if (typeof json.refresh_token === 'string' && json.refresh_token)
    out.refreshToken = json.refresh_token;
  if (typeof json.id_token === 'string' && json.id_token) out.idToken = json.id_token;
  return out;
}

/** Code exchange: the client id and the verifier only, no client secret. */
export async function exchangeCode(
  code: string,
  codeVerifier: string,
  deps: OidcDeps,
): Promise<ExchangeResult | null> {
  const json = await tokenRequest(
    {
      grant_type: 'authorization_code',
      code,
      redirect_uri: callbackUrl(deps.publicOrigin),
      client_id: deps.clientId,
      code_verifier: codeVerifier,
    },
    deps,
  );
  return json ? toResult(json) : null;
}

/** Refresh grant: the client id and the refresh token only. The ID token, if any, is dropped. */
export async function refreshTokens(
  refreshToken: string,
  deps: OidcDeps,
): Promise<TokenResult | null> {
  const json = await tokenRequest(
    { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: deps.clientId },
    deps,
  );
  const result = json ? toResult(json) : null;
  if (!result) return null;
  const { idToken: _discarded, ...rest } = result;
  return rest;
}

type MeOutcome = 'ok' | 'blocked' | 'unverified' | 'account';

/** The one call that carries the ID token: it makes the API create or link the account. */
async function callMe(exchange: ExchangeResult, deps: OidcDeps): Promise<MeOutcome> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${exchange.accessToken}`,
    Accept: 'application/json',
  };
  if (exchange.idToken) headers['X-Id-Token'] = exchange.idToken;
  if (deps.forwardedFor) headers['X-Forwarded-For'] = deps.forwardedFor;
  try {
    const res = await deps.fetch(`${deps.apiUrl}/auth/me`, { method: 'GET', headers });
    if (res.status === 200) return 'ok';
    if (res.status === 403) {
      const body: unknown = await res.json().catch(() => undefined);
      const code = (body as { error?: { code?: unknown } } | undefined)?.error?.code;
      return code === 'ACCOUNT_BLOCKED' ? 'blocked' : 'unverified';
    }
    return 'account';
  } catch {
    return 'account';
  }
}

/** `GET /auth/callback?code=&state=`: steps 1-8 of contracts/web-server.md §3.3. */
export async function callbackHandler(request: Request, deps: OidcDeps): Promise<Response> {
  const now = deps.now ?? Date.now;
  const cookieOptions = { secret: deps.secret, secure: deps.secure };
  const clearTx = clearTransaction(cookieOptions);
  const params = new URL(request.url).searchParams;
  const cookies = parseCookieHeader(request.headers.get('cookie'));

  // 1. The provider refused or the user cancelled.
  if (params.has('error')) return redirect('/login?error=provider', [clearTx]);

  // 2. The transaction must exist and match.
  const tx = readTransaction(cookies, deps.secret);
  const code = params.get('code');
  const state = params.get('state');
  if (!tx || !code || !state || state !== tx.state)
    return redirect('/login?error=state', [clearTx]);

  // 3. Exchange the code.
  const exchange = await exchangeCode(code, tx.codeVerifier, deps);
  if (!exchange) return redirect('/login?error=exchange', [clearTx]);

  // 4. Create or link the account; the ID token is used here and then dropped.
  const outcome = await callMe(exchange, deps);
  const session: Session = {
    accessToken: exchange.accessToken,
    expiresAt: now() + exchange.expiresIn * 1000,
  };
  if (exchange.refreshToken) session.refreshToken = exchange.refreshToken;
  const sessionCookies = () =>
    writeSession(session, { ...cookieOptions, existing: sessionCookieNames(cookies), now: now() });

  switch (outcome) {
    case 'ok': // 5
      return redirect(safeRedirect(tx.redirect), [clearTx, ...sessionCookies()]);
    case 'blocked': // 6: keep the session so /blocked can sign out properly
      return redirect('/blocked', [clearTx, ...sessionCookies()]);
    case 'unverified': // 7
      return redirect('/login?error=unverified', [
        clearTx,
        ...clearSession({ ...cookieOptions, existing: sessionCookieNames(cookies) }),
      ]);
    default: // 8
      return redirect('/login?error=account', [
        clearTx,
        ...clearSession({ ...cookieOptions, existing: sessionCookieNames(cookies) }),
      ]);
  }
}
