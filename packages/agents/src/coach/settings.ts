import { z } from 'zod';
import { MAX_DEPTH } from './constants';

/** The five settings the Coach reads (flat keys of admin_settings, reconciliation A9). */
export const CoachSettingsSchema = z.object({
  traversalDepth: z.number().int().min(1).max(MAX_DEPTH),
  decayDays: z.number().min(1),
  riskThreshold: z.number().min(0).max(2),
  recentPlayDays: z.number().min(0),
  /** 0 disables reuse. */
  coachReuseMinutes: z.number().min(0),
});
export type CoachSettings = z.infer<typeof CoachSettingsSchema>;

export const DEFAULT_COACH_SETTINGS: Readonly<CoachSettings> = Object.freeze({
  traversalDepth: 4,
  decayDays: 14,
  riskThreshold: 0.5,
  recentPlayDays: 3,
  coachReuseMinutes: 10,
});
