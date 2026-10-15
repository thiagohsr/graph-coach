import type { JWK } from 'jose';

/** What a verified token proves. */
export type VerifiedIdentity = { kind: 'cognito'; sub: string } | { kind: 'dev'; userId: string };

/** Profile claims from a verified Cognito ID token. */
export interface IdentityProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  provider: 'google' | 'cognito';
}

export interface TokenVerifier {
  readonly mode: 'cognito' | 'dev';
  /** Verifies an access token. Throws UnauthenticatedError on any failure. */
  verifyAccessToken(token: string): Promise<VerifiedIdentity>;
  /** Cognito only: verifies an ID token and checks its sub equals expectedSub. The dev verifier always throws. */
  verifyIdToken(token: string, expectedSub: string): Promise<IdentityProfile>;
}

/** A remote key-set URL in the application; a local key set in unit tests. */
export type JwksSource = { uri: string } | { keys: JWK[] };

/** Injection token: the TokenVerifier for the configured AUTH_MODE. */
export const TOKEN_VERIFIER = Symbol('TOKEN_VERIFIER');
