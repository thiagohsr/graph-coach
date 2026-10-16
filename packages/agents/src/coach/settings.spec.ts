import { describe, expect, it } from 'vitest';
import { CoachSettingsSchema, DEFAULT_COACH_SETTINGS } from './settings';

describe('CoachSettingsSchema', () => {
  it('accepts the five canonical defaults', () => {
    expect(
      CoachSettingsSchema.parse({
        traversalDepth: 4,
        decayDays: 14,
        riskThreshold: 0.5,
        recentPlayDays: 3,
        coachReuseMinutes: 10,
      }),
    ).toEqual(DEFAULT_COACH_SETTINGS);
  });
  it('rejects a depth outside 1 to 8', () => {
    expect(
      CoachSettingsSchema.safeParse({ ...DEFAULT_COACH_SETTINGS, traversalDepth: 0 }).success,
    ).toBe(false);
    expect(
      CoachSettingsSchema.safeParse({ ...DEFAULT_COACH_SETTINGS, traversalDepth: 9 }).success,
    ).toBe(false);
    expect(
      CoachSettingsSchema.safeParse({ ...DEFAULT_COACH_SETTINGS, traversalDepth: 8 }).success,
    ).toBe(true);
  });
  it('rejects decayDays below 1 and a negative reuse window; 0 disables reuse', () => {
    expect(CoachSettingsSchema.safeParse({ ...DEFAULT_COACH_SETTINGS, decayDays: 0 }).success).toBe(
      false,
    );
    expect(
      CoachSettingsSchema.safeParse({ ...DEFAULT_COACH_SETTINGS, coachReuseMinutes: -1 }).success,
    ).toBe(false);
    expect(
      CoachSettingsSchema.safeParse({ ...DEFAULT_COACH_SETTINGS, coachReuseMinutes: 0 }).success,
    ).toBe(true);
  });
});
