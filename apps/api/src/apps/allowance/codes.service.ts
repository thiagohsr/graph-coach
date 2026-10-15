import { Inject, Injectable } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { newId } from '@coach/graph-kit';
import type { RedeemResult } from '@coach/types';
import type { AuthUser } from '../../common/auth/auth-user';
import { CLOCK, type Clock } from '../../common/clock';
import { DB, type Db } from '../../common/db/db.module';
import {
  ConflictError,
  DomainInvalidError,
  NotFoundError,
  ValidationFailedError,
} from '../../common/errors/app-error';
import { RateLimiter, type RateLimitRule } from '../../common/rate-limit/rate-limiter';
import { users } from '../accounts/user.model';
import { accessCodes, codeRedemptions, type AccessCodeRow } from './access-code.model';
import { generateCode, hashCode, normalizeCode } from './code-format';

export interface CreateCodeInput {
  /** 1 to 80 characters, for the operator. */
  label: string;
  /** 0 to 1000 */
  sourceRuns: number;
  /** 0 to 1000 */
  promptRuns: number;
  /** 0 to 365 days the hourly limit is lifted */
  liftDays: number;
  /** 1 to 100000 */
  maxRedemptions: number;
  expiresAt?: Date;
}

/** What may be shown about a code. Never the code, never its hash. */
export interface AccessCodeMeta {
  id: string;
  label: string;
  sourceRuns: number;
  promptRuns: number;
  liftDays: number;
  maxRedemptions: number;
  redeemedCount: number;
  expiresAt: Date | null;
  disabled: boolean;
  createdAt: Date;
}

/** The throttle of `redeem`: every attempt counts, successful or not. */
export const REDEEM_RULE: RateLimitRule = {
  name: 'codes.redeem',
  windows: [
    { name: 'short', limit: 5, windowMs: 600_000 },
    { name: 'day', limit: 20, windowMs: 86_400_000 },
  ],
  code: 'RATE_LIMITED',
};

export const CODE_INVALID_MESSAGE = 'This code is not valid';
const MAX_BONUS_RUNS = 1000;

const CreateCodeSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    sourceRuns: z.number().int().min(0).max(1000),
    promptRuns: z.number().int().min(0).max(1000),
    liftDays: z.number().int().min(0).max(365),
    maxRedemptions: z.number().int().min(1).max(100_000),
    expiresAt: z.date().optional(),
  })
  .refine((v) => v.sourceRuns + v.promptRuns + v.liftDays > 0, {
    message: 'at least one of sourceRuns, promptRuns, liftDays must be greater than 0',
    path: ['sourceRuns'],
  });

function toMeta(row: AccessCodeRow): AccessCodeMeta {
  return {
    id: row.id,
    label: row.label,
    sourceRuns: row.sourceRuns,
    promptRuns: row.promptRuns,
    liftDays: row.liftDays,
    maxRedemptions: row.maxRedemptions,
    redeemedCount: row.redeemedCount,
    expiresAt: row.expiresAt,
    disabled: row.disabled,
    createdAt: row.createdAt,
  };
}

function isUniqueViolation(error: unknown, depth = 0): boolean {
  if (typeof error !== 'object' || error === null || depth > 3) return false;
  const { code, cause } = error as { code?: unknown; cause?: unknown };
  return code === '23505' || isUniqueViolation(cause, depth + 1);
}

/**
 * Access codes (contracts/internal-interfaces.md §5.9). The plain code is never stored, logged, or returned again;
 * this class has no logger on purpose.
 */
