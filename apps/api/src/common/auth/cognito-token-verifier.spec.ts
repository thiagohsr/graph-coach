import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';

type KeyLike = CryptoKey;
import { beforeAll, describe, expect, it } from 'vitest';
import type { Clock } from '../clock';
import { UnauthenticatedError } from '../errors/app-error';
import { CognitoTokenVerifier } from './cognito-token-verifier';

const ISSUER = 'https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_Abc123';
const CLIENT_ID = 'client-abc';
const SUB = '4f0e7c2a-0000-4000-8000-000000000001';

const clock: Clock = { now: () => new Date('2026-10-15T12:00:00Z') };
const nowSeconds = Math.floor(clock.now().getTime() / 1000);

let privateKey: KeyLike;
let otherPrivateKey: KeyLike;
let verifier: CognitoTokenVerifier;

interface TokenOptions {
  claims?: Record<string, unknown>;
  key?: KeyLike;
  kid?: string;
  alg?: 'RS256';
  issuer?: string;
  exp?: number;
}

async function token(options: TokenOptions = {}): Promise<string> {
  return new SignJWT({ token_use: 'access', client_id: CLIENT_ID, ...options.claims })
    .setProtectedHeader({ alg: options.alg ?? 'RS256', kid: options.kid ?? 'key-1' })
    .setSubject(SUB)
    .setIssuer(options.issuer ?? ISSUER)
    .setIssuedAt(nowSeconds - 60)
    .setExpirationTime(options.exp ?? nowSeconds + 3600)
    .sign(options.key ?? privateKey);
}

const idClaims = (extra: Record<string, unknown> = {}) => ({
  token_use: 'id',
  aud: CLIENT_ID,
  email: 'Ada@Example.test',
  email_verified: true,
  name: 'Ada Lovelace',
  ...extra,
});
/** An ID token has no client_id claim. */
const idToken = (options: TokenOptions = {}) =>
  token({ ...options, claims: { client_id: undefined, ...idClaims(), ...options.claims } });

async function refused(promise: Promise<unknown>): Promise<void> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(UnauthenticatedError);
  expect((error as UnauthenticatedError).code).toBe('UNAUTHENTICATED');
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  const other = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  otherPrivateKey = other.privateKey;
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: 'key-1', alg: 'RS256', use: 'sig' };
  verifier = new CognitoTokenVerifier({
    issuer: ISSUER,
    clientId: CLIENT_ID,
    jwks: { keys: [jwk] },
    clock,
  });
});

describe('CognitoTokenVerifier.verifyAccessToken', () => {
  it('accepts a valid access token', async () => {
    expect(await verifier.verifyAccessToken(await token())).toEqual({ kind: 'cognito', sub: SUB });
  });

  it('refuses an expired token', async () => {
    await refused(verifier.verifyAccessToken(await token({ exp: nowSeconds - 1 })));
  });

  it('refuses a wrong issuer', async () => {
    await refused(verifier.verifyAccessToken(await token({ issuer: 'https://evil.example/pool' })));
  });

  it('refuses a wrong client_id', async () => {
    await refused(
      verifier.verifyAccessToken(await token({ claims: { client_id: 'someone-else' } })),
    );
  });

  it("refuses token_use 'id'", async () => {
    await refused(verifier.verifyAccessToken(await token({ claims: { token_use: 'id' } })));
  });

  it('refuses a signature made with another key', async () => {
    await refused(verifier.verifyAccessToken(await token({ key: otherPrivateKey })));
  });

  it('refuses an unknown key id', async () => {
    await refused(verifier.verifyAccessToken(await token({ kid: 'key-unknown' })));
  });

  it('refuses an HS256 token', async () => {
    const hs = await new SignJWT({ token_use: 'access', client_id: CLIENT_ID })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(SUB)
      .setIssuer(ISSUER)
      .setExpirationTime(nowSeconds + 3600)
      .sign(new TextEncoder().encode('a-secret-that-is-long-enough-123'));
    await refused(verifier.verifyAccessToken(hs));
  });

  it('refuses garbage without echoing it', async () => {
    const error = await verifier.verifyAccessToken('not.a.jwt-secret-value').then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(error).toBeInstanceOf(UnauthenticatedError);
    expect(error!.message).not.toContain('jwt-secret-value');
  });
});

describe('CognitoTokenVerifier.verifyIdToken', () => {
  it('returns the profile of a valid ID token (e-mail trimmed and lower-cased)', async () => {
    expect(await verifier.verifyIdToken(await idToken(), SUB)).toEqual({
      sub: SUB,
      email: 'ada@example.test',
      emailVerified: true,
      name: 'Ada Lovelace',
      provider: 'cognito',
    });
  });

  it('falls back to the local part of the address when there is no name', async () => {
    const profile = await verifier.verifyIdToken(
      await idToken({ claims: { name: undefined } }),
      SUB,
    );
    expect(profile.name).toBe('ada');
  });

  it('reports provider google when the identities claim names Google', async () => {
    const profile = await verifier.verifyIdToken(
      await idToken({ claims: { identities: [{ providerName: 'Google', userId: '1' }] } }),
      SUB,
    );
    expect(profile.provider).toBe('google');
  });

  it('reports an unverified address as emailVerified false', async () => {
    const profile = await verifier.verifyIdToken(
      await idToken({ claims: { email_verified: false } }),
      SUB,
    );
    expect(profile.emailVerified).toBe(false);
  });

  it('refuses a different sub, a wrong aud, a missing email, and an access token', async () => {
    await refused(verifier.verifyIdToken(await idToken(), 'another-sub'));
    await refused(verifier.verifyIdToken(await idToken({ claims: { aud: 'other-client' } }), SUB));
    await refused(verifier.verifyIdToken(await idToken({ claims: { email: undefined } }), SUB));
    await refused(verifier.verifyIdToken(await token(), SUB));
  });

  it('refuses an expired ID token and a bad signature', async () => {
    await refused(verifier.verifyIdToken(await idToken({ exp: nowSeconds - 5 }), SUB));
    await refused(verifier.verifyIdToken(await idToken({ key: otherPrivateKey }), SUB));
  });
});
