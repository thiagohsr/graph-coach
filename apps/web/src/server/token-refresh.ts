import { createHash } from 'node:crypto';
import type { Session } from './session-cookie';

// Token refresh with a 60 s margin and a single-flight map (contracts/web-server.md §4).

export const REFRESH_MARGIN_MS = 60_000;

export interface TokenResult {
  accessToken: string;
  refreshToken?: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
}

export interface RefreshDeps {
  /** Calls the identity provider's token endpoint; null when it refuses. */
  refresh: (refreshToken: string) => Promise<TokenResult | null>;
  now?: () => number;
}

export interface FreshSession {
  session: Session;
  /** True when the cookies must be rewritten on the response. */
  refreshed: boolean;
}

const inFlight = new Map<string, Promise<TokenResult | null>>();

function key(refreshToken: string): string {
  return createHash('sha256').update(refreshToken).digest('hex');
}

function singleFlight(
  refreshToken: string,
  call: () => Promise<TokenResult | null>,
): Promise<TokenResult | null> {
  const k = key(refreshToken);
  const existing = inFlight.get(k);
  if (existing) return existing;
  const p = call()
    .catch(() => null)
    .finally(() => {
      inFlight.delete(k);
    });
  inFlight.set(k, p);
  return p;
}

/**
 * Returns a session whose access token is good for at least 60 s, or null when it cannot be had (the caller
 * clears the cookies). `force` refreshes regardless of expiry (one retry after an upstream 401).
 */
export async function ensureFresh(
  session: Session,
  { refresh, now = Date.now }: RefreshDeps,
  { force = false }: { force?: boolean } = {},
): Promise<FreshSession | null> {
  const needsRefresh = force || session.expiresAt - now() <= REFRESH_MARGIN_MS;
  if (!needsRefresh) return { session, refreshed: false };

  const refreshToken = session.refreshToken;
  if (!refreshToken) {
    // Development sessions have no refresh token: usable until they expire, then gone.
    return !force && session.expiresAt > now() ? { session, refreshed: false } : null;
  }

  const result = await singleFlight(refreshToken, () => refresh(refreshToken));
  if (!result) return null;
  return {
    session: {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken ?? refreshToken,
      expiresAt: now() + result.expiresIn * 1000,
    },
    refreshed: true,
  };
}
