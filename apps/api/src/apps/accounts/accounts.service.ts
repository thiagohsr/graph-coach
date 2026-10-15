import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, count, eq, ne, sql } from 'drizzle-orm';
import { GraphKit, createLearner, deleteLearner, newId, toEpochMs } from '@coach/graph-kit';
import type { MeDto, Role, UserStatus, ValidationDetails } from '@coach/types';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import type { AuthUser } from '../../common/auth/auth-user';
import { TOKEN_VERIFIER, type TokenVerifier, type VerifiedIdentity } from '../../common/auth/token-verifier';
import { CLOCK, type Clock } from '../../common/clock';
import { DB, type Db } from '../../common/db/db.module';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationFailedError,
} from '../../common/errors/app-error';
import { userIdentities, users, type NewUserRow, type UserRow } from './user.model';

export interface Account {
  id: string;
  role: Role;
  status: UserStatus;
  displayName: string;
}

/** Entries of the account cache live this long on the injected clock (contracts §5.2). */
export const ACCOUNT_CACHE_MS = 5_000;
/** `last_seen_at` is written at most this often per user by ordinary requests. */
const LAST_SEEN_INTERVAL_MS = 5 * 60_000;
const UNVERIFIED_MESSAGE = 'Verify your e-mail address to use this site';
const NOT_INITIALISED_MESSAGE = 'Account not initialised: call GET /auth/me with the ID token';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

interface Cached<T> {
  value: T;
  expires: number;
}

interface Profile {
  sub: string;
  email: string;
  name: string;
  provider: 'google' | 'cognito';
}

function toAccount(row: Pick<UserRow, 'id' | 'role' | 'status' | 'displayName'>): Account {
  return { id: row.id, role: row.role, status: row.status, displayName: row.displayName };
}

export interface BonusRuns {
  bonusSourceRuns: number;
  bonusPromptRuns: number;
}

export const MAX_BONUS_RUNS = 1000;

function assertRunCounts(runs: { source?: number; prompt?: number }): void {
  const issues: ValidationDetails['issues'] = [];
  for (const [path, value] of [
    ['source', runs.source],
    ['prompt', runs.prompt],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > MAX_BONUS_RUNS)) {
      issues.push({ path, message: `must be an integer from 0 to ${MAX_BONUS_RUNS}` });
    }
  }
  if (issues.length > 0) throw new ValidationFailedError(issues);
}

/** Postgres unique violation, directly or wrapped by Drizzle. */
function isUniqueViolation(error: unknown, depth = 0): boolean {
  if (typeof error !== 'object' || error === null || depth > 3) return false;
  const { code, cause } = error as { code?: unknown; cause?: unknown };
  return code === '23505' || isUniqueViolation(cause, depth + 1);
}

/**
 * Accounts (contracts/internal-interfaces.md §5.2). The only place that creates or links `users` rows. E-mail
 * addresses are never passed to a logger or to GraphKit.
 */
@Injectable()
export class AccountsService {
  private readonly logger = new Logger('AccountsService');
  private readonly byId = new Map<string, Cached<Account>>();
  private readonly subToUser = new Map<string, Cached<string>>();
  private readonly touched = new Map<string, number>();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(GraphKit) private readonly graph: GraphKit,
    @Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier,
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // ─── Resolution (used by AuthGuard) ────────────────────────────────────────

  /** Creates or links the account on first sight; otherwise reads it through the 5-second cache. */
  async resolve(identity: VerifiedIdentity, idToken?: string): Promise<Account> {
    let account: Account | null;
    if (identity.kind === 'dev') {
      account = await this.getById(identity.userId);
    } else {
      account = await this.resolveCognito(identity.sub, idToken);
    }
    if (!account) throw new UnauthenticatedError();
    await this.touchLastSeen(account.id);
    return account;
  }

  private async resolveCognito(sub: string, idToken: string | undefined): Promise<Account | null> {
    const userId = await this.userIdOfSub(sub);
    if (userId) return this.getById(userId);

    // First sight of this identity.
    if (!idToken) throw new UnauthenticatedError(NOT_INITIALISED_MESSAGE);
    const profile = await this.verifier.verifyIdToken(idToken, sub);
    if (!profile.emailVerified) throw new ForbiddenError(UNVERIFIED_MESSAGE);

    const account = await this.attachOrCreate(profile);
    this.subToUser.set(sub, { value: account.id, expires: this.expiry() });
    return account;
  }

  private expiry(): number {
    return this.clock.now().getTime() + ACCOUNT_CACHE_MS;
  }

