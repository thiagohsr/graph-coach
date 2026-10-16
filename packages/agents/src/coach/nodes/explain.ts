import type { CoachFlag } from '@coach/types';
import { ZERO_USAGE } from '../../llm/usage';
import { ANSWER_ROWS_LIMIT, PHRASE_WITH_MODEL } from '../constants';
import type { CoachDeps, CoachNode } from '../deps';
import { buildEvidence } from '../evidence';
import { phraseSummary } from '../phrase';
import type { AnswerEvidenceRow } from '../rows';
import { renderSummary, type SummaryInput } from '../summary';

/**
 * Builds the evidence items (target, drivers, alternatives, wrong answers, sessions, passages) and the template
 * summary. With a goal whose concepts lack playable content it reads the creation allowance (never consuming it) and
 * sets `coverage_requested` or `coverage_not_requested`, plus `coverage_gap`, before the decision is recorded. When
 * `PHRASE_WITH_MODEL` is on and a chat model is present, the model may rephrase the summary text (T067); a failure keeps
 * the template and is logged as `coach.phrase_fallback`.
 */
export function createExplainNode(
  deps: Pick<
    CoachDeps,
    'queries' | 'settings' | 'logger' | 'chatModel' | 'phraseWithModel' | 'coverageAllowance'
  >,
): CoachNode {
  return async (state, step) => {
    const selection = state.selection;
    if (!selection) throw new Error('explain needs a selection');

    let answers: AnswerEvidenceRow[] = [];
    if (selection.kind !== 'cold_start' && selection.kind !== 'goal') {
      answers = await deps.queries.conceptAnswerEvidence({
        learnerId: state.learnerId,
        conceptIds: [selection.target.conceptId, ...selection.drivers.map((d) => d.conceptId)],
        limit: ANSWER_ROWS_LIMIT,
      });
    }
    const evidence = buildEvidence(
      {
        selection,
        answers,
        ...(state.goal ? { passages: state.goal.passages } : {}),
        flags: state.flags,
      },
      deps.settings,
    );

    // Goal coverage: the allowance is only ever read here.
    const extraFlags: CoachFlag[] = [];
    let coverage: SummaryInput['coverage'];
    let missingNames: string[] = [];
    let kind: 'recommendation' | 'coverage_request' = 'recommendation';
    if (state.goal && state.missingConceptIds.length > 0) {
      const names = new Map(state.goal.concepts.map((c) => [c.conceptId, c.name]));
      missingNames = state.missingConceptIds.map((id) => names.get(id) ?? id);
      const verdict = deps.coverageAllowance
        ? await deps.coverageAllowance()
        : { allowed: false as const, reason: 'no_allowance' as const };
      extraFlags.push('coverage_gap');
      if (verdict.allowed) {
        extraFlags.push('coverage_requested');
        coverage = { requested: true };
        if (state.puzzle === null) kind = 'coverage_request';
      } else {
        extraFlags.push('coverage_not_requested');
        coverage = { requested: false, reason: verdict.reason ?? 'no_allowance' };
      }
    }

    // The template sees the flags as they were before this node (the target-coverage sentence follows the puzzle search).
    const template = renderSummary({
      selection,
      puzzle: state.puzzle,
      flags: state.flags,
      evidence,
      missingNames,
      ...(coverage ? { coverage } : {}),
    });

    let summary = template;
    let usage = { ...ZERO_USAGE };
    if ((deps.phraseWithModel ?? PHRASE_WITH_MODEL) && deps.chatModel) {
      const mustContain = [selection.target.name, ...(state.puzzle ? [state.puzzle.name] : [])];
      const phrased = await phraseSummary(
        template,
        mustContain,
        deps.chatModel,
        step ? { trace: step } : {},
      );
      summary = phrased.text;
      usage = { ...phrased.usage };
      // Ids and a reason only: never the summary or the model output.
      if (phrased.fallback)
        deps.logger?.warn('coach.phrase_fallback', {
          runId: state.runId,
          reason: phrased.fallback,
        });
    }

    return {
      evidence,
      summary,
      kind,
      usage,
      ...(extraFlags.length > 0 ? { flags: extraFlags } : {}),
    };
  };
}
