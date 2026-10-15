import { beforeEach, describe, expect, it } from 'vitest';
import type { CreationKind } from '@coach/types';
import type { AuthUser } from '../../common/auth/auth-user';
import type { Clock } from '../../common/clock';
import { RateLimitedError, UnavailableError } from '../../common/errors/app-error';
import { SETTING_DEFAULTS, type Settings } from '../../common/settings/settings.schema';
import type { SettingsService } from '../../common/settings/settings.service';
import type { AllowanceAccount, AllowanceStore } from './allowance-store';
import { AllowanceService, PENDING_MS } from './allowance.service';
import { monthStart, nextMonthStart, type CreationCount } from './creation-counts';

class FakeClock implements Clock {
  constructor(public ms = Date.UTC(2026, 9, 15, 12, 0, 0)) {}
  now(): Date {
    return new Date(this.ms);
  }
  advance(ms: number): void {
    this.ms += ms;
  }
}

class FakeStore implements AllowanceStore {
  account: AllowanceAccount = { bonusSourceRuns: 0, bonusPromptRuns: 0, limitsLiftedUntil: null };
  consumed = 0;
  refunded = 0;
  async read(): Promise<AllowanceAccount> {
    return { ...this.account };
  }
  async consumeBonus(_id: string, kind: CreationKind): Promise<boolean> {
    // The real statement is atomic; awaiting here lets concurrent callers interleave.
    await Promise.resolve();
    const key = kind === 'upload' ? 'bonusSourceRuns' : 'bonusPromptRuns';
    if (this.account[key] <= 0) return false;
    this.account[key] -= 1;
    this.consumed += 1;
    return true;
  }
  async refundBonus(_id: string, kind: CreationKind): Promise<void> {
    this.account[kind === 'upload' ? 'bonusSourceRuns' : 'bonusPromptRuns'] += 1;
    this.refunded += 1;
  }
}

const learner: AuthUser = { id: 'u-learner', role: 'learner' };
const reviewer: AuthUser = { id: 'u-reviewer', role: 'reviewer' };
const admin: AuthUser = { id: 'u-admin', role: 'admin' };

let clock: FakeClock;
let store: FakeStore;
let settings: Settings;
let counts: CreationCount;
let service: AllowanceService;

beforeEach(() => {
  clock = new FakeClock();
  store = new FakeStore();
  settings = { ...SETTING_DEFAULTS };
  counts = { uploadsThisMonth: 0, promptsThisMonth: 0, creationsLastHour: 0 };
  service = new AllowanceService(
    { creationCounts: async () => ({ ...counts }) },
    { getAll: async () => ({ ...settings }) } as unknown as SettingsService,
    clock,
    store,
  );
});

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a refusal');
}

describe('rule 1: the pause switch', () => {
  it.each([learner, reviewer, admin])('refuses $role with CREATION_PAUSED', async (user) => {
    settings.creationEnabled = false;
    const error = await failure(service.begin(user, 'upload'));
    expect(error).toBeInstanceOf(UnavailableError);
    expect((error as UnavailableError).code).toBe('CREATION_PAUSED');
    expect((error as UnavailableError).status).toBe(503);
  });

  it('is checked before the exemption and reported by check as paused', async () => {
    settings.creationEnabled = false;
    expect(await service.check(admin, 'prompt')).toEqual({ allowed: false, reason: 'paused' });
  });
});

describe('rule 2: staff exemption', () => {
  it.each([reviewer, admin])('allows $role with via exempt whatever the counts', async (user) => {
    counts = { uploadsThisMonth: 99, promptsThisMonth: 99, creationsLastHour: 99 };
    const grant = await service.begin(user, 'upload');
    expect(grant.via).toBe('exempt');
    expect(store.consumed).toBe(0);
  });
});

