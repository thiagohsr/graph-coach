// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { Session } from './session-cookie';
import { ensureFresh, type TokenResult } from './token-refresh';

const NOW = 1_800_000_000_000;
const now = () => NOW;

const fresh: Session = { accessToken: 'a1', refreshToken: 'r1', expiresAt: NOW + 5 * 60_000 };
const nearExpiry: Session = { accessToken: 'a1', refreshToken: 'r1', expiresAt: NOW + 30_000 };
const expired: Session = { accessToken: 'a1', refreshToken: 'r1', expiresAt: NOW - 1000 };

function refresher(result: TokenResult | null = { accessToken: 'a2', refreshToken: 'r2', expiresIn: 3600 }) {
  return vi.fn(async (_refreshToken: string) => result);
}

describe('ensureFresh', () => {
  it('returns a session that expires in more than 60 s unchanged with no call', async () => {
    const refresh = refresher();
    const out = await ensureFresh(fresh, { refresh, now });
    expect(out).toEqual({ session: fresh, refreshed: false });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes once when the token expires within 60 s and flags the rewrite', async () => {
    const refresh = refresher();
    const out = await ensureFresh(nearExpiry, { refresh, now });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith('r1');
    expect(out).toEqual({
      session: { accessToken: 'a2', refreshToken: 'r2', expiresAt: NOW + 3600_000 },
      refreshed: true,
    });
  });

  it('refreshes an expired session', async () => {
    const refresh = refresher();
    const out = await ensureFresh(expired, { refresh, now });
    expect(out?.refreshed).toBe(true);
  });

  it('shares one in-flight refresh among ten concurrent calls', async () => {
    let release!: (r: TokenResult) => void;
    const refresh = vi.fn(
      (_t: string) =>
        new Promise<TokenResult | null>((resolve) => {
          release = resolve;
        }),
    );
    const calls = Array.from({ length: 10 }, () => ensureFresh(nearExpiry, { refresh, now }));
    release({ accessToken: 'a2', refreshToken: 'r2', expiresIn: 3600 });
    const results = await Promise.all(calls);
    expect(refresh).toHaveBeenCalledTimes(1);
    for (const r of results) expect(r).toEqual(results[0]);
    expect(results[0]?.session.accessToken).toBe('a2');
  });

  it('removes the in-flight entry when the call settles, so a later expiry refreshes again', async () => {
    const refresh = refresher();
    await ensureFresh(nearExpiry, { refresh, now });
    await ensureFresh(nearExpiry, { refresh, now });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('returns null when the refresh fails or throws', async () => {
    expect(await ensureFresh(nearExpiry, { refresh: refresher(null), now })).toBeNull();
    const throwing = vi.fn(async () => {
      throw new Error('network');
    });
    expect(await ensureFresh(nearExpiry, { refresh: throwing, now })).toBeNull();
  });

  it('replaces a rotated refresh token and keeps the old one when none is returned', async () => {
    const rotated = await ensureFresh(nearExpiry, { refresh: refresher({ accessToken: 'a2', refreshToken: 'r2', expiresIn: 60 }), now });
    expect(rotated?.session.refreshToken).toBe('r2');
    const kept = await ensureFresh(nearExpiry, { refresh: refresher({ accessToken: 'a2', expiresIn: 60 }), now });
    expect(kept?.session.refreshToken).toBe('r1');
  });

  it('in dev mode (no refresh token) returns an unexpired session and null for an expired one, never calling out', async () => {
    const refresh = refresher();
    const dev: Session = { accessToken: 'dev', expiresAt: NOW + 10_000 };
    expect(await ensureFresh(dev, { refresh, now })).toEqual({ session: dev, refreshed: false });
    expect(await ensureFresh({ accessToken: 'dev', expiresAt: NOW - 1 }, { refresh, now })).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('force refreshes even when the token looks fresh (retry after an upstream 401)', async () => {
    const refresh = refresher();
    const out = await ensureFresh(fresh, { refresh, now }, { force: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(out?.refreshed).toBe(true);
  });

  it('force without a refresh token returns null', async () => {
    const refresh = refresher();
    expect(await ensureFresh({ accessToken: 'dev', expiresAt: NOW + 10_000 }, { refresh, now }, { force: true })).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });
});
