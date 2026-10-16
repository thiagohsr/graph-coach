import type { CoachDeps, CoachNode } from '../deps';
import { DecisionNotRecordedError } from '../errors';
import { coverTaskId } from '../ids';

/**
 * Stretch. Runs after `recordDecision`, and only when `explain` saw the allowance check pass (`coverage_requested`).
 * Creates the queued `cover` task for the Curator (a graph node only: the Coach never calls the Curator). The id is
 * deterministic, so repeating the same gap returns the existing task.
 */
export function createRequestCoverageNode(deps: Pick<CoachDeps, 'queries'>): CoachNode {
  return async (state) => {
    if (!state.decisionId || state.missingConceptIds.length === 0) return {};
    const row = await deps.queries.createCoverTask({
      taskId: coverTaskId(state.learnerId, state.missingConceptIds),
      learnerId: state.learnerId,
      decisionId: state.decisionId,
      conceptIds: state.missingConceptIds,
      now: state.now,
    });
    if (!row) throw new DecisionNotRecordedError();
    return { coverageTaskId: row.taskId };
  };
}
