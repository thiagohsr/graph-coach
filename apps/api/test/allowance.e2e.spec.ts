import { Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GraphFixture } from '@coach/graph-kit';
import { AccountsService } from '../src/apps/accounts/accounts.service';
import { users } from '../src/apps/accounts/user.model';
import { accessCodes, codeRedemptions } from '../src/apps/allowance/access-code.model';
import { AllowanceService } from '../src/apps/allowance/allowance.service';
import { CodesService } from '../src/apps/allowance/codes.service';
import { CreationCounts } from '../src/apps/allowance/creation-counts';
import { normalizeCode } from '../src/apps/allowance/code-format';
import {
  RateLimitedError,
  ValidationFailedError,
  ForbiddenError,
} from '../src/common/errors/app-error';
import { SettingsService } from '../src/common/settings/settings.service';
import { createTestApp, type TestApp, type TestUser } from './support/test-app';

const MINUTE = 60_000;
const DAY = 86_400_000;

let t: TestApp;
let allowance: AllowanceService;
let codes: CodesService;
let accounts: AccountsService;
let settings: SettingsService;
const logLines: string[] = [];

beforeAll(async () => {
  t = await createTestApp();
  allowance = t.app.get(AllowanceService);
  codes = t.app.get(CodesService);
  accounts = t.app.get(AccountsService);
  settings = t.app.get(SettingsService);
  const capture = (message: unknown, ...rest: unknown[]) => {
    logLines.push([message, ...rest].map((part) => String(part)).join(' '));
  };
  Logger.overrideLogger({
    log: capture,
    error: capture,
    warn: capture,
    debug: capture,
    verbose: capture,
  });
});

afterAll(async () => {
  Logger.overrideLogger(false);
  await t.close();
});

const baseCode = { label: 'demo', sourceRuns: 0, promptRuns: 2, liftDays: 0, maxRedemptions: 5 };

async function bonusOf(userId: string) {
  const [row] = await t.db
    .select({
      source: users.bonusSourceRuns,
      prompt: users.bonusPromptRuns,
      lift: users.limitsLiftedUntil,
    })
    .from(users)
    .where(eq(users.id, userId));
  return row!;
}

async function learnerAtAllowance(): Promise<TestUser> {
  // Allowances are settings; setting them to 0 puts every learner "at the monthly allowance".
  await settings.set('monthlySourceAllowance', 0);
  await settings.set('monthlyPromptAllowance', 0);
  return t.createUser();
}

function sources(
  ownerId: string,
  items: Array<{ kind: 'text' | 'markdown' | 'url' | 'prompt'; createdAt: number }>,
): GraphFixture {
  const nodes: GraphFixture['nodes'] = [];
  const edges: GraphFixture['edges'] = [];
  items.forEach((item, index) => {
    const key = `${ownerId}-source-${index}-${item.createdAt}`;
    nodes.push({
      label: 'Source',
      key,
      props: { title: `S${index}`, kind: item.kind, fingerprint: key, createdAt: item.createdAt },
    });
    edges.push({
      type: 'OWNS',
      from: { label: 'Learner', key: ownerId },
      to: { label: 'Source', key },
    });
  });
  return { nodes, edges };
}