describe('rule 3: hourly limit', () => {
  beforeEach(() => {
    counts.creationsLastHour = settings.hourlyCreationLimit;
  });

  it('refuses with window hour, kind, canRedeemCode, and a reset within the hour', async () => {
    const error = (await failure(service.begin(learner, 'prompt'))) as RateLimitedError;
    expect(error).toBeInstanceOf(RateLimitedError);
    expect(error.code).toBe('CREATION_LIMIT_REACHED');
    expect(error.details).toMatchObject({ window: 'hour', kind: 'prompt', canRedeemCode: true });
    const resetAt = new Date((error.details as { resetAt: string }).resetAt).getTime();
    expect(resetAt).toBeGreaterThan(clock.ms);
    expect(resetAt).toBeLessThanOrEqual(clock.ms + 3_600_000);
  });

  it('is lifted while limits_lifted_until is in the future, and applies once it is past', async () => {
    store.account.limitsLiftedUntil = new Date(clock.ms + 60_000);
    expect((await service.begin(learner, 'upload')).via).toBe('allowance');

    store.account.limitsLiftedUntil = new Date(clock.ms - 1);
    expect(await service.check(learner, 'upload')).toEqual({ allowed: false, reason: 'hourly_limit' });
  });
});

describe('rules 4 to 6: monthly allowance and bonus runs', () => {
  it('uses the allowance while below it, leaving the bonus alone', async () => {
    counts.uploadsThisMonth = settings.monthlySourceAllowance - 1;
    store.account.bonusSourceRuns = 2;
    const grant = await service.begin(learner, 'upload');
    expect(grant.via).toBe('allowance');
    expect(store.account.bonusSourceRuns).toBe(2);
  });

  it('uses one bonus run at the allowance', async () => {
    counts.uploadsThisMonth = settings.monthlySourceAllowance;
    store.account.bonusSourceRuns = 1;
    const grant = await service.begin(learner, 'upload');
    expect(grant.via).toBe('bonus');
    expect(store.account.bonusSourceRuns).toBe(0);
    expect(store.consumed).toBe(1);
  });

  it('refuses with window month, the next UTC month start, and canRedeemCode', async () => {
    counts.uploadsThisMonth = settings.monthlySourceAllowance;
    const error = (await failure(service.begin(learner, 'upload'))) as RateLimitedError;
    expect(error.code).toBe('CREATION_LIMIT_REACHED');
    expect(error.details).toMatchObject({
      window: 'month',
      kind: 'upload',
      canRedeemCode: true,
      resetAt: '2026-11-01T00:00:00.000Z',
    });
  });

  it('counts and consumes the two kinds separately', async () => {
    counts.uploadsThisMonth = settings.monthlySourceAllowance;
    store.account.bonusPromptRuns = 1;
    await expect(service.begin(learner, 'upload')).rejects.toBeInstanceOf(RateLimitedError);
    // Prompt is still within its allowance and does not touch the prompt bonus.
    expect((await service.begin(learner, 'prompt')).via).toBe('allowance');
    expect(store.account.bonusPromptRuns).toBe(1);

    counts.promptsThisMonth = settings.monthlyPromptAllowance;
    store.account.bonusSourceRuns = 0;
    expect((await service.begin(learner, 'prompt')).via).toBe('bonus');
    expect(store.account.bonusPromptRuns).toBe(0);
    expect(store.account.bonusSourceRuns).toBe(0);
  });
});

describe('check and assertAllowed', () => {
  it('check returns the reason for rules 1, 3, and 6 and never throws for them', async () => {
    expect(await service.check(learner, 'upload')).toEqual({ allowed: true });

    counts.uploadsThisMonth = settings.monthlySourceAllowance;
    expect(await service.check(learner, 'upload')).toEqual({ allowed: false, reason: 'no_allowance' });

    counts.creationsLastHour = settings.hourlyCreationLimit;
    expect(await service.check(learner, 'upload')).toEqual({ allowed: false, reason: 'hourly_limit' });

    settings.creationEnabled = false;
    expect(await service.check(learner, 'upload')).toEqual({ allowed: false, reason: 'paused' });
  });

  it('check sees a bonus run without consuming it', async () => {
    counts.uploadsThisMonth = settings.monthlySourceAllowance;
    store.account.bonusSourceRuns = 1;
    expect(await service.check(learner, 'upload')).toEqual({ allowed: true });
    expect(store.account.bonusSourceRuns).toBe(1);
  });

  it('assertAllowed throws what begin would, and consumes and records nothing', async () => {
    counts.uploadsThisMonth = settings.monthlySourceAllowance;
    const error = (await failure(service.assertAllowed(learner, 'upload'))) as RateLimitedError;
    expect(error.details).toMatchObject({ window: 'month' });

    counts.uploadsThisMonth = 0;
    settings.monthlySourceAllowance = 1;
    await service.assertAllowed(learner, 'upload');
    await service.assertAllowed(learner, 'upload');
    // No pending entry was added: begin still finds the allowance free.
    expect((await service.begin(learner, 'upload')).via).toBe('allowance');
  });
});

