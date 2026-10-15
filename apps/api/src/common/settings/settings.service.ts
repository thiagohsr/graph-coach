import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../clock';
import { DB, type Db } from '../db/db.module';
import { adminSettings } from './admin-setting.model';
import {
  DEFAULT_ROW_KEYS,
  SETTING_DEFAULTS,
  SettingsSchema,
  isSettingKey,
  type SettingKey,
  type Settings,
} from './settings.schema';

export { SETTING_DEFAULTS, type SettingKey, type Settings } from './settings.schema';

/** Values are cached this long on the injected clock (contracts §5.5). */
export const SETTINGS_CACHE_MS = 5_000;

export interface SettingRow {
  key: string;
  value: unknown;
}

/** The slice of the `admin_settings` table the service needs; a fake in unit tests. */
export interface SettingsTable {
  readAll(): Promise<SettingRow[]>;
  /** Inserts rows whose key is absent; never overwrites. Returns how many were inserted. */
  insertMissing(rows: SettingRow[]): Promise<number>;
  upsert(row: SettingRow): Promise<void>;
}

export const SETTINGS_TABLE = Symbol('SETTINGS_TABLE');

export class DrizzleSettingsTable implements SettingsTable {
  constructor(private readonly db: Db) {}

  async readAll(): Promise<SettingRow[]> {
    return this.db.select({ key: adminSettings.key, value: adminSettings.value }).from(adminSettings);
  }

  async insertMissing(rows: SettingRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    const inserted = await this.db
      .insert(adminSettings)
      .values(rows.map((row) => ({ key: row.key, value: row.value })))
      .onConflictDoNothing()
      .returning({ key: adminSettings.key });
    return inserted.length;
  }

  async upsert(row: SettingRow): Promise<void> {
    await this.db
      .insert(adminSettings)
      .values({ key: row.key, value: row.value })
      .onConflictDoUpdate({
        target: adminSettings.key,
        set: { value: row.value, updatedAt: sql`now()` },
      });
  }
}

export function createSettingsTable(db: Db): SettingsTable {
  return new DrizzleSettingsTable(db);
}

/**
 * Typed access to the administrator-editable settings (contracts/internal-interfaces.md §5.5). `get` never throws for a
 * stored problem: a missing row, an invalid value, or an unreachable database gives the last known value or the default.
 */
@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger('SettingsService');
  private cache: { values: Settings; expires: number } | null = null;
  private lastKnown: Settings | null = null;
  private loading: Promise<Settings> | null = null;

  constructor(
    @Inject(SETTINGS_TABLE) private readonly table: SettingsTable,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureDefaults();
  }

  async get<K extends SettingKey>(key: K): Promise<Settings[K]> {
    if (!isSettingKey(key)) throw new Error(`Unknown setting key: ${String(key)}`);
    return (await this.getAll())[key];
  }

  async getAll(): Promise<Settings> {
    const now = this.clock.now().getTime();
    if (this.cache && this.cache.expires > now) return this.cache.values;
    this.loading ??= this.load().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  async set<K extends SettingKey>(key: K, value: Settings[K]): Promise<void> {
    if (!isSettingKey(key)) throw new Error(`Unknown setting key: ${String(key)}`);
    const parsed = this.schemaFor(key).parse(value);
    await this.table.upsert({ key, value: parsed });
    this.invalidate();
  }

  invalidate(): void {
    this.cache = null;
  }

  schemaFor<K extends SettingKey>(key: K): z.ZodType<Settings[K]> {
    if (!isSettingKey(key)) throw new Error(`Unknown setting key: ${String(key)}`);
    return SettingsSchema.shape[key] as unknown as z.ZodType<Settings[K]>;
  }

  /** Inserts a row with the default for every key that has none (not embeddingDim). Tolerates an unreachable database. */
  async ensureDefaults(): Promise<void> {
    try {
      const inserted = await this.table.insertMissing(
        DEFAULT_ROW_KEYS.map((key) => ({ key, value: SETTING_DEFAULTS[key] })),
      );
      if (inserted > 0) this.invalidate();
    } catch {
      this.logger.warn('Could not insert the default settings rows: the database is not reachable');
    }
  }

  private async load(): Promise<Settings> {
    const expires = this.clock.now().getTime() + SETTINGS_CACHE_MS;
    let rows: SettingRow[];
    try {
      rows = await this.table.readAll();
    } catch {
      this.logger.warn('Could not read the settings: using the last known values');
      const values = this.lastKnown ?? { ...SETTING_DEFAULTS };
      this.cache = { values, expires };
      return values;
    }

    const stored = new Map(rows.map((row) => [row.key, row.value]));
    const values: Record<string, unknown> = { ...SETTING_DEFAULTS };
    for (const key of Object.keys(SETTING_DEFAULTS) as SettingKey[]) {
      if (!stored.has(key)) continue;
      const parsed = SettingsSchema.shape[key].safeParse(stored.get(key));
      if (parsed.success) values[key] = parsed.data;
      else this.logger.warn(`Setting ${key} has an invalid stored value: using the default`);
    }
    const result = values as Settings;
    this.lastKnown = result;
    this.cache = { values: result, expires };
    return result;
  }
}
