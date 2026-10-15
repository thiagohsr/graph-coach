import { Inject, Injectable } from '@nestjs/common';
import type { AllowanceDto, CreationKind } from '@coach/types';
import { hasRole, type AuthUser } from '../../common/auth/auth-user';
import { CLOCK, type Clock } from '../../common/clock';
import { RateLimitedError, UnavailableError, type AppError } from '../../common/errors/app-error';
import { SettingsService } from '../../common/settings/settings.service';
import { ALLOWANCE_STORE, type AllowanceStore } from './allowance-store';
import { CreationCounts, nextMonthStart } from './creation-counts';

export type { CreationKind } from '@coach/types';

export interface CreationGrant {
  kind: CreationKind;
  via: 'exempt' | 'allowance' | 'bonus';
  /** Call once the Source node is written. Clears the pending entry. Idempotent. */
  confirm(): void;
  /** Call if the source write fails right after begin. Returns a consumed bonus run and clears the pending entry. Idempotent. */
  refund(): Promise<void>;
}

export interface AllowanceCheck {
  allowed: boolean;
  /** Present when not allowed. paused = rule 1, hourly_limit = rule 3, no_allowance = rule 6. */
  reason?: 'no_allowance' | 'paused' | 'hourly_limit';
}

/** A creation that `begin` accepted but whose `Source` node the graph does not show yet. */
export const PENDING_MS = 60_000;
const HOUR_MS = 3_600_000;

interface Pending {
  kind: CreationKind;
  at: number;
}

type Decision =
  | { ok: true; via: CreationGrant['via'] }
  | { ok: false; reason: NonNullable<AllowanceCheck['reason']>; error: AppError };

/**
 * Creation allowance (contracts/internal-interfaces.md §5.8). The rule order is the same for `check`,
 * `assertAllowed`, and `begin`: pause switch, staff exemption, hourly limit, monthly allowance, bonus run, refusal.
 */
