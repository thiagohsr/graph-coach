import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from '../accounts/user.model';

/**
 * Redeemable access codes (data-model.md §4). Only the SHA-256 hash of the normalised code is stored; `code_hash` is
 * never selected for display, never registered in the admin, never logged.
 */
export const accessCodes = pgTable(
  'access_codes',
  {
    id: uuid('id').primaryKey(),
    codeHash: text('code_hash').notNull().unique(),
    label: varchar('label', { length: 80 }).notNull(),
    sourceRuns: integer('source_runs').notNull().default(0),
    promptRuns: integer('prompt_runs').notNull().default(0),
    liftDays: integer('lift_days').notNull().default(0),
    maxRedemptions: integer('max_redemptions').notNull(),
    redeemedCount: integer('redeemed_count').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    disabled: boolean('disabled').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('access_codes_source_runs_check', sql`${table.sourceRuns} >= 0`),
    check('access_codes_prompt_runs_check', sql`${table.promptRuns} >= 0`),
    check('access_codes_lift_days_check', sql`${table.liftDays} >= 0`),
    check('access_codes_max_redemptions_check', sql`${table.maxRedemptions} >= 1`),
    check(
      'access_codes_redeemed_count_check',
      sql`${table.redeemedCount} >= 0 and ${table.redeemedCount} <= ${table.maxRedemptions}`,
    ),
    check(
      'access_codes_grant_check',
      sql`${table.sourceRuns} + ${table.promptRuns} + ${table.liftDays} > 0`,
    ),
  ],
);

/** One redemption per user per code. */
export const codeRedemptions = pgTable(
  'code_redemptions',
  {
    codeId: uuid('code_id')
      .notNull()
      .references(() => accessCodes.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    redeemedAt: timestamp('redeemed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.codeId, table.userId] })],
);

export type AccessCodeRow = typeof accessCodes.$inferSelect;
