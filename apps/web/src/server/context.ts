import { getEnv, type WebEnv } from './env';
import { refreshTokens, type OidcDeps } from './oidc';
import {
  clearSession,
  parseCookieHeader,
  readSession,
  sessionCookieNames,
  writeSession,
  type Session,
} from './session-cookie';
import { ensureFresh, type FreshSession } from './token-refresh';
import { forwardedFor, peerAddress, publicOrigin } from './trust';

// Per-request wiring of the pure server modules to the environment and the incoming request.
// Server-only: imported dynamically from handlers so that it never reaches the browser bundle.

export interface WebContext {
  env: WebEnv;
  request: Request;
  cookies: Record<string, string>;
  /** The decrypted session, or null when absent or unreadable. */
  session: Session | null;
  publicOrigin: string;
  /** `X-Forwarded-For` for upstream calls made on behalf of this request. */
  forwardedFor: string | undefined;
  /** OIDC deps; null in `dev` mode. */
  oidc: OidcDeps | null;
  ensureFresh: (session: Session, options?: { force?: boolean }) => Promise<FreshSession | null>;
  sessionCookies: (session: Session) => string[];
  clearCookies: () => string[];
}

export function createWebContext(request: Request, fetchImpl: typeof fetch = fetch): WebContext {
  const env = getEnv();
  const cookies = parseCookieHeader(request.headers.get('cookie'));
  const origin = publicOrigin(request.url, env.webOrigin);
  const xff = forwardedFor(
    peerAddress(request),
    request.headers.get('x-forwarded-for'),
    env.trustProxy,
  );
  const cookieOptions = { secret: env.sessionSecret, secure: env.cookieSecure };
  const existing = sessionCookieNames(cookies);

  const oidc: OidcDeps | null =
    env.authMode === 'cognito' && env.cognitoDomain && env.cognitoClientId
      ? {
          cognitoDomain: env.cognitoDomain,
          clientId: env.cognitoClientId,
          publicOrigin: origin,
          apiUrl: env.apiUrl,
          secret: env.sessionSecret,
          secure: env.cookieSecure,
          fetch: fetchImpl,
          forwardedFor: xff,
        }
      : null;

  return {
    env,
    request,
    cookies,
    session: readSession(cookies, env.sessionSecret),
    publicOrigin: origin,
    forwardedFor: xff,
    oidc,
    ensureFresh: (session, options) =>
      ensureFresh(
        session,
        {
          refresh: (refreshToken) =>
            oidc ? refreshTokens(refreshToken, oidc) : Promise.resolve(null),
        },
        options,
      ),
    sessionCookies: (session) => writeSession(session, { ...cookieOptions, existing }),
    clearCookies: () => clearSession({ ...cookieOptions, existing }),
  };
}
