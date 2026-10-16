import { Controller, Get, Logger, Res } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Response } from 'express';
import { SignJWT, decodeJwt, exportJWK, generateKeyPair, type JWK } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GraphKit, GraphUnavailableError } from '@coach/graph-kit';
import { AccountsService } from '../src/apps/accounts/accounts.service';
import { userIdentities, users } from '../src/apps/accounts/user.model';
import { UserDirectory } from '../src/apps/accounts/user-directory';
import { DevAuthController } from '../src/apps/accounts/dev-auth.controller';
import { CognitoTokenVerifier } from '../src/common/auth/cognito-token-verifier';
import { Roles } from '../src/common/auth/decorators';
import { TOKEN_VERIFIER } from '../src/common/auth/token-verifier';
import { CLOCK, type Clock } from '../src/common/clock';
import { createTestApp, type TestApp } from './support/test-app';

const REGION = 'eu-west-1';
const POOL = 'eu-west-1_Abc123';
const CLIENT_ID = 'test-client-id';
const ISSUER = `https://cognito-idp.${REGION}.amazonaws.com/${POOL}`;
const BOSS = 'boss@example.test';

@Controller('test')
class TestController {
  @Roles('reviewer', 'admin')
  @Get('staff')
  staff() {
    return { ok: true };
  }

  /** An event stream: three events 150 ms apart, then the terminal one. */
  @Get('stream')
  stream(@Res() res: Response) {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    let n = 0;
    const timer = setInterval(() => {
      n += 1;
      if (n < 4) {
        res.write(`data: ${n}\n\n`);
      } else {
        res.write('data: done\n\n');
        clearInterval(timer);
        res.end();
      }
    }, 150);
    res.on('close', () => clearInterval(timer));
  }
}

// ─── Log capture: no e-mail address and no token may reach a logger ──────────────────────────────────────────────

const logged: string[] = [];
for (const level of ['log', 'warn', 'error', 'debug', 'verbose', 'fatal'] as const) {
  vi.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
    logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  });
}

// ─── Cognito helpers: a key pair generated here, no network ─────────────────────────────────────────────────────

let signingKey: CryptoKey;
let publicJwk: JWK;

interface Minted {
  access: string;
  id: string;
}

async function mint(
  a: TestApp,
  sub: string,
  options: { email?: string; verified?: boolean; name?: string; google?: boolean } = {},
): Promise<Minted> {
  const now = Math.floor(a.clock.now().getTime() / 1000);
  const sign = (claims: Record<string, unknown>) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setSubject(sub)
      .setIssuer(ISSUER)
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(signingKey);
  return {
    access: await sign({ token_use: 'access', client_id: CLIENT_ID }),
    id: await sign({
      token_use: 'id',
      aud: CLIENT_ID,
      email: options.email ?? `${sub}@example.test`,
      email_verified: options.verified ?? true,
      ...(options.name !== undefined ? { name: options.name } : {}),
      ...(options.google ? { identities: [{ providerName: 'Google', userId: sub }] } : {}),
    }),
  };
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function reset(a: TestApp): Promise<void> {
  await a.db.delete(userIdentities);
  await a.db.delete(users);
  await a.testGraph.clear();
  a.clock.advance(10_000); // flushes the account caches
}

const userRows = (a: TestApp) => a.db.select().from(users);
const identityRows = (a: TestApp) => a.db.select().from(userIdentities);
const learnerProps = (a: TestApp) =>
  a.testGraph.cypher<{ p: Record<string, unknown> }>('MATCH (l:Learner) RETURN properties(l) AS p');

let c: TestApp; // Cognito mode: tokens are verified against a key set generated in this file
let d: TestApp; // development mode

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  signingKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };

  c = await createTestApp({
    env: {
      AUTH_MODE: 'cognito',
      COGNITO_REGION: REGION,
      COGNITO_USER_POOL_ID: POOL,
      COGNITO_CLIENT_ID: CLIENT_ID,
      BOOTSTRAP_ADMIN_EMAILS: BOSS,
    },
    configure: (builder) =>
      builder.overrideProvider(TOKEN_VERIFIER).useFactory({
        inject: [CLOCK],
        factory: (clock: Clock) =>
          new CognitoTokenVerifier({
            issuer: ISSUER,
            clientId: CLIENT_ID,
            jwks: { keys: [publicJwk] },
            clock,
          }),
      }),
  });
  d = await createTestApp({ controllers: [TestController] });
});