  private async userIdOfSub(sub: string): Promise<string | null> {
    const cached = this.subToUser.get(sub);
    if (cached && cached.expires > this.clock.now().getTime()) return cached.value;
    const [row] = await this.db
      .select({ userId: userIdentities.userId })
      .from(userIdentities)
      .where(eq(userIdentities.cognitoSub, sub))
      .limit(1);
    if (!row) {
      this.subToUser.delete(sub);
      return null;
    }
    this.subToUser.set(sub, { value: row.userId, expires: this.expiry() });
    return row.userId;
  }

  private async getById(userId: string): Promise<Account | null> {
    const cached = this.byId.get(userId);
    if (cached && cached.expires > this.clock.now().getTime()) return cached.value;
    const [row] = await this.db
      .select({
        id: users.id,
        role: users.role,
        status: users.status,
        displayName: users.displayName,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!row) {
      this.byId.delete(userId);
      return null;
    }
    const account = toAccount(row);
    this.byId.set(userId, { value: account, expires: this.expiry() });
    return account;
  }

  /** `last_seen_at` at most once per 5 minutes per user, unless forced. A failure here never fails the request. */
  async touchLastSeen(userId: string, options: { force?: boolean } = {}): Promise<void> {
    const now = this.clock.now();
    const last = this.touched.get(userId);
    if (!options.force && last !== undefined && now.getTime() - last < LAST_SEEN_INTERVAL_MS) return;
    this.touched.set(userId, now.getTime());
    try {
      await this.db.update(users).set({ lastSeenAt: now }).where(eq(users.id, userId));
    } catch (error) {
      this.touched.delete(userId);
      if (options.force) throw error;
      this.logger.warn(`Could not update last_seen_at for user ${userId}`);
    }
  }

  // ─── First sight: attach or create ─────────────────────────────────────────

  private async attachOrCreate(profile: Profile): Promise<Account> {
    try {
      return await this.attachOrCreateOnce(profile);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Two first requests at once: one won. Re-read and retry once; a second failure is the caller's 500.
      return this.attachOrCreateOnce(profile);
    }
  }

  private async attachOrCreateOnce(profile: Profile): Promise<Account> {
    const now = this.clock.now();
    let createdLearnerId: string | undefined;
    try {
      return await this.db.transaction(async (tx) => {
        // The identity may have been attached by a request that finished first.
        const [known] = await tx
          .select({ userId: userIdentities.userId })
          .from(userIdentities)
          .where(eq(userIdentities.cognitoSub, profile.sub))
          .limit(1);
        if (known) {
          const existing = await this.accountIn(tx, known.userId);
          if (existing) return existing;
        }

        const [byEmail] = await tx.select().from(users).where(eq(users.email, profile.email)).limit(1);
        if (byEmail) {
          await tx
            .insert(userIdentities)
            .values({ cognitoSub: profile.sub, userId: byEmail.id, provider: profile.provider });
          await this.graph.runOne(createLearner, {
            id: byEmail.id,
            displayName: byEmail.displayName,
            createdAt: toEpochMs(byEmail.createdAt),
          });
          this.logger.log(`account linked user=${byEmail.id}`);
          return toAccount(byEmail);
        }

        const id = newId();
        const role: Role = this.env.BOOTSTRAP_ADMIN_EMAILS.includes(profile.email) ? 'admin' : 'learner';
        const displayName = profile.name.slice(0, 120);
        await tx.insert(users).values({
          id,
          email: profile.email,
          displayName,
          role,
          status: 'active',
          createdAt: now,
          lastSeenAt: now,
        });
        await tx.insert(userIdentities).values({ cognitoSub: profile.sub, userId: id, provider: profile.provider });
        await this.graph.runOne(createLearner, { id, displayName, createdAt: toEpochMs(now) });
        createdLearnerId = id;
        this.logger.log(`account created user=${id}`);
        return { id, role, status: 'active' as const, displayName };
      });
    } catch (error) {
      // The node was written but the transaction did not commit: compensate.
      if (createdLearnerId) {
        await this.graph.runOne(deleteLearner, { id: createdLearnerId }).catch(() => undefined);
      }
      throw error;
    }
  }

  private async accountIn(tx: Tx, userId: string): Promise<Account | null> {
    const [row] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    return row ? toAccount(row) : null;
  }

  // ─── Reads ─────────────────────────────────────────────────────────────────

  /** The caller's own record, with e-mail, for GET /auth/me. */
  async me(userId: string): Promise<MeDto> {
    const [row] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!row) throw new NotFoundError('User');
    return { id: row.id, name: row.displayName, email: row.email, role: row.role, status: row.status };
  }

  /** True when the user exists and is not blocked. Same 5-second cache as the guard. */
  async isActive(userId: string): Promise<boolean> {
    const account = await this.getById(userId);
    return account !== null && account.status === 'active';
  }

  // ─── Rule checks and writes ────────────────────────────────────────────────

  private async loadTarget(targetUserId: string): Promise<UserRow> {
    const [row] = await this.db.select().from(users).where(eq(users.id, targetUserId)).limit(1);
    if (!row) throw new NotFoundError('User');
    return row;
  }

