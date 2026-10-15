import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/** Administrator-editable settings: one row per key (data-model.md §4.1). Values are validated by SettingsService. */
export const adminSettings = pgTable('admin_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AdminSettingRow = typeof adminSettings.$inferSelect;