describe('pending entries', () => {
  beforeEach(() => {
    settings.monthlySourceAllowance = 1;
  });

  it('make an immediate second begin see one more used', async () => {
    const first = await service.begin(learner, 'upload');
    expect(first.via).toBe('allowance');
    await expect(service.begin(learner, 'upload')).rejects.toBeInstanceOf(RateLimitedError);
  });

  it('are cleared by confirm (the graph now shows the source) and by the 60 s expiry', async () => {
    const grant = await service.begin(learner, 'upload');
    grant.confirm();
    grant.confirm();
    expect((await service.begin(learner, 'upload')).via).toBe('allowance');

    clock.advance(PENDING_MS + 1);
    expect((await service.begin(learner, 'upload')).via).toBe('allowance');
  });

  it('are cleared by refund, which also returns a consumed bonus run exactly once', async () => {
    settings.monthlySourceAllowance = 0;
    store.account.bonusSourceRuns = 1;
    const grant = await service.begin(learner, 'upload');
    expect(grant.via).toBe('bonus');
    expect(store.account.bonusSourceRuns).toBe(0);

    await grant.refund();
    await grant.refund();
    expect(store.account.bonusSourceRuns).toBe(1);
    expect(store.refunded).toBe(1);
    expect((await service.begin(learner, 'upload')).via).toBe('bonus');
  });

  it('refund after confirm does nothing', async () => {
    settings.monthlySourceAllowance = 0;
    store.account.bonusSourceRuns = 1;
    const grant = await service.begin(learner, 'upload');
    grant.confirm();
    await grant.refund();
    expect(store.account.bonusSourceRuns).toBe(0);
  });

  it('serialise concurrent begin calls of one user: one bonus run, one winner', async () => {
    settings.monthlySourceAllowance = 0;
    store.account.bonusSourceRuns = 1;
    const results = await Promise.allSettled([
      service.begin(learner, 'upload'),
      service.begin(learner, 'upload'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(store.account.bonusSourceRuns).toBe(0);
  });
});

describe('month rollover', () => {
  it('reads zero used in a new month with the bonus unchanged', async () => {
    store.account.bonusSourceRuns = 2;
    const dto = await service.usage(learner);
    expect(dto.upload.bonus).toBe(2);
    expect(dto.upload.resetsAt).toBe('2026-11-01T00:00:00.000Z');
  });

  it('computes month boundaries in UTC, including December to January', () => {
    expect(nextMonthStart(new Date(Date.UTC(2026, 11, 31, 23, 59, 59))).toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
    expect(monthStart(new Date(Date.UTC(2026, 10, 1, 0, 0, 0))).toISOString()).toBe(
      '2026-11-01T00:00:00.000Z',
    );
    expect(monthStart(new Date(Date.UTC(2026, 9, 31, 23, 59, 59, 999))).toISOString()).toBe(
      '2026-10-01T00:00:00.000Z',
    );
  });

  it('does not depend on the process time zone', () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = 'Pacific/Auckland';
      expect(nextMonthStart(new Date('2026-10-31T20:00:00Z')).toISOString()).toBe(
        '2026-11-01T00:00:00.000Z',
      );
      process.env.TZ = 'America/Los_Angeles';
      expect(monthStart(new Date('2026-11-01T03:00:00Z')).toISOString()).toBe(
        '2026-11-01T00:00:00.000Z',
      );
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});

describe('usage', () => {
  it('reports unlimited allowance and limit for staff', async () => {
    const dto = await service.usage(admin);
    expect(dto.upload.allowance).toBeNull();
    expect(dto.prompt.allowance).toBeNull();
    expect(dto.hourly.limit).toBeNull();
  });

  it('reports liftedUntil only while in the future', async () => {
    store.account.limitsLiftedUntil = new Date(clock.ms - 1000);
    expect((await service.usage(learner)).hourly.liftedUntil).toBeUndefined();
    store.account.limitsLiftedUntil = new Date(clock.ms + 1000);
    expect((await service.usage(learner)).hourly.liftedUntil).toBe(
      new Date(clock.ms + 1000).toISOString(),
    );
  });
});
