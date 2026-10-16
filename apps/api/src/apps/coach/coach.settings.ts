import { CoachSettingsSchema, type CoachSettings } from '@coach/agents/coach';
import { AppError } from '../../common/errors/app-error';
import type { SettingsService } from '../../common/settings/settings.service';

/**
 * Reads the five settings the Coach uses (reconciliation A9) and validates them with the Coach's own schema.
 * A value outside the Coach's ranges is a configuration error: 500 INTERNAL.
 */
export async function loadCoachSettings(
  settings: Pick<SettingsService, 'getAll'>,
): Promise<CoachSettings> {
  const all = await settings.getAll();
  const parsed = CoachSettingsSchema.safeParse({
    traversalDepth: all.traversalDepth,
    decayDays: all.decayDays,
    riskThreshold: all.riskThreshold,
    recentPlayDays: all.recentPlayDays,
    coachReuseMinutes: all.coachReuseMinutes,
  });
  if (!parsed.success) {
    throw new AppError(
      'INTERNAL',
      `The Coach settings are invalid: ${parsed.error.issues[0]?.path.join('.')}`,
      500,
    );
  }
  return parsed.data;
}
