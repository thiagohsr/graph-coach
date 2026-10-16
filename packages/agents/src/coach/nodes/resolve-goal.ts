import { ProviderUnavailableError } from '../../llm/errors';
import type { Usage } from '../../llm/usage';
import { GOAL_MIN_SIMILARITY, GOAL_TOP_K, QUERY_LIMIT } from '../constants';
import type { CoachDeps, CoachNode } from '../deps';
import { goalId } from '../ids';
import type { GoalConceptRow } from '../rows';
import type { GoalConcept, ResolvedGoal } from '../state';
import { normaliseGoal } from './check-recent';

/** One row per concept, highest score first (ties: name, slug). A concept matched twice keeps the higher score. */
export function mergeGoalConcepts(rows: GoalConceptRow[]): GoalConcept[] {
  const best = new Map<string, GoalConcept>();
  for (const row of rows) {
    const known = best.get(row.conceptId);
    if (!known || row.score > known.score) {
      best.set(row.conceptId, {
        conceptId: row.conceptId,
        slug: row.slug,
        name: row.name,
        score: row.score,
      });
    }
  }
  return [...best.values()].sort(
    (a, b) =>
      b.score - a.score ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) ||
      (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
  );
}

/**
 * Stretch. Embeds the goal (one request, `result.vectors[0]`), finds concepts through the chunks the learner may read
 * plus a direct name or slug match, stores the goal with its targets, and yields the scope that limits the candidate
 * queries. A goal that matches nothing is still stored, sets `goal_unmatched`, and behaves as no goal afterwards.
 * An embeddings provider that is missing or fails makes the run fail (503 PROVIDER_UNAVAILABLE in the API): a goal was
 * asked for and cannot be honoured, so no silent fallback to a plain recommendation.
 */
export function createResolveGoalNode(
  deps: Pick<CoachDeps, 'queries' | 'settings' | 'embeddings'>,
): CoachNode {
  return async (state, step) => {
    const text = (state.goalText ?? '').trim();
    const normalised = normaliseGoal(text);
    if (normalised === '') return { goal: null };
    const { embeddings } = deps;
    if (!embeddings) {
      throw new ProviderUnavailableError('No embeddings provider is configured', {
        provider: 'none',
        label: 'coach.resolveGoal',
      });
    }

    // A failed call throws a ProviderError that carries its own usage; the run ends there and nothing is stored.
    const result = await embeddings.embed([text], {
      label: 'coach.resolveGoal',
      ...(step ? { trace: step } : {}),
    });
    const usage: Usage = result.usage;
    const embedding = result.vectors[0];
    if (!embedding) {
      throw new ProviderUnavailableError('The embeddings provider returned no vector', {
        provider: embeddings.name,
        label: 'coach.resolveGoal',
        usage,
      });
    }

    // db.idx.vector.queryNodes yields a cosine DISTANCE; resolve_goal_concepts converts it with 1.0 - distance and
    // compares that similarity with GOAL_MIN_SIMILARITY. The score of a passage row is therefore a similarity.
    const rows = await deps.queries.resolveGoalConcepts({
      userId: state.learnerId,
      embedding,
      k: GOAL_TOP_K,
      minSimilarity: GOAL_MIN_SIMILARITY,
      goalText: normalised,
      goalSlugText: normalised.replace(/ /g, '-'),
      limit: QUERY_LIMIT,
    });
    const concepts = mergeGoalConcepts(rows);
    const passages = rows
      .filter((row) => row.via === 'passage' && row.bestChunkId !== null)
      .sort((a, b) => b.score - a.score || (a.conceptId < b.conceptId ? -1 : 1));

    const id = goalId(state.learnerId, normalised);
    const scope = await deps.queries.upsertGoal({
      goalId: id,
      learnerId: state.learnerId,
      text,
      now: state.now,
      targets: concepts.map((c) => ({ conceptId: c.conceptId, score: c.score })),
      depth: deps.settings.traversalDepth,
    });

    // Targets in score order (deterministic); the scope adds the sorted upstream prerequisites.
    const targetIds = concepts.map((c) => c.conceptId);
    const scopeIds = [...new Set([...targetIds, ...[...(scope?.prerequisiteIds ?? [])].sort()])];
    const goal: ResolvedGoal = { goalId: id, concepts, targetIds, scopeIds, passages };
    return {
      goal,
      usage,
      ...(concepts.length === 0 ? { flags: ['goal_unmatched' as const] } : {}),
    };
  };
}
