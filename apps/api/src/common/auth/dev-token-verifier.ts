import { SignJWT, jwtVerify } from 'jose';
import type { Clock } from '../clock';
import { UnauthenticatedError } from '../errors/app-error';
import type { IdentityProfile, TokenVerifier, VerifiedIdentity } from './token-verifier';

export const DEV_ISSUER = 'coach-dev';
export const DEV_TOKEN_SECONDS = 3600;

/** HS256 with JWT_SECRET; iss = 'coach-dev', token_use = 'access', sub = users.id. Development and tests only. */
export class DevTokenVerifier implements TokenVerifier {
  readonly mode = 'dev' as const;

  private readonly key: Uint8Array;
  private readonly clock: Clock;

  constructor(options: { secret: string; clock: Clock }) {
    this.key = new TextEncoder().encode(options.secret);
    this.clock = options.clock;
  }

  async sign(
    userId: string,
    options: { expiresInSeconds?: number } = {},
  ): Promise<{ accessToken: string; expiresIn: number }> {
    const expiresIn = options.expiresInSeconds ?? DEV_TOKEN_SECONDS;
    const issuedAt = Math.floor(this.clock.now().getTime() / 1000);
    const accessToken = await new SignJWT({ token_use: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer(DEV_ISSUER)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + expiresIn)
      .sign(this.key);
    return { accessToken, expiresIn };
  }

  async verifyAccessToken(token: string): Promise<VerifiedIdentity> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: ['HS256'],
        issuer: DEV_ISSUER,
        currentDate: this.clock.now(),
      });
      if (payload.token_use !== 'access' || !payload.sub) throw new Error('claims');
      return { kind: 'dev', userId: payload.sub };
    } catch {
      throw new UnauthenticatedError();
    }
  }

  async verifyIdToken(_token: string, _expectedSub: string): Promise<IdentityProfile> {
    throw new UnauthenticatedError();
  }
}