describe('atomic bonus decrement', () => {
  it('lets exactly one of two simultaneous begin calls take the last bonus run', async () => {
    const user = await learnerAtAllowance();
    await accounts.setBonusRuns(null, user.id, { source: 1 });

    const results = await Promise.allSettled([
      allowance.begin({ id: user.id, role: 'learner' }, 'upload'),
      allowance.begin({ id: user.id, role: 'learner' }, 'upload'),
    ]);
    const granted = results.filter((r) => r.status === 'fulfilled');
    const refused = results.filter((r) => r.status === 'rejected');
    expect(granted).toHaveLength(1);
    expect(refused).toHaveLength(1);
    const grant = (
      granted[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof allowance.begin>>>
    ).value;
    expect(grant.via).toBe('bonus');
    const error = (refused[0] as PromiseRejectedResult).reason as RateLimitedError;
    expect(error.code).toBe('CREATION_LIMIT_REACHED');
    expect((await bonusOf(user.id)).source).toBe(0);

    await grant.refund();
    expect((await bonusOf(user.id)).source).toBe(1);
    await grant.refund();
    expect((await bonusOf(user.id)).source).toBe(1);
  });

  it('is exact when many callers race for one run across separate user queues', async () => {
    const user = await learnerAtAllowance();
    await accounts.setBonusRuns(null, user.id, { prompt: 1 });
    // A second AllowanceService instance has its own queue and pending list: only the SQL statement is shared.
    const other = new AllowanceService(
      t.app.get(CreationCounts),
      settings,
      t.clock,
      (allowance as unknown as { store: ConstructorParameters<typeof AllowanceService>[3] }).store,
    );
    const results = await Promise.allSettled([
      allowance.begin({ id: user.id, role: 'learner' }, 'prompt'),
      other.begin({ id: user.id, role: 'learner' }, 'prompt'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await bonusOf(user.id)).prompt).toBe(0);
  });
});

describe('access codes', () => {
  it('create returns the plain code once and the table holds only its hash', async () => {
    const { code, meta } = await codes.create({ ...baseCode, label: 'stored' });
    expect(code).toMatch(/^GC-([0-9A-Z]{5}-){3}[0-9A-Z]{5}$/);
    const [row] = await t.db.select().from(accessCodes).where(eq(accessCodes.id, meta.id));
    expect(row!.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(code);
    expect(JSON.stringify(row)).not.toContain(normalizeCode(code)!);
    expect(JSON.stringify(meta)).not.toContain(row!.codeHash);
    expect(JSON.stringify(await codes.list())).not.toContain(row!.codeHash);
  });

  it('redeem grants the runs, once per user, and counts redemptions', async () => {
    const { code, meta } = await codes.create({ ...baseCode, label: 'pair', maxRedemptions: 2 });
    const a = await t.createUser();
    const b = await t.createUser();
    const c = await t.createUser();

    const first = await t.http.post('/me/codes/redeem').set(a.auth).send({ code });
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ sourceRuns: 0, promptRuns: 2 });
    expect((await bonusOf(a.id)).prompt).toBe(2);

    const again = await t.http.post('/me/codes/redeem').set(a.auth).send({ code });
    expect(again.status).toBe(422);
    expect(again.body.error.code).toBe('CODE_INVALID');
    expect((await bonusOf(a.id)).prompt).toBe(2);

    // Typing variations of the same code are accepted.
    const typed = code.toLowerCase().replaceAll('-', ' ');
    expect((await t.http.post('/me/codes/redeem').set(b.auth).send({ code: typed })).status).toBe(
      200,
    );

    const full = await t.http.post('/me/codes/redeem').set(c.auth).send({ code });
    expect(full.status).toBe(422);
    expect(full.body.error.code).toBe('CODE_INVALID');

    const [row] = await t.db.select().from(accessCodes).where(eq(accessCodes.id, meta.id));
    const redemptions = await t.db
      .select()
      .from(codeRedemptions)
      .where(eq(codeRedemptions.codeId, meta.id));
    expect(row!.redeemedCount).toBe(2);
    expect(redemptions).toHaveLength(2);
  });

  it('answers every refusal with the identical 422 body', async () => {
    const user = await t.createUser();
    const expired = await codes.create({
      ...baseCode,
      label: 'expired',
      expiresAt: new Date(t.clock.now().getTime() - 1),
    });
    const disabled = await codes.create({ ...baseCode, label: 'disabled' });
    await codes.disable(disabled.meta.id);
    const attempts = [expired.code, disabled.code, 'GC-00000-00000-00000-00000', 'not a code'];
    const bodies: unknown[] = [];
    for (const code of attempts) {
      const res = await t.http.post('/me/codes/redeem').set(user.auth).send({ code });
      expect(res.status).toBe(422);
      bodies.push(res.body);
      t.clock.advance(3 * MINUTE); // stay under the throttle
    }
    for (const body of bodies) expect(body).toEqual(bodies[0]);
    expect(bodies[0]).toEqual({
      error: { code: 'CODE_INVALID', message: 'This code is not valid' },
    });
  });

  it('liftDays sets the lift from now, and a second lift extends the first', async () => {
    const user = await t.createUser();
    const lift3 = await codes.create({ ...baseCode, label: 'lift3', promptRuns: 0, liftDays: 3 });
    const lift2 = await codes.create({ ...baseCode, label: 'lift2', promptRuns: 0, liftDays: 2 });
    expect((await bonusOf(user.id)).lift).toBeNull();

    const now = t.clock.now().getTime();
    const first = await t.http.post('/me/codes/redeem').set(user.auth).send({ code: lift3.code });
    expect(first.status).toBe(200);
    expect(first.body.limitsLiftedUntil).toBe(new Date(now + 3 * DAY).toISOString());
    expect((await bonusOf(user.id)).lift?.getTime()).toBe(now + 3 * DAY);

    const second = await t.http.post('/me/codes/redeem').set(user.auth).send({ code: lift2.code });
    expect(second.body.limitsLiftedUntil).toBe(new Date(now + 5 * DAY).toISOString());
    expect((await bonusOf(user.id)).lift?.getTime()).toBe(now + 5 * DAY);
  });

  it('gives exactly one of two users racing for the last redemption', async () => {
    const { code } = await codes.create({ ...baseCode, label: 'race', maxRedemptions: 1 });
    const a = await t.createUser();
    const b = await t.createUser();
    const [ra, rb] = await Promise.all([
      t.http.post('/me/codes/redeem').set(a.auth).send({ code }),
      t.http.post('/me/codes/redeem').set(b.auth).send({ code }),
    ]);
    expect([ra.status, rb.status].sort()).toEqual([200, 422]);
  });

  it('spec S5.2: a code of two prompt runs allows two more prompt creations and not a third', async () => {
    const user = await learnerAtAllowance();
    await settings.set('monthlySourceAllowance', 3);
    const { code } = await codes.create({ ...baseCode, label: 's52' });
    const caller = { id: user.id, role: 'learner' as const };

    await expect(allowance.begin(caller, 'prompt')).rejects.toBeInstanceOf(RateLimitedError);
    expect((await t.http.post('/me/codes/redeem').set(user.auth).send({ code })).status).toBe(200);

    const one = await allowance.begin(caller, 'prompt');
    const two = await allowance.begin(caller, 'prompt');
    expect([one.via, two.via]).toEqual(['bonus', 'bonus']);
    await expect(allowance.begin(caller, 'prompt')).rejects.toMatchObject({
      code: 'CREATION_LIMIT_REACHED',
    });
    // Uploads are unaffected.
    expect((await allowance.begin(caller, 'upload')).via).toBe('allowance');
  });

  it('throttles redemption attempts: the sixth in 10 minutes is 429, valid code included', async () => {
    await settings.set('monthlyPromptAllowance', 3);
    const user = await t.createUser();
    const { code } = await codes.create({ ...baseCode, label: 'throttle' });
    for (let i = 0; i < 5; i += 1) {
      const res = await t.http
        .post('/me/codes/redeem')
        .set(user.auth)
        .send({ code: 'GC-00000-00000-00000-00000' });
      expect(res.status).toBe(422);
    }
    const sixth = await t.http.post('/me/codes/redeem').set(user.auth).send({ code });
    expect(sixth.status).toBe(429);
    expect(sixth.body.error.code).toBe('RATE_LIMITED');
    expect(Number(sixth.headers['retry-after'])).toBeGreaterThan(0);
    expect((await bonusOf(user.id)).prompt).toBe(0);

    t.clock.advance(10 * MINUTE + 1000);
    expect((await t.http.post('/me/codes/redeem').set(user.auth).send({ code })).status).toBe(200);
  });

  it('refuses a code without a grant and unknown ids', async () => {
    await expect(codes.create({ ...baseCode, promptRuns: 0 })).rejects.toBeInstanceOf(
      ValidationFailedError,
    );
    await expect(codes.disable('00000000-0000-4000-8000-000000000000')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('GET /me/allowance', () => {
  it('reports used from the graph, bonus from the table, and settings', async () => {
    const user = await t.createUser();
    const now = t.clock.now().getTime();
    await t.testGraph.load(
      sources(user.id, [
        { kind: 'text', createdAt: now - 10 * MINUTE },
        { kind: 'url', createdAt: now - 5 * 60 * MINUTE },
        { kind: 'prompt', createdAt: now - 5 * 60 * MINUTE },
        { kind: 'markdown', createdAt: Date.UTC(2026, 8, 20) }, // last month
      ]),
    );
    await accounts.setBonusRuns(null, user.id, { source: 2, prompt: 1 });

    const res = await t.http.get('/me/allowance').set(user.auth);
    expect(res.status).toBe(200);
    expect(res.body.upload).toMatchObject({
      used: 2,
      bonus: 2,
      resetsAt: '2026-11-01T00:00:00.000Z',
    });
    expect(res.body.prompt).toMatchObject({ used: 1, bonus: 1 });
    expect(res.body.upload.allowance).toBe(await settings.get('monthlySourceAllowance'));
    expect(res.body.hourly.used).toBe(1);
    expect(res.body.hourly.limit).toBe(await settings.get('hourlyCreationLimit'));
    expect(res.body.hourly.liftedUntil).toBeUndefined();
    expect(res.body.creationEnabled).toBe(true);

    await t.db
      .update(users)
      .set({ limitsLiftedUntil: new Date(now + DAY) })
      .where(eq(users.id, user.id));
    expect((await t.http.get('/me/allowance').set(user.auth)).body.hourly.liftedUntil).toBe(
      new Date(now + DAY).toISOString(),
    );
    await t.db
      .update(users)
      .set({ limitsLiftedUntil: new Date(now - 1) })
      .where(eq(users.id, user.id));
    expect(
      (await t.http.get('/me/allowance').set(user.auth)).body.hourly.liftedUntil,
    ).toBeUndefined();

    await settings.set('creationEnabled', false);
    expect((await t.http.get('/me/allowance').set(user.auth)).body.creationEnabled).toBe(false);
    await settings.set('creationEnabled', true);
  });

  it('reports null allowance and limit for a reviewer and an admin', async () => {
    for (const role of ['reviewer', 'admin'] as const) {
      const staff = await t.createUser({ role });
      const res = await t.http.get('/me/allowance').set(staff.auth);
      expect(res.status).toBe(200);
      expect(res.body.upload.allowance).toBeNull();
      expect(res.body.prompt.allowance).toBeNull();
      expect(res.body.hourly.limit).toBeNull();
    }
  });

  it('is 401 without a token and 403 ACCOUNT_BLOCKED for a blocked user, on both endpoints', async () => {
    expect((await t.http.get('/me/allowance')).status).toBe(401);
    expect((await t.http.post('/me/codes/redeem').send({ code: 'x' })).status).toBe(401);
    const blocked = await t.createUser({ status: 'blocked' });
    for (const res of [
      await t.http.get('/me/allowance').set(blocked.auth),
      await t.http.post('/me/codes/redeem').set(blocked.auth).send({ code: 'x' }),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ACCOUNT_BLOCKED');
    }
  });

  it('rejects a body without a code with 422 VALIDATION_FAILED', async () => {
    const user = await t.createUser();
    const res = await t.http.post('/me/codes/redeem').set(user.auth).send({});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('CreationCounts and setBonusRuns', () => {
  it('creationCountsFor returns zeros for users without sources and includes every id', async () => {
    const counts = t.app.get(CreationCounts);
    const user = await t.createUser();
    const now = t.clock.now().getTime();
    await t.testGraph.load(sources(user.id, [{ kind: 'prompt', createdAt: now - MINUTE }]));
    const empty = await t.createUser();
    const result = await counts.creationCountsFor([user.id, empty.id, 'no-such-learner']);
    expect(result.get(user.id)).toEqual({
      uploadsThisMonth: 0,
      promptsThisMonth: 1,
      creationsLastHour: 1,
    });
    expect(result.get(empty.id)).toEqual({
      uploadsThisMonth: 0,
      promptsThisMonth: 0,
      creationsLastHour: 0,
    });
    expect(result.get('no-such-learner')).toEqual({
      uploadsThisMonth: 0,
      promptsThisMonth: 0,
      creationsLastHour: 0,
    });
  });

  it('setBonusRuns sets both columns, leaves an omitted kind, and bounds the values', async () => {
    const user = await learnerAtAllowance();
    expect(await accounts.setBonusRuns(null, user.id, { source: 4, prompt: 5 })).toEqual({
      bonusSourceRuns: 4,
      bonusPromptRuns: 5,
    });
    expect(await accounts.setBonusRuns(null, user.id, { prompt: 0 })).toEqual({
      bonusSourceRuns: 4,
      bonusPromptRuns: 0,
    });
    await expect(accounts.setBonusRuns(null, user.id, { source: 1001 })).rejects.toBeInstanceOf(
      ValidationFailedError,
    );
    await expect(accounts.setBonusRuns(null, user.id, { source: -1 })).rejects.toBeInstanceOf(
      ValidationFailedError,
    );
    await expect(
      accounts.setBonusRuns({ id: user.id, role: 'learner' }, user.id, { source: 10 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect((await bonusOf(user.id)).source).toBe(4);

    // A following begin sees the new balance.
    await accounts.setBonusRuns({ id: 'admin', role: 'admin' }, user.id, { source: 1 });
    expect((await allowance.begin({ id: user.id, role: 'learner' }, 'upload')).via).toBe('bonus');
    expect((await accounts.grantRuns(user.id, { source: 5, prompt: 2 })).bonusSourceRuns).toBe(5);
  });
});

describe('secrecy', () => {
  it('no plain code and no hash appears in a captured log line', async () => {
    const { code, meta } = await codes.create({ ...baseCode, label: 'secret' });
    const [row] = await t.db.select().from(accessCodes).where(eq(accessCodes.id, meta.id));
    const user = await t.createUser();
    await t.http.post('/me/codes/redeem').set(user.auth).send({ code });
    const log = logLines.join('\n');
    expect(log).not.toContain(code);
    expect(log).not.toContain(normalizeCode(code)!);
    expect(log).not.toContain(row!.codeHash);
  });
});