afterAll(async () => {
  await Promise.all([c?.close(), d?.close()]);
});

beforeEach(async () => {
  await Promise.all([reset(c), reset(d)]);
});

// ─── First sight, linking, verification ──────────────────────────────────────────────────────────────────────────

describe('GET /auth/me: first sight (Cognito)', () => {
  it('creates the account, the identity, and one Learner node from the ID token', async () => {
    const t = await mint(c, 'sub-ada', { email: 'Ada@Example.test', name: 'Ada Lovelace' });
    const res = await c.http.get('/auth/me').set(bearer(t.access)).set('X-Id-Token', t.id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'Ada Lovelace',
      email: 'ada@example.test',
      role: 'learner',
      status: 'active',
    });

    const rows = await userRows(c);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: 'ada@example.test', displayName: 'Ada Lovelace', role: 'learner', status: 'active' });
    expect(res.body.id).toBe(rows[0]!.id);
    const identities = await identityRows(c);
    expect(identities).toHaveLength(1);
    expect(identities[0]).toMatchObject({ cognitoSub: 'sub-ada', userId: rows[0]!.id, provider: 'cognito' });

    const nodes = await learnerProps(c);
    expect(nodes).toHaveLength(1);
    expect(Object.keys(nodes[0]!.p).sort()).toEqual(['createdAt', 'displayName', 'id']);
    expect(nodes[0]!.p.id).toBe(rows[0]!.id);

    // A second request needs no ID token.
    const again = await c.http.get('/auth/me').set(bearer(t.access));
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(res.body.id);
    expect(await userRows(c)).toHaveLength(1);
  });

  it('records provider google when the ID token names Google', async () => {
    const t = await mint(c, 'sub-g', { google: true });
    await c.http.get('/auth/me').set(bearer(t.access)).set('X-Id-Token', t.id).expect(200);
    expect((await identityRows(c))[0]!.provider).toBe('google');
  });

  it('401 without the ID token, or with the ID token of another sub, and creates nothing', async () => {
    const t = await mint(c, 'sub-x');
    const other = await mint(c, 'sub-y');
    const none = await c.http.get('/auth/me').set(bearer(t.access));
    expect(none.status).toBe(401);
    expect(none.body.error.message).toContain('Account not initialised');
    const wrong = await c.http.get('/auth/me').set(bearer(t.access)).set('X-Id-Token', other.id);
    expect(wrong.status).toBe(401);
    expect(await userRows(c)).toHaveLength(0);
    expect(await identityRows(c)).toHaveLength(0);
    expect(await learnerProps(c)).toHaveLength(0);
  });

  it('links a seeded account with the same verified address: same id, role, and history', async () => {
    const seeded = await c.createUser({ email: 'seeded@example.test', role: 'reviewer', name: 'Seeded', signedIn: false });
    await c.testGraph.cypher(`MATCH (l:Learner {id: $id}) CREATE (l)-[:PLAYED]->(:Session {id: 'old-session'})`, { id: seeded.id });
    const t = await mint(c, 'sub-seeded', { email: 'seeded@example.test', name: 'Someone Else' });

    const res = await c.http.get('/auth/me').set(bearer(t.access)).set('X-Id-Token', t.id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: seeded.id, role: 'reviewer', name: 'Seeded' });
    expect(await userRows(c)).toHaveLength(1);
    expect(await identityRows(c)).toEqual([expect.objectContaining({ cognitoSub: 'sub-seeded', userId: seeded.id })]);
    expect(await learnerProps(c)).toHaveLength(1);
    expect(await c.testGraph.countEdges('PLAYED')).toBe(1);
  });

  it('attaches a second identity with the same verified address to the existing account', async () => {
    const google = await mint(c, 'sub-google', { email: 'same@example.test', google: true });
    const first = await c.http.get('/auth/me').set(bearer(google.access)).set('X-Id-Token', google.id);
    expect(first.status).toBe(200);
    const password = await mint(c, 'sub-password', { email: 'same@example.test' });
    const second = await c.http.get('/auth/me').set(bearer(password.access)).set('X-Id-Token', password.id);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);

    expect(await userRows(c)).toHaveLength(1);
    const identities = await identityRows(c);
    expect(identities.map((i) => [i.cognitoSub, i.provider]).sort()).toEqual([
      ['sub-google', 'google'],
      ['sub-password', 'cognito'],
    ]);
    expect(await learnerProps(c)).toHaveLength(1);
    // Both identities' tokens work without the ID token.
    await c.http.get('/auth/me').set(bearer(google.access)).expect(200);
    await c.http.get('/auth/me').set(bearer(password.access)).expect(200);
  });

  it('refuses an unverified address with 403 FORBIDDEN and writes nothing, then succeeds once verified', async () => {
    const unverified = await mint(c, 'sub-u', { email: 'u@example.test', verified: false });
    const res = await c.http.get('/auth/me').set(bearer(unverified.access)).set('X-Id-Token', unverified.id);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.error.message).toBe('Verify your e-mail address to use this site');
    expect(await userRows(c)).toHaveLength(0);
    expect(await identityRows(c)).toHaveLength(0);
    expect(await learnerProps(c)).toHaveLength(0);

    // The same refusal when the address already has an account: nothing is attached.
    await c.createUser({ email: 'owned@example.test', signedIn: false });
    const owned = await mint(c, 'sub-owned', { email: 'owned@example.test', verified: false });
    const refused = await c.http.get('/auth/me').set(bearer(owned.access)).set('X-Id-Token', owned.id);
    expect(refused.status).toBe(403);
    expect(await identityRows(c)).toHaveLength(0);

    const verified = await mint(c, 'sub-u', { email: 'u@example.test', verified: true });
    await c.http.get('/auth/me').set(bearer(verified.access)).set('X-Id-Token', verified.id).expect(200);
    expect(await userRows(c)).toHaveLength(2);
  });

  it('survives two first requests at once for one identity, and for two identities of one address', async () => {
    const t = await mint(c, 'sub-race', { email: 'race@example.test' });
    const send = () => c.http.get('/auth/me').set(bearer(t.access)).set('X-Id-Token', t.id);
    const same = await Promise.all([send(), send(), send()]);
    expect(same.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(new Set(same.map((r) => r.body.id)).size).toBe(1);
    expect(await userRows(c)).toHaveLength(1);
    expect(await learnerProps(c)).toHaveLength(1);

    await reset(c);
    const a = await mint(c, 'sub-race-a', { email: 'two@example.test' });
    const b = await mint(c, 'sub-race-b', { email: 'two@example.test' });
    const both = await Promise.all([
      c.http.get('/auth/me').set(bearer(a.access)).set('X-Id-Token', a.id),
      c.http.get('/auth/me').set(bearer(b.access)).set('X-Id-Token', b.id),
    ]);
    expect(both.map((r) => r.status)).toEqual([200, 200]);
    expect(both[0]!.body.id).toBe(both[1]!.body.id);
    expect(await userRows(c)).toHaveLength(1);
    expect(await identityRows(c)).toHaveLength(2);
    expect(await learnerProps(c)).toHaveLength(1);
  });

  it('makes an address in BOOTSTRAP_ADMIN_EMAILS an admin on creation', async () => {
    const t = await mint(c, 'sub-boss', { email: BOSS });
    const res = await c.http.get('/auth/me').set(bearer(t.access)).set('X-Id-Token', t.id);
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('admin');
  });

  it("attaches a blocked account's new identity and answers 403 ACCOUNT_BLOCKED", async () => {
    const seeded = await c.createUser({ email: 'blocked@example.test', status: 'blocked', signedIn: false });
    const t = await mint(c, 'sub-blocked', { email: 'blocked@example.test' });
    const res = await c.http.get('/auth/me').set(bearer(t.access)).set('X-Id-Token', t.id);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_BLOCKED');
    expect(await identityRows(c)).toEqual([expect.objectContaining({ userId: seeded.id })]);
  });

  it('answers 503 and creates no users row when the graph is down', async () => {
    const graph = c.app.get(GraphKit);
    const spy = vi.spyOn(graph, 'runOne').mockRejectedValue(new GraphUnavailableError());
    try {
      const t = await mint(c, 'sub-down', { email: 'down@example.test' });
      const res = await c.http.get('/auth/me').set(bearer(t.access)).set('X-Id-Token', t.id);
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('GRAPH_UNAVAILABLE');
      expect(await userRows(c)).toHaveLength(0);
      expect(await identityRows(c)).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
    // The next request tries again and succeeds.
    const t = await mint(c, 'sub-down', { email: 'down@example.test' });
    await c.http.get('/auth/me').set(bearer(t.access)).set('X-Id-Token', t.id).expect(200);
  });

  it('calls delete_learner when the commit fails after the node was written', async () => {
    const graph = c.app.get(GraphKit);
    const runOne = vi.spyOn(graph, 'runOne');
    const realTransaction = c.db.transaction.bind(c.db) as (...args: unknown[]) => Promise<unknown>;
    const transaction = vi
      .spyOn(c.db, 'transaction')
      .mockImplementationOnce((async (...args: unknown[]) => {
        await realTransaction(...args);
        throw new Error('commit failed');
      }) as never);
    try {
      const t = await mint(c, 'sub-commit', { email: 'commit@example.test' });
      const res = await c.http.get('/auth/me').set(bearer(t.access)).set('X-Id-Token', t.id);
      expect(res.status).toBe(500);
      const names = runOne.mock.calls.map((call) => (call[0] as { name: string }).name);
      expect(names).toContain('create_learner');
      expect(names).toContain('delete_learner');
      expect(await learnerProps(c)).toHaveLength(0);
    } finally {
      transaction.mockRestore();
      runOne.mockRestore();
    }
  });

  it('refuses expired, malformed, foreign, and development tokens', async () => {
    await c.http.get('/auth/me').expect(401);
    await c.http.get('/auth/me').set(bearer('not-a-token')).expect(401);
    const user = await c.createUser();
    await c.http.get('/auth/me').set(user.auth).expect(401); // a development token in cognito mode
    await c.http.get('/auth/me').set(bearer(await c.expiredToken(user.id))).expect(401);
    const now = Math.floor(c.clock.now().getTime() / 1000);
    const foreign = await new SignJWT({ token_use: 'access', client_id: CLIENT_ID })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setSubject('sub-f')
      .setIssuer('https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_Other')
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(signingKey);
    await c.http.get('/auth/me').set(bearer(foreign)).expect(401);
  });
});

