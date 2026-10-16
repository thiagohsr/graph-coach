import { CuratorStepError } from '../../ports';
import { withStep } from '../../steps';
import { viewOutline } from '../outline-view';
import { promptRunOf, readPromptSource, type PromptDraft, type PromptNodeFactory } from '../state';
import { judge } from './judge';

/**
 * Critic (one call for all drafts). `reject` drafts are dropped and counted; `pass` and `rewrite` drafts carry the
 * critic's note forward. With no draft in memory (a re-run after the drafts were already stored) it makes no call.
 */
export const critiqueNode: PromptNodeFactory = (deps) => async (state) => {
  const summary = await withStep(deps, promptRunOf(state), 'critique', async (ctx) => {
    if (state.drafts.length === 0) {
      return {
        value: { drafts: [] as PromptDraft[], dropped: 0, passed: 0 },
        log: 'No drafts to review',
        counts: { reviewed: 0, passed: 0, rewrite: 0, rejected: 0 },
      };
    }
    const { brief, outline } = await readPromptSource(deps, state, 'critique');
    if (!outline) {
      throw new CuratorStepError('critique', 'INCONSISTENT_STATE', 'The outline is missing');
    }
    const judged = await judge(deps, ctx, {
      node: 'critique',
      label: 'curator.prompt.critique',
      brief,
      view: viewOutline(outline),
      drafts: state.drafts,
    });

    const kept: PromptDraft[] = [];
    let passed = 0;
    let rewrite = 0;
    let rejected = 0;
    for (const draft of state.drafts) {
      const review = judged.get(draft.index);
      if (!review || review.verdict === 'reject') {
        rejected += 1;
        continue;
      }
      if (review.verdict === 'pass') passed += 1;
      else rewrite += 1;
      kept.push({ ...draft, verdict: review.verdict, note: review.note });
    }
    return {
      value: { drafts: kept, dropped: rejected, passed },
      log: `${state.drafts.length} reviewed: ${passed} passed, ${rewrite} to rewrite, ${rejected} rejected`,
      counts: { reviewed: state.drafts.length, passed, rewrite, rejected },
    };
  });
  return {
    drafts: summary.drafts,
    counts: {
      ...state.counts,
      passed: summary.passed,
      dropped: state.counts.dropped + summary.dropped,
    },
  };
};
