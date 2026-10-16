import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { DevUserDto } from '@coach/types';
import { DB, type Db } from '../../common/db/db.module';
import { users } from './user.model';

/** The four seeded demo accounts, in the order the development picker shows them (data-model.md §5.1). */
export const DEMO_EMAILS = [
  'learner@example.test',
  'learner2@example.test',
  'reviewer@example.test',
  'admin@example.test',
] as const;

/** The only way other modules touch e-mail addresses (spec FR-P26, reconciliation I15). */
@Injectable()
export class UserDirectory {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Id of the account with that address (trimmed, lower-cased), or null. By default only accounts that have signed in. */
  async findIdByEmail(
    email: string,
    options: { signedInOnly?: boolean } = {},
  ): Promise<string | null> {
    const signedInOnly = options.signedInOnly ?? true;
    const normalized = email.trim().toLowerCase();
    const [row] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(
        signedInOnly
          ? and(eq(users.email, normalized), isNotNull(users.lastSeenAt))
          : eq(users.email, normalized),
      )
      .limit(1);
    return row?.id ?? null;
  }

  /** Display names by user id. Unknown ids are absent from the map. */
  async displayNames(ids: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (ids.length === 0) return result;
    const rows = await this.db
      .select({ id: users.id, name: users.displayName })
      .from(users)
      .where(inArray(users.id, [...new Set(ids)]));
    for (const row of rows) result.set(row.id, row.name);
    return result;
  }

  /** Name and address by user id. Only for a response to the puzzle owner about people they shared with, and the admin. */
  async contacts(ids: string[]): Promise<Map<string, { name: string; email: string }>> {
    const result = new Map<string, { name: string; email: string }>();
    if (ids.length === 0) return result;
    const rows = await this.db
      .select({ id: users.id, name: users.displayName, email: users.email })
      .from(users)
      .where(inArray(users.id, [...new Set(ids)]));
    for (const row of rows) result.set(row.id, { name: row.name, email: row.email });
    return result;
  }

  /** The seeded demo accounts that exist, ordered learner, learner2, reviewer, admin. Never any other account. */
  async demoUsers(): Promise<DevUserDto[]> {
    const rows = await this.db
      .select({ email: users.email, name: users.displayName, role: users.role })
      .from(users)
      .where(inArray(users.email, [...DEMO_EMAILS]));
    return rows.sort(
      (a, b) => DEMO_EMAILS.indexOf(a.email as never) - DEMO_EMAILS.indexOf(b.email as never),
    );
  }
}
