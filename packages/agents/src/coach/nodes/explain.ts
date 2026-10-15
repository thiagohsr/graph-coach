import { ANSWER_ROWS_LIMIT } from '../constants';
import type { CoachDeps, CoachNode } from '../deps';
import { buildEvidence } from '../evidence';
import type { AnswerEvidenceRow } from '../rows';
import { renderSummary } from '../summary';

/**
 * Builds the evidence items (target, drivers, alternatives, wrong answers, sessions) and the template summary. The
 * summary is always the template here; model phrasing (T067) is not wired.
 */
export function createExplainNode(deps: Pick<CoachDeps, 'queries' | 'settings'>): CoachNode {
  return async (state) => {
    const selection = state.selection;
    if (!selection) throw new Error('explain needs a selection');

    let answers: AnswerEvidenceRow[] = [];
    if (selection.kind !== 'cold_start') {
      answers = await deps.queries.conceptAnswerEvidence({
        learnerId: state.learnerId,
        conceptIds: [selection.target.conceptId, ...selection.drivers.map((d) => d.conceptId)],
        limit: ANSWER_ROWS_LIMIT,
      });
    }
    const evidence = buildEvidence({ selection, answers, flags: state.flags }, deps.settings);
    const summary = renderSummary({ selection, puzzle: state.puzzle, flags: state.flags, evidence });
    return { evidence, summary, kind: 'recommendation' };
  };
}
