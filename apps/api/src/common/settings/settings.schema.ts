// The 15 setting keys, their bounds and defaults (data-model.md §4.1). Defined once, here.
import { z } from 'zod';

const int = (min: number, max: number) => z.number().int().min(min).max(max);

export const SettingsSchema = z.object({
  /** 0 < x <= 1 */
  masteryAlpha: z.number().gt(0).max(1),
  decayDays: int(1, 365),
  traversalDepth: int(1, 6),
  riskThreshold: z.number().min(0).max(2),
  minQuestions: int(1, 50),
  monthlySourceAllowance: int(0, 1000),
  monthlyPromptAllowance: int(0, 1000),
  hourlyCreationLimit: int(0, 1000),
  creationEnabled: z.boolean(),
  coachReuseMinutes: int(0, 1440),
  recentPlayDays: int(0, 365),
  sourceMaxWords: int(100, 100_000),
  chunkSizeChars: int(200, 8000),
  chunkOverlapChars: int(0, 2000),
  /** Written by `setup-graph`; null until then. Read-only for admins. */
  embeddingDim: int(1, 8192).nullable(),
});

export type Settings = z.infer<typeof SettingsSchema>;
export type SettingKey = keyof Settings;

export const SETTING_DEFAULTS: Readonly<Settings> = Object.freeze({
  masteryAlpha: 0.3,
  decayDays: 14,
  traversalDepth: 4,
  riskThreshold: 0.5,
  minQuestions: 3,
  monthlySourceAllowance: 3,
  monthlyPromptAllowance: 3,
  hourlyCreationLimit: 5,
  creationEnabled: true,
  coachReuseMinutes: 10,
  recentPlayDays: 3,
  sourceMaxWords: 10_000,
  chunkSizeChars: 1200,
  chunkOverlapChars: 150,
  embeddingDim: null,
});

export const SETTING_KEYS = Object.keys(SettingsSchema.shape) as SettingKey[];

/** Keys that get a row of defaults from `ensureDefaults` (everything except `embeddingDim`). */
export const DEFAULT_ROW_KEYS = SETTING_KEYS.filter((key) => key !== 'embeddingDim');

export function isSettingKey(key: string): key is SettingKey {
  return (SETTING_KEYS as string[]).includes(key);
}