// ─── Status and role are read from the table ────────────────────────────────────────────────────────────────────

describe('status and role changes (development mode)', () => {
  it('blocking through setStatus is seen at once; unblocking restores access', async () => {
    const user = await d.createUser();
    await d.http.get('/auth/me').set(user.auth).expect(200);
    await d.setStatus(user.id, 'blocked');
    const res = await d.http.get('/auth/me').set(user.auth);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_BLOCKED');
    await d.setStatus(user.id, 'active');
    await d.http.get('/auth/me').set(user.auth).expect(200);
  });

  it('a status written directly to the table takes effect after 5 seconds', async () => {
    const user = await d.createUser();
    await d.http.get('/auth/me').set(user.auth).expect(200);
    await d.db.update(users).set({ status: 'blocked' }).where(eqId(user.id));
    await d.http.get('/auth/me').set(user.auth).expect(200); // still cached
    d.clock.advance(5_000);
    const res = await d.http.get('/auth/me').set(user.auth);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_BLOCKED');
  });

  it('a role change is seen the same way', async () => {
    const user = await d.createUser();
    await d.http.get('/test/staff').set(user.auth).expect(403);
    await d.app.get(AccountsService).setRole(null, user.id, 'reviewer');
    await d.http.get('/test/staff').set(user.auth).expect(200);
  });

  it('a learner token on a @Roles("reviewer", "admin") route is 403 FORBIDDEN', async () => {
    const learner = await d.createUser();
    const res = await d.http.get('/test/staff').set(learner.auth);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    const reviewer = await d.createUser({ role: 'reviewer' });
    await d.http.get('/test/staff').set(reviewer.auth).expect(200);
  });

  it('an open event stream keeps running after the user is blocked; a new request is refused', async () => {
    const user = await d.createUser();
    const base = await d.listen();
    const controller = new AbortController();
    const res = await fetch(`${base}/api/test/stream`, { headers: user.auth, signal: controller.signal });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let received = '';
    const readMore = async () => {
      const { value, done } = await reader.read();
      if (!done) received += decoder.decode(value);
      return done;
    };
    await readMore(); // the stream is open and the guard has run
    await d.setStatus(user.id, 'blocked');
    const refused = await fetch(`${base}/api/auth/me`, { headers: user.auth });
    expect(refused.status).toBe(403);
    while (!(await readMore())) {
      /* read to the end */
    }
    expect(received).toContain('data: done');
    controller.abort();
  });
});

