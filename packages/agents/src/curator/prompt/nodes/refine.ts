import { PROMPT_MAX_REWRITE_PASSES } from '../../constants';
import { CuratorStepError } from '../../ports';
import { callStructured } from '../../structured';
import { withStep } from '../../steps';
import { viewOutline } from '../outline-view';
import { buildRewritePrompt } from '../prompts';
import { PromptDrafts } from '../schemas';
import {
  promptRunOf,
  readPromptSource,
  roundPrefix,
  type PromptDraft,
  type PromptNodeFactory,
} from '../state';
import { judge } from './judge';

/**
 * Writer again for the drafts the critic sent back, then the critic judges the rewrites. A rewrite that does not pass is
 * dropped (FR-U33: one pass only). With nothing to rewrite it makes no call and still completes, saying so.
 */
export const refineNode: PromptNodeFactory = (deps) => async (state) => {
  const summary = await withStep(
    deps,
    promptRunOf(state),
    'refine',
    async (ctx) => {
      const toRewrite = state.drafts.filter((d) => d.verdict === 'rewrite');
      if (toRewrite.length === 0 || PROMPT_MAX_REWRITE_PASSES < 1) {
        return {
          value: { drafts: state.drafts, rewritten: 0, dropped: 0 },
          log: `${roundPrefix(state.round)}Nothing to rewrite`,
          counts: { sentBack: 0, rewritten: 0, dropped: 0 },
        };
      }
      const { brief, outline } = await readPromptSource(deps, state, 'refine');
      if (!outline) {
        throw new CuratorStepError('refine', 'INCONSISTENT_STATE', 'The outline is missing');
      }
      const view = viewOutline(outline);
      const indexes = new Set(toRewrite.map((d) => d.index));

      const prompt = buildRewritePrompt({
        difficulty: brief.difficulty,
        concepts: view.concepts,
        sentences: view.sentences.filter((s) => indexes.has(s.index)),
        drafts: toRewrite.map((d) => ({
          index: d.index,
          sentence: d.sentence,
          answers: d.answers,
          distractors: d.distractors,
          concept: view.nameOf(d.conceptSlug),
          note: d.note ?? '',
        })),
      });
      const answer = await callStructured(deps, ctx, {
        node: 'refine',
        label: 'curator.prompt.rewrite',
        schema: PromptDrafts,
        ...prompt,
      });

      // Only the indexes that were sent back count; the first rewrite of an index wins.
      const known = new Set(view.concepts.map((c) => c.slug));
      const rewrites = new Map<number, PromptDraft>();
      for (const draft of answer.drafts) {
        const original = toRewrite.find((d) => d.index === draft.index);
        if (!original || rewrites.has(draft.index)) continue;
        rewrites.set(draft.index, {
          index: draft.index,
          sentence: draft.sentence,
          answers: draft.answers,
          distractors: draft.distractors,
          conceptSlug: known.has(draft.conceptSlug) ? draft.conceptSlug : original.conceptSlug,
          rewritten: true,
        });
      }

      let judged = new Map<number, { verdict: string; note: string }>();
      if (rewrites.size > 0) {
        judged = await judge(deps, ctx, {
          node: 'refine',
          label: 'curator.prompt.recritique',
          brief,
          view,
          drafts: [...rewrites.values()],
        });
      }

      const next: PromptDraft[] = [];
      let rewritten = 0;
      let dropped = 0;
      for (const draft of state.drafts) {
        if (draft.verdict !== 'rewrite') {
          next.push(draft);
          continue;
        }
        const replacement = rewrites.get(draft.index);
        const review = judged.get(draft.index);
        if (replacement && review?.verdict === 'pass') {
          next.push({ ...replacement, verdict: 'pass', note: review.note });
          rewritten += 1;
        } else {
          dropped += 1;
        }
      }
      return {
        value: { drafts: next, rewritten, dropped },
        log: `${roundPrefix(state.round)}${toRewrite.length} sent back: ${rewritten} rewritten and passed, ${dropped} dropped`,
        counts: { sentBack: toRewrite.length, rewritten, dropped },
      };
    },
    state.round,
  );
  return {
    drafts: summary.drafts,
    counts: {
      ...state.counts,
      rewritten: state.counts.rewritten + summary.rewritten,
      dropped: state.counts.dropped + summary.dropped,
    },
  };
};
