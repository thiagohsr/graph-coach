import { validateDraft, type DraftViolationCode } from '@coach/types';
import { WRITE_BATCH_QUESTIONS } from '../../constants';
import { generatedQuestionId, puzzleIdForSource } from '../../ids';
import { batches } from '../../pool';
import { CuratorStepError, type GeneratedQuestionWrite } from '../../ports';
import { withStep } from '../../steps';
import { viewOutline } from '../outline-view';
import {
  promptRunOf,
  readPromptSource,
  type PromptNodeFactory,
  type PromptOutcome,
} from '../state';

interface ValidateSummary {
  outcome: PromptOutcome;
  kept: number;
  discarded: Record<string, number>;
}

/**
 * Applies the shared draft validator with no passage (the passage rule is skipped; every other rule applies, with the
 * outline's concept slugs as the allowed ones), keeps at most `brief.sentences` drafts in planned order, and writes the
 * puzzle only when at least `minQuestions` remain. Every stored draft carries `{ verdict: 'pass', note, rewritten }`.
 */
export const validateNode: PromptNodeFactory = (deps) => async (state) => {
  const summary = await withStep(deps, promptRunOf(state), 'validate', async () => {
    const result = (outcome: PromptOutcome, kept: number, log: string, discarded = {}) => ({
      value: { outcome, kept, discarded } satisfies ValidateSummary,
      log,
      counts: { kept },
    });

    if (state.drafts.length === 0) {
      const task = await deps.graph.loadTask(state.taskId);
      if (task && task.questions > 0) {
        return result('awaiting_review', task.questions, `${task.questions} drafts already stored`);
      }
      return result('nothing_usable', 0, 'No drafts to check');
    }

    const { title, brief, outline } = await readPromptSource(deps, state, 'validate');
    if (!outline) {
      throw new CuratorStepError('validate', 'INCONSISTENT_STATE', 'The outline is missing');
    }
    const allowedSlugs = new Set(viewOutline(outline).concepts.map((c) => c.slug));

    const kept: GeneratedQuestionWrite[] = [];
    const seen = new Set<string>();
    const discarded: Record<string, number> = {};
    const discard = (code: DraftViolationCode | 'over_limit') => {
      discarded[code] = (discarded[code] ?? 0) + 1;
    };

    const ordered = [...state.drafts]
      .filter((d) => d.verdict === 'pass')
      .sort((a, b) => a.index - b.index);
    for (const draft of ordered) {
      const id = generatedQuestionId(state.sourceId, draft.sentence, draft.answers);
      const check = validateDraft(
        {
          sentence: draft.sentence,
          answers: draft.answers,
          distractors: draft.distractors,
          conceptSlugs: [draft.conceptSlug],
        },
        { chunkText: null, allowedSlugs, seenIds: seen, id },
      );
      if (!check.ok) {
        for (const violation of check.violations) discard(violation.code);
        continue;
      }
      if (kept.length >= brief.sentences) {
        discard('over_limit');
        continue;
      }
      seen.add(id);
      kept.push({
        id,
        sentence: draft.sentence,
        answers: draft.answers,
        distractors: draft.distractors,
        order: kept.length + 1,
        conceptSlugs: check.conceptSlugs,
        critique: { verdict: 'pass', note: draft.note ?? '', rewritten: draft.rewritten },
      });
    }

    const discardedTotal = Object.values(discarded).reduce((a, b) => a + b, 0);
    const reasons = Object.entries(discarded)
      .map(([code, n]) => `${code} ${n}`)
      .join(', ');

    if (kept.length < Math.max(1, state.minQuestions)) {
      return {
        value: { outcome: 'nothing_usable', kept: 0, discarded } satisfies ValidateSummary,
        log:
          `Only ${kept.length} usable drafts, ${Math.max(1, state.minQuestions)} needed` +
          (discardedTotal > 0 ? `: ${discardedTotal} discarded (${reasons})` : ''),
        counts: { kept: 0, discarded: discardedTotal },
      };
    }

    const puzzleId = puzzleIdForSource(state.sourceId);
    await deps.graph.createDraftPuzzle({
      id: puzzleId,
      ownerId: state.ownerId,
      sourceId: state.sourceId,
      taskId: state.taskId,
      name: title.slice(0, 200),
      origin: 'prompt',
      now: deps.now(),
    });
    let written = 0;
    for (const batch of batches(kept, WRITE_BATCH_QUESTIONS)) {
      written += await deps.graph.createGeneratedQuestions(
        puzzleId,
        state.taskId,
        state.sourceId,
        batch,
        deps.now(),
      );
    }
    if (written !== kept.length) {
      throw new CuratorStepError(
        'validate',
        'INCONSISTENT_STATE',
        `Wrote ${written} of ${kept.length} drafts`,
      );
    }
    return {
      value: { outcome: 'awaiting_review', kept: kept.length, discarded } satisfies ValidateSummary,
      log:
        `${kept.length} drafts kept` +
        (discardedTotal > 0 ? `, ${discardedTotal} discarded (${reasons})` : ''),
      counts: { kept: kept.length, discarded: discardedTotal },
    };
  });
  return {
    outcome: summary.outcome,
    counts: { ...state.counts, kept: summary.kept, discarded: summary.discarded },
  };
};