function eqId(id: string) {
  return eq(users.id, id);
}

// ─── AccountsService rules and UserDirectory ────────────────────────────────────────────────────────────────────

describe('AccountsService rules', () => {
  it('refuses self-block, removing one own admin role, and removing the last active admin', async () => {
    const accounts = d.app.get(AccountsService);
    const admin = await d.createUser({ role: 'admin' });
    const actor = { id: admin.id, role: 'admin' as const };

    await expect(accounts.setStatus(actor, admin.id, 'blocked')).rejects.toMatchObject({
      status: 409,
      code: 'CONFLICT',
      message: 'You cannot block your own account',
    });
    await expect(accounts.setRole(actor, admin.id, 'learner')).rejects.toMatchObject({
      status: 409,
      message: 'You cannot remove your own admin role',
    });
    // The CLI (actor null) may not remove the last active admin either.
    await expect(accounts.setStatus(null, admin.id, 'blocked')).rejects.toMatchObject({
      status: 409,
      message: 'At least one active admin must remain',
    });
    await expect(accounts.setRole(null, admin.id, 'reviewer')).rejects.toMatchObject({
      status: 409,
      message: 'At least one active admin must remain',
    });

    // With a second active admin the CLI may demote the first.
    await d.createUser({ role: 'admin' });
    await expect(accounts.setRole(null, admin.id, 'reviewer')).resolves.toMatchObject({ role: 'reviewer' });
  });

  it('answers 404 for an unknown target', async () => {
    const accounts = d.app.get(AccountsService);
    await expect(accounts.setStatus(null, '00000000-0000-4000-8000-000000000000', 'blocked')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('isActive is false for blocked and unknown ids', async () => {
    const accounts = d.app.get(AccountsService);
    const active = await d.createUser();
    const blocked = await d.createUser({ status: 'blocked' });
    expect(await accounts.isActive(active.id)).toBe(true);
    expect(await accounts.isActive(blocked.id)).toBe(false);
    expect(await accounts.isActive('00000000-0000-4000-8000-000000000000')).toBe(false);
  });
});

describe('UserDirectory', () => {
  it('findIdByEmail is case-insensitive and ignores never-signed-in users unless asked', async () => {
    const directory = d.app.get(UserDirectory);
    const seen = await d.createUser({ email: 'seen@example.test' });
    const unseen = await d.createUser({ email: 'unseen@example.test', signedIn: false });
    expect(await directory.findIdByEmail('  SEEN@Example.TEST ')).toBe(seen.id);
    expect(await directory.findIdByEmail('unseen@example.test')).toBeNull();
    expect(await directory.findIdByEmail('unseen@example.test', { signedInOnly: false })).toBe(unseen.id);
    expect(await directory.findIdByEmail('nobody@example.test', { signedInOnly: false })).toBeNull();
  });

  it('displayNames omits unknown ids and contacts returns name and address', async () => {
    const directory = d.app.get(UserDirectory);
    const user = await d.createUser({ name: 'Grace' });
    const names = await directory.displayNames([user.id, '00000000-0000-4000-8000-000000000000']);
    expect([...names.entries()]).toEqual([[user.id, 'Grace']]);
    expect((await directory.displayNames([])).size).toBe(0);
    const contacts = await directory.contacts([user.id]);
    expect(contacts.get(user.id)).toEqual({ name: 'Grace', email: user.email });
  });
});

// ─── Development sign-in ────────────────────────────────────────────────────────────────────────────────────────

describe('POST /auth/dev-login and GET /auth/dev-users', () => {
  it('issues a working token without e-mail or role in the payload', async () => {
    const user = await d.createUser({ email: 'dev@example.test', role: 'reviewer', signedIn: false });
    const res = await d.http.post('/auth/dev-login').send({ email: '  DEV@example.test ' });
    expect(res.status).toBe(200);
    expect(res.body.expiresIn).toBe(3600);
    const payload = decodeJwt(res.body.accessToken);
    expect(payload.sub).toBe(user.id);
    expect(JSON.stringify(payload)).not.toContain('@');
    expect(payload).not.toHaveProperty('role');
    expect(payload).not.toHaveProperty('email');
    const me = await d.http.get('/auth/me').set(bearer(res.body.accessToken));
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(user.id);
    // The sign-in counts as having signed in once.
    const [row] = await d.db.select().from(users).where(eqId(user.id));
    expect(row!.lastSeenAt).not.toBeNull();
  });

  it('401 INVALID_CREDENTIALS for an unknown address, and creates no row', async () => {
    const res = await d.http.post('/auth/dev-login').send({ email: 'nobody@example.test' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(res.body.error.message).toBe('No account with that e-mail address');
    expect(await userRows(d)).toHaveLength(0);
  });

  it('403 ACCOUNT_BLOCKED for a blocked user and 422 for a non-address', async () => {
    await d.createUser({ email: 'b@example.test', status: 'blocked' });
    const blocked = await d.http.post('/auth/dev-login').send({ email: 'b@example.test' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('ACCOUNT_BLOCKED');
    const invalid = await d.http.post('/auth/dev-login').send({ email: 'not-an-address' });
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('dev-login ignores a bad token (public route)', async () => {
    await d.createUser({ email: 'ok@example.test' });
    await d.http.post('/auth/dev-login').set(bearer('garbage')).send({ email: 'ok@example.test' }).expect(200);
  });

  it('dev-users lists the seeded demo accounts in the documented order, and never other accounts', async () => {
    expect((await d.http.get('/auth/dev-users')).body).toEqual([]); // before seeding
    await d.createUser({ email: 'admin@example.test', name: 'Demo Admin', role: 'admin' });
    await d.createUser({ email: 'learner@example.test', name: 'Demo Learner' });
    await d.createUser({ email: 'person@example.test', name: 'A Real Person' });
    await d.createUser({ email: 'reviewer@example.test', name: 'Demo Reviewer', role: 'reviewer' });
    await d.createUser({ email: 'learner2@example.test', name: 'Second Learner' });
    const res = await d.http.get('/auth/dev-users');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { email: 'learner@example.test', name: 'Demo Learner', role: 'learner' },
      { email: 'learner2@example.test', name: 'Second Learner', role: 'learner' },
      { email: 'reviewer@example.test', name: 'Demo Reviewer', role: 'reviewer' },
      { email: 'admin@example.test', name: 'Demo Admin', role: 'admin' },
    ]);
  });

  it('both routes are 404 NOT_FOUND in cognito mode', async () => {
    const login = await c.http.post('/auth/dev-login').send({ email: 'a@example.test' });
    expect(login.status).toBe(404);
    expect(login.body.error.code).toBe('NOT_FOUND');
    const list = await c.http.get('/auth/dev-users');
    expect(list.status).toBe(404);
    expect(list.body.error.code).toBe('NOT_FOUND');
  });

  it('registers DevAuthController in dev mode only', () => {
    expect(d.app.get(DevAuthController, { strict: false })).toBeInstanceOf(DevAuthController);
    expect(() => c.app.get(DevAuthController, { strict: false })).toThrow();
  });
});

describe('GET /auth/me in development mode', () => {
  it('401 without a token, with an expired token, and with a malformed one', async () => {
    const user = await d.createUser();
    await d.http.get('/auth/me').expect(401);
    await d.http.get('/auth/me').set(bearer(await d.expiredToken(user.id))).expect(401);
    await d.http.get('/auth/me').set(bearer('x.y.z')).expect(401);
    await d.http.get('/auth/me').set({ Authorization: `Basic ${user.token}` }).expect(401);
  });

  it('returns the caller own MeDto', async () => {
    const user = await d.createUser({ role: 'admin', name: 'Root' });
    const res = await d.http.get('/auth/me').set(user.auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: user.id, name: 'Root', email: user.email, role: 'admin', status: 'active' });
  });

  it('a token for a user that no longer exists is 401', async () => {
    const user = await d.createUser();
    await d.db.delete(users).where(eqId(user.id));
    d.clock.advance(6_000);
    await d.http.get('/auth/me').set(user.auth).expect(401);
  });
});

// ─── Privacy ────────────────────────────────────────────────────────────────────────────────────────────────────

describe('e-mail addresses stay in the accounts table', () => {
  it('appear in no log line, no graph property, and no response other than /auth/me', async () => {
    logged.length = 0;
    const secretEmail = 'private.person@example.test';
    const bodies: string[] = [];

    const t = await mint(c, 'sub-private', { email: secretEmail, name: 'Private Person' });
    const me = await c.http.get('/auth/me').set(bearer(t.access)).set('X-Id-Token', t.id);
    expect(me.body.email).toBe(secretEmail); // the one allowed place

    const refused = [
      await c.http.get('/auth/me').set(bearer((await mint(c, 'sub-un', { email: secretEmail, verified: false })).access)),
      await c.http.get('/auth/me'),
      await c.http.get('/auth/dev-users'),
      await c.http.post('/auth/dev-login').send({ email: secretEmail }),
    ];
    await c.setStatus(me.body.id, 'blocked');
    refused.push(await c.http.get('/auth/me').set(bearer(t.access)));
    refused.push(await c.http.get('/api/unknown').set(bearer(t.access)));
    const login = await d.http.post('/auth/dev-login').send({ email: (await d.createUser({ email: secretEmail })).email });
    refused.push(login);
    for (const res of refused) bodies.push(JSON.stringify(res.body));

    for (const body of bodies) expect(body).not.toContain(secretEmail);
    expect(logged.join('\n')).not.toContain(secretEmail);
    expect(logged.join('\n')).not.toContain(t.access);
    expect(logged.join('\n')).not.toContain(t.id);

    const props = await c.testGraph.cypher<{ p: Record<string, unknown> }>('MATCH (n) RETURN properties(n) AS p');
    expect(JSON.stringify(props)).not.toContain('@');
    expect(JSON.stringify(props)).not.toContain(secretEmail);
  });
});