@Injectable()
export class AllowanceService {
  private readonly pending = new Map<string, Pending[]>();
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(
    @Inject(CreationCounts) private readonly counts: Pick<CreationCounts, 'creationCounts'>,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ALLOWANCE_STORE) private readonly store: AllowanceStore,
  ) {}

  /** Non-throwing question for rules 1, 3, and 6. Consumes nothing. Store errors pass through. */
  async check(user: AuthUser, kind: CreationKind): Promise<AllowanceCheck> {
    const decision = await this.decide(user, kind, false);
    return decision.ok ? { allowed: true } : { allowed: false, reason: decision.reason };
  }

  /** Throws exactly what `begin` would throw. Consumes nothing. */
  async assertAllowed(user: AuthUser, kind: CreationKind): Promise<void> {
    const decision = await this.decide(user, kind, false);
    if (!decision.ok) throw decision.error;
  }

  /** Decides and records. One at a time per user. */
  async begin(user: AuthUser, kind: CreationKind): Promise<CreationGrant> {
    return this.enqueue(user.id, async () => {
      const decision = await this.decide(user, kind, true);
      if (!decision.ok) throw decision.error;

      const entry: Pending = { kind, at: this.clock.now().getTime() };
      this.pendingOf(user.id).push(entry);

      let done = false;
      const release = () => {
        const list = this.pending.get(user.id);
        if (!list) return;
        const index = list.indexOf(entry);
        if (index >= 0) list.splice(index, 1);
        if (list.length === 0) this.pending.delete(user.id);
      };
      return {
        kind,
        via: decision.via,
        confirm: () => {
          if (done) return;
          done = true;
          release();
        },
        refund: async () => {
          if (done) return;
          done = true;
          release();
          if (decision.via === 'bonus') await this.store.refundBonus(user.id, kind);
        },
      };
    });
  }

  /** The caller's own numbers, for GET /me/allowance. Reads only. */
  async usage(user: AuthUser): Promise<AllowanceDto> {
    const now = this.clock.now();
    const [settings, counts, account] = await Promise.all([
      this.settings.getAll(),
      this.counts.creationCounts(user.id),
      this.store.read(user.id),
    ]);
    const unlimited = hasRole(user, 'reviewer', 'admin');
    const resetsAt = nextMonthStart(now).toISOString();
    const lifted =
      account.limitsLiftedUntil !== null && account.limitsLiftedUntil.getTime() > now.getTime();
    return {
      upload: {
        used: counts.uploadsThisMonth,
        allowance: unlimited ? null : settings.monthlySourceAllowance,
        bonus: account.bonusSourceRuns,
        resetsAt,
      },
      prompt: {
        used: counts.promptsThisMonth,
        allowance: unlimited ? null : settings.monthlyPromptAllowance,
        bonus: account.bonusPromptRuns,
        resetsAt,
      },
      hourly: {
        used: counts.creationsLastHour,
        limit: unlimited ? null : settings.hourlyCreationLimit,
        ...(lifted && account.limitsLiftedUntil
          ? { liftedUntil: account.limitsLiftedUntil.toISOString() }
          : {}),
      },
      creationEnabled: settings.creationEnabled,
    };
  }

  // ─── Rules ─────────────────────────────────────────────────────────────────

  private async decide(user: AuthUser, kind: CreationKind, consume: boolean): Promise<Decision> {
    const settings = await this.settings.getAll();

    // 1. The pause switch applies to everyone.
    if (!settings.creationEnabled) {
      return {
        ok: false,
        reason: 'paused',
        error: new UnavailableError('CREATION_PAUSED', 'Puzzle creation is paused'),
      };
    }

    // 2. Staff are exempt from every limit.
    if (hasRole(user, 'reviewer', 'admin')) return { ok: true, via: 'exempt' };

    const now = this.clock.now();
    const [counts, account] = await Promise.all([
      this.counts.creationCounts(user.id),
      this.store.read(user.id),
    ]);
    const pending = this.livePending(user.id, now.getTime());
    const pendingOfKind = pending.filter((entry) => entry.kind === kind).length;

    // 3. Hourly limit, unless a code lifted it.
    const lifted =
      account.limitsLiftedUntil !== null && account.limitsLiftedUntil.getTime() > now.getTime();
    if (!lifted && counts.creationsLastHour + pending.length >= settings.hourlyCreationLimit) {
      return {
        ok: false,
        reason: 'hourly_limit',
        error: new RateLimitedError(
          {
            resetAt: new Date(now.getTime() + HOUR_MS),
            retryAfterSeconds: HOUR_MS / 1000,
            window: 'hour',
          },
          'CREATION_LIMIT_REACHED',
          undefined,
          { kind, canRedeemCode: true },
        ),
      };
    }

    // 4. Monthly allowance of this kind.
    const used = (kind === 'upload' ? counts.uploadsThisMonth : counts.promptsThisMonth) + pendingOfKind;
    const allowance =
      kind === 'upload' ? settings.monthlySourceAllowance : settings.monthlyPromptAllowance;
    if (used < allowance) return { ok: true, via: 'allowance' };

    // 5. A bonus run.
    const balance = kind === 'upload' ? account.bonusSourceRuns : account.bonusPromptRuns;
    if (consume) {
      if (await this.store.consumeBonus(user.id, kind)) return { ok: true, via: 'bonus' };
    } else if (balance > 0) {
      return { ok: true, via: 'bonus' };
    }

    // 6. Nothing left this month.
    const resetAt = nextMonthStart(now);
    return {
      ok: false,
      reason: 'no_allowance',
      error: new RateLimitedError(
        {
          resetAt,
          retryAfterSeconds: Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000)),
          window: 'month',
        },
        'CREATION_LIMIT_REACHED',
        undefined,
        { kind, canRedeemCode: true },
      ),
    };
  }

  // ─── Pending entries and the per-user queue ────────────────────────────────

  private pendingOf(userId: string): Pending[] {
    let list = this.pending.get(userId);
    if (!list) {
      list = [];
      this.pending.set(userId, list);
    }
    return list;
  }

  /** Entries younger than 60 s on the injected clock; older ones are dropped. */
  private livePending(userId: string, nowMs: number): Pending[] {
    const list = this.pending.get(userId);
    if (!list) return [];
    const live = list.filter((entry) => nowMs - entry.at < PENDING_MS);
    if (live.length === 0) this.pending.delete(userId);
    else if (live.length !== list.length) this.pending.set(userId, live);
    return live;
  }

  private enqueue<T>(userId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(userId) ?? Promise.resolve();
    const run = previous.then(task, task);
    const tail = run.catch(() => undefined);
    this.queues.set(userId, tail);
    void tail.then(() => {
      if (this.queues.get(userId) === tail) this.queues.delete(userId);
    });
    return run;
  }
}
