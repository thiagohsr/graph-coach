import { and, eq, gt, sql } from 'drizzle-orm';
import type { CreationKind } from '@coach/types';
import type { Db } from '../../common/db/db.module';
import { users } from '../accounts/user.model';

export interface AllowanceAccount {
  bonusSourceRuns: number;
  bonusPromptRuns: number;
  limitsLiftedUntil: Date | null;
}

/** The slice of Postgres the allowance needs: bonus balances, the lift, and the atomic decrement and refund. */
export interface AllowanceStore {
  read(userId: string): Promise<AllowanceAccount>;
  /** One `UPDATE … WHERE col > 0 RETURNING`: true when a run was taken, false when none was left. */
  consumeBonus(userId: string, kind: CreationKind): Promise<boolean>;
  /** One `UPDATE … SET col = col + 1`. */
  refundBonus(userId: string, kind: CreationKind): Promise<void>;
}

export const ALLOWANCE_STORE = Symbol('ALLOWANCE_STORE');

export class DrizzleAllowanceStore implements AllowanceStore {
  constructor(private readonly db: Db) {}

  async read(userId: string): Promise<AllowanceAccount> {
    const [row] = await this.db
      .select({
        bonusSourceRuns: users.bonusSourceRuns,
        bonusPromptRuns: users.bonusPromptRuns,
        limitsLiftedUntil: users.limitsLiftedUntil,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row ?? { bonusSourceRuns: 0, bonusPromptRuns: 0, limitsLiftedUntil: null };
  }

  async consumeBonus(userId: string, kind: CreationKind): Promise<boolean> {
    const column = kind === 'upload' ? users.bonusSourceRuns : users.bonusPromptRuns;
    const set =
      kind === 'upload'
        ? { bonusSourceRuns: sql`${users.bonusSourceRuns} - 1` }
        : { bonusPromptRuns: sql`${users.bonusPromptRuns} - 1` };
    const rows = await this.db
      .update(users)
      .set(set)
      .where(and(eq(users.id, userId), gt(column, 0)))
      .returning({ id: users.id });
    return rows.length > 0;
  }

  async refundBonus(userId: string, kind: CreationKind): Promise<void> {
    const set =
      kind === 'upload'
        ? { bonusSourceRuns: sql`${users.bonusSourceRuns} + 1` }
        : { bonusPromptRuns: sql`${users.bonusPromptRuns} + 1` };
    await this.db.update(users).set(set).where(eq(users.id, userId));
  }
}
