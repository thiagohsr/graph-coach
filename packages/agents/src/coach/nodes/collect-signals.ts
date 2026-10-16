import { DAY_MS, QUERY_LIMIT } from '../constants';
import type { CoachDeps, CoachNode } from '../deps';

/**
 * Tier 1 (weak concepts), then tier 2 (unseen or decayed), then tier 3 (practised longest ago). Stores rows only; no
 * ranking. Runs no query when the learner has no mastery edge (cold start). Cyclic rows are dropped and logged.
 */
export function createCollectSignalsNode(deps: Pick<CoachDeps, 'queries' | 'settings' | 'logger'>): CoachNode {
  return async (state) => {
    if ((state.recent?.masteryCount ?? 0) === 0) return { signals: null };
    const { queries, settings, logger } = deps;
    // With a goal that resolved to concepts, candidates are limited to those concepts and their prerequisites.
    const scopeIds = state.goal?.scopeIds ?? [];

    const weakRows = await queries.weakConceptsWithWeakPrereqs({
      learnerId: state.learnerId,
      now: state.now,
      decayDays: settings.decayDays,
      threshold: settings.riskThreshold,
      depth: settings.traversalDepth,
      scopeIds,
    });
    const weak = weakRows.filter((row) => {
      if (row.cyclic) logger?.warn('coach.prerequisite_cycle', { conceptId: row.conceptId });
      return !row.cyclic;
    });
    if (weak.length > 0) return { signals: { tier: 1, weak, other: [] } };

    const candidates = (before: number) =>
      queries.decayedOrUnseenConcepts({
        userId: state.learnerId,
        now: state.now,
        before,
        decayDays: settings.decayDays,
        depth: settings.traversalDepth,
        scopeIds,
        limit: QUERY_LIMIT,
      });

    const decayed = await candidates(state.now - settings.decayDays * DAY_MS);
    if (decayed.length > 0) return { signals: { tier: 2, weak: [], other: decayed } };

    const longestAgo = await candidates(state.now);
    return { signals: { tier: 3, weak: [], other: longestAgo } };
  };
}
