import { validateDraft, type DraftViolationCode } from '@coach/types';
import { MAX_TOPUP_ROUNDS, WRITE_BATCH_QUESTIONS } from '../../constants';
import { generatedQuestionId, puzzleIdForSource } from '../../ids';
import { batches } from '../../pool';
import { CuratorStepError } from '../../ports';
import { withStep } from '../../steps';
import { viewOutline } from '../outline-view';
import { isNearDuplicate } from '../similarity';
import {
  promptRunOf,
  readPromptSource,
  roundPrefix,
  type KeptDraft,
  type PromptNodeFactory,
  type PromptOutcome,
} from '../state';

interface ValidateSummary {
  outcome: PromptOutcome;
  kept: KeptDraft[];
  /** What `Task` counts as kept: the stored count when the questions were stored by an earlier attempt. */
  keptCount: number;
  added: number;
  requested: number;
  settled: boolean;
  discarded: Record<string, number>;
}

/**
 * Applies the shared draft validator with no passage (the passage rule is skipped; every other rule applies, with the
 * outline's concept slugs as the allowed ones) to the drafts of the current round only, merges the ones that pass with
 * the drafts kept in earlier rounds (identical or near-identical sentences are discarded as `duplicate`), keeps at most
 * `brief.sentences` in total, and writes the puzzle once at least `minQuestions` remain; later rounds add only their new
 * questions. Every stored draft carries `{ verdict: 'pass', note, rewritten }`. The conditional edge after this node
 * decides whether a top-up round follows (reconciliation N).
 */
export const validateNode: PromptNodeFactory = (deps) => async (state) => {
  const round = state.round;
  const summary = await withStep<ValidateSummary>(
    deps,
    promptRunOf(state),
    'validate',
    async () => {
      const prefix = roundPrefix(round);
      const idle = (
        outcome: PromptOutcome,
        log: string,
        settled = false,
        requested = state.requested,
      ) => ({
        value: {
          outcome,
          kept: state.kept,
          keptCount: outcome === 'awaiting_review' ? state.kept.length : 0,
          added: 0,
          requested,
          settled,
          discarded: {},
        } satisfies ValidateSummary,
        log,
        counts: { kept: outcome === 'awaiting_review' ? state.kept.length : 0 },
      });

      if (state.drafts.length === 0 && round === 0) {
        const task = await deps.graph.loadTask(state.taskId);
        if (task && task.questions > 0) {
          const stored = `${task.questions} drafts already stored`;
          const resumed = idle('awaiting_review', stored, true);
          return {
            ...resumed,
            value: { ...resumed.value, keptCount: task.questions },
            counts: { kept: task.questions },
          };
        }
        const { brief } = await readPromptSource(deps, state, 'validate');
        return idle('nothing_usable', 'No drafts to check', false, brief.sentences);
      }

      const { title, brief, outline } = await readPromptSource(deps, state, 'validate');
      if (!outline) {
        throw new CuratorStepError('validate', 'INCONSISTENT_STATE', 'The outline is missing');
      }
      const requested = brief.sentences;
      const allowedSlugs = new Set(viewOutline(outline).concepts.map((c) => c.slug));

      const kept: KeptDraft[] = [...state.kept];
      const seen = new Set<string>(kept.map((k) => k.id));
      const discarded: Record<string, number> = {};
      const discard = (code: DraftViolationCode | 'over_limit' | 'duplicate') => {
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
        // Top-up rounds only: the first pass keeps the planner's distinct facts as they are.
        if (round > 0 && kept.some((k) => isNearDuplicate(k.sentence, draft.sentence))) {
          discard('duplicate');
          continue;
        }
        if (kept.length >= requested) {
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
          written: false,
        });
      }
      const added = kept.length - state.kept.length;

      const discardedTotal = Object.values(discarded).reduce((a, b) => a + b, 0);
      const reasons = Object.entries(discarded)
        .map(([code, n]) => `${code} ${n}`)
        .join(', ');
      const discardNote = discardedTotal > 0 ? `${discardedTotal} discarded (${reasons})` : '';
      const asked = Math.max(0, requested - state.kept.length);
      // The edge after this node tops up again unless one of the stops of reconciliation N holds.
      const final =
        kept.length >= requested || round >= MAX_TOPUP_ROUNDS || (round > 0 && added === 0);
      const shortNote =
        final && round > 0 && kept.length < requested
          ? `Short of requested: kept ${kept.length} of ${requested} after ${round} top-up round${round === 1 ? '' : 's'}`
          : '';
      const join = (...parts: string[]) => parts.filter((p) => p !== '').join('. ');

      const needed = Math.max(1, state.minQuestions);
      if (kept.length < needed) {
        return {
          value: {
            outcome: 'nothing_usable',
            kept,
            keptCount: 0,
            added,
            requested,
            settled: false,
            discarded,
          } satisfies ValidateSummary,
          log: join(
            prefix === ''
              ? `Only ${kept.length} usable drafts, ${needed} needed` +
                  (discardNote !== '' ? `: ${discardNote}` : '')
              : `${prefix}asked for ${asked}, kept ${added}` +
                  (discardNote !== '' ? `, ${discardNote}` : ''),
            prefix !== '' ? `Only ${kept.length} usable drafts, ${needed} needed` : '',
            shortNote,
          ),
          counts: { kept: 0, discarded: discardedTotal },
        };
      }

      const puzzleId = puzzleIdForSource(state.sourceId);
      const pending = kept.filter((k) => !k.written);
      if (pending.length > 0) {
        // The puzzle is created with the first questions; a later round only adds to it.
        if (!kept.some((k) => k.written)) {
          await deps.graph.createDraftPuzzle({
            id: puzzleId,
            ownerId: state.ownerId,
            sourceId: state.sourceId,
            taskId: state.taskId,
            name: title.slice(0, 200),
            origin: 'prompt',
            now: deps.now(),
          });
        }
        let written = 0;
        for (const batch of batches(pending, WRITE_BATCH_QUESTIONS)) {
          written += await deps.graph.createGeneratedQuestions(
            puzzleId,
            state.taskId,
            state.sourceId,
            batch.map(({ written: _written, ...question }) => question),
            deps.now(),
          );
        }
        if (written !== pending.length) {
          throw new CuratorStepError(
            'validate',
            'INCONSISTENT_STATE',
            `Wrote ${written} of ${pending.length} drafts`,
          );
        }
      }
      const stored = kept.map((k) => ({ ...k, written: true }));
      return {
        value: {
          outcome: 'awaiting_review',
          kept: stored,
          keptCount: stored.length,
          added,
          requested,
          settled: false,
          discarded,
        } satisfies ValidateSummary,
        log: join(
          prefix === ''
            ? `${kept.length} drafts kept` + (discardNote !== '' ? `, ${discardNote}` : '')
            : `${prefix}asked for ${asked}, kept ${added}` +
                (discardNote !== '' ? `, ${discardNote}` : ''),
          shortNote,
        ),
        counts: { kept: kept.length, discarded: discardedTotal },
      };
    },
    round,
  );
  const discarded = { ...state.counts.discarded };
  for (const [code, n] of Object.entries(summary.discarded)) {
    discarded[code] = (discarded[code] ?? 0) + n;
  }
  return {
    outcome: summary.outcome,
    kept: summary.kept,
    requested: summary.requested,
    settled: summary.settled,
    lastAdded: summary.added,
    counts: {
      ...state.counts,
      kept: summary.keptCount,
      discarded,
    },
  };
};