@Injectable()
export class CodesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
  ) {}

  /** Generates a code and returns it once. Stores the hash only. */
  async create(input: CreateCodeInput): Promise<{ code: string; meta: AccessCodeMeta }> {
    const code = generateCode();
    const meta = await this.insert(input, hashCode(normalizeCode(code)!));
    return { code, meta };
  }

  /** Stores a code supplied by the operator. Accepts only the generated format; returns metadata, never the code. */
  async createFromValue(input: CreateCodeInput, code: string): Promise<AccessCodeMeta> {
    const normalized = normalizeCode(code);
    if (normalized === null) {
      throw new ValidationFailedError([{ path: 'code', message: 'not a valid access code' }]);
    }
    return this.insert(input, hashCode(normalized));
  }

  async list(): Promise<AccessCodeMeta[]> {
    const rows = await this.db.select().from(accessCodes).orderBy(desc(accessCodes.createdAt));
    return rows.map(toMeta);
  }

  /** Sets disabled = true. NotFoundError for an unknown id. */
  async disable(id: string): Promise<AccessCodeMeta> {
    if (!z.string().uuid().safeParse(id).success) throw new NotFoundError('Access code');
    const [row] = await this.db
      .update(accessCodes)
      .set({ disabled: true })
      .where(eq(accessCodes.id, id))
      .returning();
    if (!row) throw new NotFoundError('Access code');
    return toMeta(row);
  }

  /** One redemption per user per code. Throws DomainInvalidError('CODE_INVALID') or RateLimitedError. */
  async redeem(user: AuthUser, code: string): Promise<RedeemResult> {
    await this.limiter.enforce(REDEEM_RULE, user.id);

    const normalized = normalizeCode(code);
    if (normalized === null) throw invalid();
    const hash = hashCode(normalized);
    const now = this.clock.now();
    const nowIso = now.toISOString();

    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(accessCodes)
        .where(eq(accessCodes.codeHash, hash))
        .for('update')
        .limit(1);
      if (!row) throw invalid();
      if (row.disabled) throw invalid();
      if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) throw invalid();
      if (row.redeemedCount >= row.maxRedemptions) throw invalid();

      const inserted = await tx
        .insert(codeRedemptions)
        .values({ codeId: row.id, userId: user.id, redeemedAt: now })
        .onConflictDoNothing()
        .returning({ codeId: codeRedemptions.codeId });
      if (inserted.length === 0) throw invalid();

      const set: Record<string, ReturnType<typeof sql>> = {};
      if (row.sourceRuns > 0) {
        set.bonusSourceRuns = sql`least(${users.bonusSourceRuns} + ${row.sourceRuns}, ${MAX_BONUS_RUNS})`;
      }
      if (row.promptRuns > 0) {
        set.bonusPromptRuns = sql`least(${users.bonusPromptRuns} + ${row.promptRuns}, ${MAX_BONUS_RUNS})`;
      }
      if (row.liftDays > 0) {
        // The later of now and the current lift, plus the days: a second lift extends the first.
        set.limitsLiftedUntil = sql`greatest(coalesce(${users.limitsLiftedUntil}, ${nowIso}::timestamptz), ${nowIso}::timestamptz) + ${row.liftDays} * interval '1 day'`;
      }
      let lifted: Date | null = null;
      if (Object.keys(set).length > 0) {
        const [updated] = await tx
          .update(users)
          .set(set)
          .where(eq(users.id, user.id))
          .returning({ limitsLiftedUntil: users.limitsLiftedUntil });
        if (!updated) throw invalid();
        lifted = updated.limitsLiftedUntil;
      }
      await tx
        .update(accessCodes)
        .set({ redeemedCount: sql`${accessCodes.redeemedCount} + 1` })
        .where(eq(accessCodes.id, row.id));

      return {
        sourceRuns: row.sourceRuns,
        promptRuns: row.promptRuns,
        ...(row.liftDays > 0 && lifted ? { limitsLiftedUntil: lifted.toISOString() } : {}),
      };
    });
  }

  private async insert(input: CreateCodeInput, codeHash: string): Promise<AccessCodeMeta> {
    const parsed = CreateCodeSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationFailedError(
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
          code: issue.code,
        })),
      );
    }
    const value = parsed.data;
    try {
      const [row] = await this.db
        .insert(accessCodes)
        .values({
          id: newId(),
          codeHash,
          label: value.label,
          sourceRuns: value.sourceRuns,
          promptRuns: value.promptRuns,
          liftDays: value.liftDays,
          maxRedemptions: value.maxRedemptions,
          expiresAt: value.expiresAt ?? null,
          createdAt: this.clock.now(),
        })
        .returning();
      return toMeta(row!);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictError('This code already exists');
      throw error;
    }
  }
}

function invalid(): DomainInvalidError {
  return new DomainInvalidError('CODE_INVALID', CODE_INVALID_MESSAGE);
}
