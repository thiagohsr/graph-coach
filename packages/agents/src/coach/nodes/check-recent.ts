import { MINUTE_MS } from '../constants';
import type { CoachDeps, CoachNode } from '../deps';
import { LearnerNotFoundError } from '../errors';

/** Lower-cased, whitespace collapsed; null and blank are the same. */
export function normaliseGoal(text: string | null | undefined): string {
  return (text ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Reuse a decision made inside `coachReuseMinutes` when no session was submitted since and the goal text is unchanged.
 * Also yields `masteryCount` (in `recent`) for the cold-start route.
 */
export function createCheckRecentNode(deps: Pick<CoachDeps, 'queries' | 'settings'>): CoachNode {
  return async (state) => {
    const { coachReuseMinutes } = deps.settings;
    const recent = await deps.queries.recentDecision({
      learnerId: state.learnerId,
      since: state.now - coachReuseMinutes * MINUTE_MS,
    });
    if (!recent) throw new LearnerNotFoundError();
    const reusable =
      coachReuseMinutes > 0 &&
      recent.decisionId !== null &&
      !recent.newAnswers &&
      normaliseGoal(state.goalText) === normaliseGoal(recent.goalText);
    if (reusable) return { recent, decisionId: recent.decisionId, outcome: 'reused' };
    return { recent };
  };
}
