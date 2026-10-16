// Goal helpers (stretch). Pure.
import type { ResolvedGoal, Selection } from './state';

/**
 * The goal's best concept as a target, for when nothing in the goal's scope had signals or playable content. Without
 * it a goal about content that does not exist yet would end in NO_PLAYABLE_CONTENT instead of a coverage request.
 */
export function goalSelection(goal: ResolvedGoal | null): Selection | null {
  const concept = goal?.concepts[0];
  if (!concept) return null;
  return {
    kind: 'goal',
    target: {
      conceptId: concept.conceptId,
      slug: concept.slug,
      name: concept.name,
      score: null,
      attempts: 0,
      lastSeen: null,
      daysSince: null,
      risk: null,
    },
    drivers: [],
    alternatives: [],
  };
}
