// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CHUNK_LIMIT,
  clearSession,
  clearTransaction,
  parseCookieHeader,
  parseSetCookie,
  readSession,
  readTransaction,
  seal,
  sessionCookieNames,
  unseal,
  writeSession,
  writeTransaction,
  type Session,
} from './session-cookie';

const secret = 'a'.repeat(32);
const otherSecret = 'b'.repeat(32);
const opts = { secret, secure: false };

const small: Session = { accessToken: 'access', refreshToken: 'refresh', expiresAt: 1_800_000_000_000 };

/** A token-like string that does not compress, so that the sealed value is large. */
const big = (n: number) => randomBytes(n).toString('base64url');

/** Applies Set-Cookie header values to a cookie jar, as a browser would. */
function apply(jar: Record<string, string>, setCookies: string[]): Record<string, string> {
  const next = { ...jar };
  for (const header of setCookies) {
    const c = parseSetCookie(header);
    if (c.maxAge === 0 || c.value === '') delete next[c.name];
    else next[c.name] = c.value;
  }
  return next;
}

describe('seal / unseal', () => {
  it('round-trips a payload', () => {
    expect(unseal(seal(small, secret), secret)).toEqual(small);
  });

  it('returns null for a tampered value', () => {
    const sealed = seal(small, secret);
    const i = Math.floor(sealed.length / 2);
    const tampered = sealed.slice(0, i) + (sealed[i] === 'A' ? 'B' : 'A') + sealed.slice(i + 1);
    expect(unseal(tampered, secret)).toBeNull();
  });

  it('returns null for a value sealed with another secret', () => {
    expect(unseal(seal(small, otherSecret), secret)).toBeNull();
  });

  it('returns null for garbage', () => {
    expect(unseal('not-a-sealed-value', secret)).toBeNull();
    expect(unseal('', secret)).toBeNull();
  });

  it('does not open a value sealed for another purpose', () => {
    expect(unseal(seal(small, secret, 'tx'), secret, 'session')).toBeNull();
  });
});

describe('session cookies', () => {
  it('writes a small session in one cookie and reads it back', () => {
    const headers = writeSession(small, { ...opts, now: 1_700_000_000_000 });
    expect(headers).toHaveLength(1);
    const jar = apply({}, headers);
    expect(Object.keys(jar)).toEqual(['gc_session.0']);
    expect(readSession(jar, secret)).toEqual(small);
  });

  it('splits a large payload into numbered cookies within the size limit and reassembles them in order', () => {
    const large: Session = { accessToken: big(2600), refreshToken: big(2600), expiresAt: small.expiresAt };
    const headers = writeSession(large, opts);
    expect(headers.length).toBeGreaterThan(1);
    const jar = apply({}, headers);
    expect(Object.keys(jar)).toEqual(headers.map((_, i) => `gc_session.${i}`));
    for (const [name, value] of Object.entries(jar)) {
      expect(`${name}=${value}`.length).toBeLessThanOrEqual(CHUNK_LIMIT);
    }
    expect(readSession(jar, secret)).toEqual(large);
  });

  it('reads nothing when a chunk is missing, a chunk is altered, or the secret differs', () => {
    const large: Session = { accessToken: big(2600), refreshToken: big(2600), expiresAt: small.expiresAt };
    const jar = apply({}, writeSession(large, opts));
    const { 'gc_session.1': _dropped, ...missing } = jar;
    expect(readSession(missing, secret)).toBeNull();
    expect(readSession({ ...jar, 'gc_session.1': jar['gc_session.1']!.slice(0, -4) + 'AAAA' }, secret)).toBeNull();
    expect(readSession(jar, otherSecret)).toBeNull();
    expect(readSession({}, secret)).toBeNull();
  });

  it('expires leftover chunks when a shorter session is written', () => {
    const large: Session = { accessToken: big(2600), refreshToken: big(2600), expiresAt: small.expiresAt };
    const first = apply({}, writeSession(large, opts));
    const count = Object.keys(first).length;
    expect(count).toBeGreaterThan(1);

    const second = writeSession(small, { ...opts, existing: sessionCookieNames(first) });
    const expired = second.map(parseSetCookie).filter((c) => c.maxAge === 0).map((c) => c.name);
    expect(expired).toEqual(Array.from({ length: count - 1 }, (_, i) => `gc_session.${i + 1}`));
    const jar = apply(first, second);
    expect(Object.keys(jar)).toEqual(['gc_session.0']);
    expect(readSession(jar, secret)).toEqual(small);
  });

  it('clear expires every chunk', () => {
    const large: Session = { accessToken: big(2600), refreshToken: big(2600), expiresAt: small.expiresAt };
    const jar = apply({}, writeSession(large, opts));
    const cleared = clearSession({ ...opts, existing: sessionCookieNames(jar) });
    expect(cleared.map((h) => parseSetCookie(h).name)).toEqual(Object.keys(jar));
    expect(apply(jar, cleared)).toEqual({});
  });

  it('clear with no known cookies still expires the first chunk', () => {
    const cleared = clearSession(opts);
    expect(cleared.map((h) => parseSetCookie(h).name)).toEqual(['gc_session.0']);
  });

  it('sets HttpOnly, SameSite=Lax, Path=/, and Secure only when configured', () => {
    const plain = parseSetCookie(writeSession(small, opts)[0]!);
    expect(plain).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/', secure: false });
    const secure = parseSetCookie(writeSession(small, { ...opts, secure: true })[0]!);
    expect(secure.secure).toBe(true);
    const cleared = parseSetCookie(clearSession({ secure: true, secret })[0]!);
    expect(cleared).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/', secure: true });
  });

  it('lives 30 days with a refresh token and until expiry without one', () => {
    const now = 1_700_000_000_000;
    const withRefresh = parseSetCookie(writeSession(small, { ...opts, now })[0]!);
    expect(withRefresh.maxAge).toBe(30 * 24 * 3600);
    const dev: Session = { accessToken: 'dev', expiresAt: now + 3600_000 };
    expect(parseSetCookie(writeSession(dev, { ...opts, now })[0]!).maxAge).toBe(3600);
  });
});

describe('transaction cookie', () => {
  const tx = { state: 's', codeVerifier: 'v', redirect: '/coach' };

  it('round-trips and lives 10 minutes with the same attributes', () => {
    const header = writeTransaction(tx, opts);
    const parsed = parseSetCookie(header);
    expect(parsed).toMatchObject({ name: 'gc_auth_tx', maxAge: 600, httpOnly: true, sameSite: 'Lax', path: '/' });
    expect(readTransaction({ gc_auth_tx: parsed.value }, secret)).toEqual(tx);
  });

  it('is not readable as a session and not readable with another secret', () => {
    const parsed = parseSetCookie(writeTransaction(tx, opts));
    expect(readTransaction({ gc_auth_tx: parsed.value }, otherSecret)).toBeNull();
    expect(readSession({ 'gc_session.0': `1.${parsed.value}` }, secret)).toBeNull();
  });

  it('clear expires it', () => {
    expect(parseSetCookie(clearTransaction(opts))).toMatchObject({ name: 'gc_auth_tx', maxAge: 0 });
  });
});

describe('parseCookieHeader', () => {
  it('parses a Cookie header', () => {
    expect(parseCookieHeader('a=1; b=two; c=')).toEqual({ a: '1', b: 'two', c: '' });
    expect(parseCookieHeader(null)).toEqual({});
  });
});
