import { validateDraft, type DraftViolationCode } from '@coach/types';
import { WRITE_BATCH_QUESTIONS } from '../constants';
import { puzzleIdForSource, questionId } from '../ids';
import { batches } from '../pool';
import { CuratorStepError, type QuestionWrite } from '../ports';
import type { CuratorOutcome } from '../state';
import { withStep } from '../steps';
import { requireSourceId, runOf, type NodeFactory } from './common';

interface ValidateSummary {
  outcome: CuratorOutcome;
  kept: number;
  discarded: Record<string, number>;
}

/**
 * Checks every draft with the shared validator. Drafts that break a rule are discarded and counted by code; the rest
 * are written as `draft` questions of a draft private puzzle. Nothing invalid is ever stored.
 */
export const validateNode: NodeFactory = (deps) => async (state) => {
  const sourceId = requireSourceId(state, 'validate');
  const summary = await withStep(deps, runOf(state), 'validate', async () => {
    const empty = (outcome: CuratorOutcome, kept: number, log: string) => ({
      value: { outcome, kept, discarded: {} } satisfies ValidateSummary,
      log,
      counts: { kept },
    });

    if (state.candidates.length === 0) {
      const task = await deps.graph.loadTask(state.taskId);
      if (task && task.questions > 0) {
        return empty('awaiting_review', task.questions, `${task.questions} drafts already stored`);
      }
      return empty('nothing_usable', 0, 'No drafts to check');
    }

    const read = await deps.graph.sourceChunks(sourceId);
    if (!read)
      throw new CuratorStepError('validate', 'INCONSISTENT_STATE', 'The source is missing');
    const chunks = new Map(read.chunks.map((chunk) => [chunk.id, chunk]));

    const kept: QuestionWrite[] = [];
    const seen = new Set<string>();
    const discarded: Record<string, number> = {};
    const discard = (code: DraftViolationCode) => {
      discarded[code] = (discarded[code] ?? 0) + 1;
    };

    for (const candidate of state.candidates) {
      const chunk = chunks.get(candidate.chunkId);
      if (!chunk) {
        discard('no_concept');
        continue;
      }
      const id = questionId(candidate.chunkId, candidate.sentence, candidate.answers);
      const result = validateDraft(candidate, {
        chunkText: chunk.text,
        allowedSlugs: new Set(chunk.concepts.map((c) => c.slug)),
        seenIds: seen,
        id,
      });
      if (!result.ok) {
        for (const violation of result.violations) discard(violation.code);
        continue;
      }
      seen.add(id);
      kept.push({
        id,
        sentence: candidate.sentence,
        answers: candidate.answers,
        distractors: candidate.distractors,
        order: kept.length + 1,
        chunkId: candidate.chunkId,
        conceptSlugs: result.conceptSlugs,
      });
    }

    const discardedTotal = Object.values(discarded).reduce((a, b) => a + b, 0);
    const reasons = Object.entries(discarded)
      .map(([code, n]) => `${code} ${n}`)
      .join(', ');

    if (kept.length === 0) {
      return {
        value: { outcome: 'nothing_usable', kept: 0, discarded } satisfies ValidateSummary,
        log: `No usable drafts: ${discardedTotal} discarded (${reasons})`,
        counts: { kept: 0, discarded: discardedTotal },
      };
    }

    await deps.graph.createDraftPuzzle({
      id: puzzleIdForSource(sourceId),
      ownerId: state.ownerId,
      sourceId,
      taskId: state.taskId,
      name: read.source.title.slice(0, 200),
      origin: 'upload',
      now: deps.now(),
    });
    let written = 0;
    for (const batch of batches(kept, WRITE_BATCH_QUESTIONS)) {
      written += await deps.graph.createDraftQuestions(
        puzzleIdForSource(sourceId),
        state.taskId,
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
