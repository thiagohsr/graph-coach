import { beforeEach, describe, expect, it } from 'vitest';
import type { Clock } from '../clock';
import { SETTING_KEYS } from './settings.schema';
import {
  SETTING_DEFAULTS,
  SETTINGS_CACHE_MS,
  SettingsService,
  type SettingRow,
  type SettingsTable,
} from './settings.service';

class FakeClock implements Clock {
  private ms = Date.UTC(2026, 9, 15, 12, 0, 0);
  now(): Date {
    return new Date(this.ms);
  }
  advance(ms: number): void {
    this.ms += ms;
  }
}

class FakeTable implements SettingsTable {
  rows = new Map<string, unknown>();
  failing = false;
  reads = 0;
  async readAll(): Promise<SettingRow[]> {
    this.reads += 1;
    if (this.failing) throw new Error('down');
    return [...this.rows].map(([key, value]) => ({ key, value }));
  }
  async insertMissing(rows: SettingRow[]): Promise<number> {
    if (this.failing) throw new Error('down');
    let n = 0;
    for (const row of rows) {
      if (!this.rows.has(row.key)) {
        this.rows.set(row.key, row.value);
        n += 1;
      }
    }
    return n;
  }
  async upsert(row: SettingRow): Promise<void> {
    this.rows.set(row.key, row.value);
  }
}

let clock: FakeClock;
let table: FakeTable;
let settings: SettingsService;

beforeEach(() => {
  clock = new FakeClock();
  table = new FakeTable();
  settings = new SettingsService(table, clock);
});

describe('defaults and stored values', () => {
  it('returns the data-model defaults when rows are missing', async () => {
    expect(await settings.getAll()).toEqual(SETTING_DEFAULTS);
    expect(await settings.get('monthlySourceAllowance')).toBe(3);
    expect(await settings.get('monthlyPromptAllowance')).toBe(3);
    expect(await settings.get('hourlyCreationLimit')).toBe(5);
    expect(await settings.get('creationEnabled')).toBe(true);
    expect(await settings.get('embeddingDim')).toBeNull();
  });

  it('stored valid values win', async () => {
    table.rows.set('hourlyCreationLimit', 9);
    table.rows.set('embeddingDim', 64);
    expect(await settings.get('hourlyCreationLimit')).toBe(9);
    expect(await settings.get('embeddingDim')).toBe(64);
  });

  it('an invalid stored value falls back to the default', async () => {
    table.rows.set('masteryAlpha', 7);
    table.rows.set('decayDays', 'soon');
    expect(await settings.get('masteryAlpha')).toBe(0.3);
    expect(await settings.get('decayDays')).toBe(14);
  });
});

describe('failures', () => {
  it('a reader that throws gives the defaults, then the last known values', async () => {
    table.failing = true;
    expect(await settings.get('hourlyCreationLimit')).toBe(5);

    table.failing = false;
    table.rows.set('hourlyCreationLimit', 8);
    clock.advance(SETTINGS_CACHE_MS + 1);
    expect(await settings.get('hourlyCreationLimit')).toBe(8);

    table.failing = true;
    clock.advance(SETTINGS_CACHE_MS + 1);
    expect(await settings.get('hourlyCreationLimit')).toBe(8);
  });
});

describe('cache', () => {
  it('caches for 5 seconds on the clock and sees a direct table edit afterwards', async () => {
    expect(await settings.get('decayDays')).toBe(14);
    table.rows.set('decayDays', 20);
    clock.advance(SETTINGS_CACHE_MS - 1);
    expect(await settings.get('decayDays')).toBe(14);
    expect(table.reads).toBe(1);
    clock.advance(2);
    expect(await settings.get('decayDays')).toBe(20);
    expect(table.reads).toBe(2);
  });

  it('set validates, writes, and invalidates', async () => {
    expect(await settings.get('decayDays')).toBe(14);
    await settings.set('decayDays', 30);
    expect(table.rows.get('decayDays')).toBe(30);
    expect(await settings.get('decayDays')).toBe(30);
    await expect(settings.set('decayDays', 0)).rejects.toThrow();
    await expect(settings.set('creationEnabled', 'yes' as unknown as boolean)).rejects.toThrow();
    expect(table.rows.get('decayDays')).toBe(30);
  });
});

describe('schemaFor', () => {
  it('masteryAlpha rejects 0 and 1.5 and accepts 1', () => {
    const schema = settings.schemaFor('masteryAlpha');
    expect(schema.safeParse(0).success).toBe(false);
    expect(schema.safeParse(1.5).success).toBe(false);
    expect(schema.safeParse(1).success).toBe(true);
  });
});

describe('keys', () => {
  it('are exactly the 15 canonical ones', () => {
    expect([...SETTING_KEYS].sort()).toEqual(
      [
        'masteryAlpha',
        'decayDays',
        'traversalDepth',
        'riskThreshold',
        'minQuestions',
        'monthlySourceAllowance',
        'monthlyPromptAllowance',
        'hourlyCreationLimit',
        'creationEnabled',
        'coachReuseMinutes',
        'recentPlayDays',
        'sourceMaxWords',
        'chunkSizeChars',
        'chunkOverlapChars',
        'embeddingDim',
      ].sort(),
    );
    expect(Object.keys(SETTING_DEFAULTS)).toHaveLength(15);
  });

  it('an unknown key is a runtime error', async () => {
    // @ts-expect-error not a setting key
    await expect(settings.get('nope')).rejects.toThrow(/Unknown setting key/);
    // @ts-expect-error not a setting key
    await expect(settings.set('nope', 1)).rejects.toThrow(/Unknown setting key/);
    // @ts-expect-error not a setting key
    expect(() => settings.schemaFor('nope')).toThrow(/Unknown setting key/);
  });
});

describe('ensureDefaults', () => {
  it('inserts 14 rows on an empty table, nothing on the second call, and never overwrites', async () => {
    await settings.ensureDefaults();
    expect(table.rows.size).toBe(14);
    expect(table.rows.has('embeddingDim')).toBe(false);

    table.rows.set('decayDays', 99);
    await settings.ensureDefaults();
    expect(table.rows.size).toBe(14);
    expect(table.rows.get('decayDays')).toBe(99);
  });

  it('tolerates a database that is down', async () => {
    table.failing = true;
    await expect(settings.ensureDefaults()).resolves.toBeUndefined();
  });
});
