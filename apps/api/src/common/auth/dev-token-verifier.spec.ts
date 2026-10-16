import { describe, expect, it } from 'vitest';
import type { Clock } from '../clock';
import { UnauthenticatedError } from '../errors/app-error';
import { DevTokenVerifier } from './dev-token-verifier';

const SECRET = 'a-development-secret-of-16+';
const USER_ID = '8f6c1d58-0000-4000-8000-000000000002';

class FakeClock implements Clock {
  constructor(private ms = Date.UTC(2026, 9, 15, 12, 0, 0)) {}
  now(): Date {
    return new Date(this.ms);
  }
  advance(ms: number): void {
    this.ms += ms;
  }
}

describe('DevTokenVerifier', () => {
  it('sign then verifyAccessToken returns the user id; expiresIn is 3600', async () => {
    const verifier = new DevTokenVerifier({ secret: SECRET, clock: new FakeClock() });
    const { accessToken, expiresIn } = await verifier.sign(USER_ID);
    expect(expiresIn).toBe(3600);
    expect(verifier.mode).toBe('dev');
    expect(await verifier.verifyAccessToken(accessToken)).toEqual({ kind: 'dev', userId: USER_ID });
  });

  it('expires on the fake clock', async () => {
    const clock = new FakeClock();
    const verifier = new DevTokenVerifier({ secret: SECRET, clock });
    const { accessToken } = await verifier.sign(USER_ID);
    clock.advance(3_599_000);
    await expect(verifier.verifyAccessToken(accessToken)).resolves.toBeDefined();
    clock.advance(2_000);
    await expect(verifier.verifyAccessToken(accessToken)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });

  it('a token signed with expiresInSeconds -1 is already expired', async () => {
    const verifier = new DevTokenVerifier({ secret: SECRET, clock: new FakeClock() });
    const { accessToken } = await verifier.sign(USER_ID, { expiresInSeconds: -1 });
    await expect(verifier.verifyAccessToken(accessToken)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });

  it('refuses a token signed with another secret and malformed input', async () => {
    const clock = new FakeClock();
    const mine = new DevTokenVerifier({ secret: SECRET, clock });
    const theirs = new DevTokenVerifier({ secret: 'a-different-secret-of-16+', clock });
    const { accessToken } = await theirs.sign(USER_ID);
    await expect(mine.verifyAccessToken(accessToken)).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(mine.verifyAccessToken('nonsense')).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('verifyIdToken always throws', async () => {
    const verifier = new DevTokenVerifier({ secret: SECRET, clock: new FakeClock() });
    await expect(verifier.verifyIdToken('x', USER_ID)).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});
