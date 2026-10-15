import {
  createLocalJWKSet,
  createRemoteJWKSet,
  jwtVerify,
  type JSONWebKeySet,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';
import type { Clock } from '../clock';
import { UnauthenticatedError } from '../errors/app-error';
import type {
  IdentityProfile,
  JwksSource,
  TokenVerifier,
  VerifiedIdentity,
} from './token-verifier';

const REFETCH_COOLDOWN_MS = 60_000;

/**
 * RS256 against the pool's key set (fetched lazily, cached, refetched on an unknown key id at most once a minute).
 * Every failure is an UnauthenticatedError; the token is never echoed.
 */
export class CognitoTokenVerifier implements TokenVerifier {
  readonly mode = 'cognito' as const;

  private readonly issuer: string;
  private readonly clientId: string;
  private readonly clock: Clock;
  private readonly keys: JWTVerifyGetKey;

  constructor(options: { issuer: string; clientId: string; jwks: JwksSource; clock: Clock }) {
    this.issuer = options.issuer;
    this.clientId = options.clientId;
    this.clock = options.clock;
    this.keys =
      'uri' in options.jwks
        ? createRemoteJWKSet(new URL(options.jwks.uri), { cooldownDuration: REFETCH_COOLDOWN_MS })
        : createLocalJWKSet({ keys: options.jwks.keys } satisfies JSONWebKeySet);
  }

  async verifyAccessToken(token: string): Promise<VerifiedIdentity> {
    const payload = await this.verify(token, { issuer: this.issuer });
    if (payload.token_use !== 'access' || payload.client_id !== this.clientId || !payload.sub) {
      throw new UnauthenticatedError();
    }
    return { kind: 'cognito', sub: payload.sub };
  }

  async verifyIdToken(token: string, expectedSub: string): Promise<IdentityProfile> {
    const payload = await this.verify(token, { issuer: this.issuer, audience: this.clientId });
    if (payload.token_use !== 'id' || payload.sub !== expectedSub) throw new UnauthenticatedError();
    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    if (email === '') throw new UnauthenticatedError();

    const claimedName = typeof payload.name === 'string' ? payload.name.trim() : '';
    return {
      sub: expectedSub,
      email,
      emailVerified: payload.email_verified === true || payload.email_verified === 'true',
      name: claimedName !== '' ? claimedName : email.split('@')[0]!,
      provider: namesGoogle(payload.identities) ? 'google' : 'cognito',
    };
  }

  private async verify(
    token: string,
    options: { issuer: string; audience?: string },
  ): Promise<JWTPayload> {
    try {
      const { payload } = await jwtVerify(token, this.keys, {
        algorithms: ['RS256'],
        issuer: options.issuer,
        ...(options.audience !== undefined ? { audience: options.audience } : {}),
        currentDate: this.clock.now(),
      });
      return payload;
    } catch {
      throw new UnauthenticatedError();
    }
  }
}

function namesGoogle(identities: unknown): boolean {
  return (
    Array.isArray(identities) &&
    identities.some(
      (identity) =>
        typeof identity === 'object' &&
        identity !== null &&
        String((identity as { providerName?: unknown }).providerName).toLowerCase() === 'google',
    )
  );
}