  private async otherActiveAdmins(targetUserId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(users)
      .where(and(eq(users.role, 'admin'), eq(users.status, 'active'), ne(users.id, targetUserId)));
    return row?.n ?? 0;
  }

  async assertCanChangeStatus(actor: AuthUser | null, targetUserId: string, status: UserStatus): Promise<void> {
    const target = await this.loadTarget(targetUserId);
    if (status !== 'blocked') return;
    if (actor && actor.id === targetUserId) throw new ConflictError('You cannot block your own account');
    if (target.role === 'admin' && target.status === 'active' && (await this.otherActiveAdmins(targetUserId)) === 0) {
      throw new ConflictError('At least one active admin must remain');
    }
  }

  async assertCanChangeRole(actor: AuthUser | null, targetUserId: string, role: Role): Promise<void> {
    const target = await this.loadTarget(targetUserId);
    if (role === 'admin') return;
    if (actor && actor.id === targetUserId && actor.role === 'admin') {
      throw new ConflictError('You cannot remove your own admin role');
    }
    if (target.role === 'admin' && target.status === 'active' && (await this.otherActiveAdmins(targetUserId)) === 0) {
      throw new ConflictError('At least one active admin must remain');
    }
  }

  /** Check, write, and invalidate the cache entry, so a block is seen by the guard at once in this process. */
  async setStatus(actor: AuthUser | null, targetUserId: string, status: UserStatus): Promise<Account> {
    await this.assertCanChangeStatus(actor, targetUserId, status);
    const [row] = await this.db.update(users).set({ status }).where(eq(users.id, targetUserId)).returning();
    this.invalidate(targetUserId);
    return toAccount(row!);
  }

  async setRole(actor: AuthUser | null, targetUserId: string, role: Role): Promise<Account> {
    await this.assertCanChangeRole(actor, targetUserId, role);
    const [row] = await this.db.update(users).set({ role }).where(eq(users.id, targetUserId)).returning();
    this.invalidate(targetUserId);
    return toAccount(row!);
  }

  // ─── Bonus runs (contracts §5.9) ───────────────────────────────────────────

  /**
   * Sets the bonus balances (integers 0 to 1000; an omitted kind is unchanged). `actor` must be an admin, or null for
   * the CLI. The allowance reads the columns on every call, so no cache needs dropping beyond the account entry.
   */
  async setBonusRuns(
    actor: AuthUser | null,
    targetUserId: string,
    runs: { source?: number; prompt?: number },
  ): Promise<BonusRuns> {
    if (actor && actor.role !== 'admin') throw new ForbiddenError();
    assertRunCounts(runs);
    await this.loadTarget(targetUserId);
    const set: Partial<Pick<NewUserRow, 'bonusSourceRuns' | 'bonusPromptRuns'>> = {};
    if (runs.source !== undefined) set.bonusSourceRuns = runs.source;
    if (runs.prompt !== undefined) set.bonusPromptRuns = runs.prompt;
    if (Object.keys(set).length > 0) {
      await this.db.update(users).set(set).where(eq(users.id, targetUserId));
    }
    this.invalidate(targetUserId);
    return this.bonusOf(targetUserId);
  }

  /** Adds to the bonus balances (each 0 to 1000, the result capped at 1000). Used by `cli grant-runs`. */
  async grantRuns(
    targetUserId: string,
    runs: { source?: number; prompt?: number },
  ): Promise<BonusRuns> {
    assertRunCounts(runs);
    await this.loadTarget(targetUserId);
    const set: Record<string, ReturnType<typeof sql>> = {};
    if (runs.source !== undefined) {
      set.bonusSourceRuns = sql`least(${users.bonusSourceRuns} + ${runs.source}, ${MAX_BONUS_RUNS})`;
    }
    if (runs.prompt !== undefined) {
      set.bonusPromptRuns = sql`least(${users.bonusPromptRuns} + ${runs.prompt}, ${MAX_BONUS_RUNS})`;
    }
    if (Object.keys(set).length > 0) {
      await this.db.update(users).set(set).where(eq(users.id, targetUserId));
    }
    this.invalidate(targetUserId);
    return this.bonusOf(targetUserId);
  }

  private async bonusOf(userId: string): Promise<BonusRuns> {
    const row = await this.loadTarget(userId);
    return { bonusSourceRuns: row.bonusSourceRuns, bonusPromptRuns: row.bonusPromptRuns };
  }

  /** Drops the cache entry after a write made elsewhere (for example the admin's SQL adapter). */
  invalidate(userId: string): void {
    this.byId.delete(userId);
    for (const [sub, entry] of this.subToUser) if (entry.value === userId) this.subToUser.delete(sub);
  }
}
