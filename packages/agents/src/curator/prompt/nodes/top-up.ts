import { CuratorStepError } from '../../ports';
import { callStructured } from '../../structured';
import { withStep } from '../../steps';
import { viewOutline } from '../outline-view';
import { buildTopUpPrompt, type TopUpSlot } from '../prompts';
import { PromptDrafts } from '../schemas';
import { promptRunOf, readPromptSource, type PromptDraft, type PromptNodeFactory } from '../state';

/** New-fact slots of round n start at this index plus the planned count, so they never meet a planned index. */
const NEW_SLOT_STRIDE = 100;

/**
 * Writer for a top-up round (reconciliation N): one model call, asking for only the shortfall. Planned facts the writer
 * has not drafted yet come first; when there are none left it asks for new facts on the outline's concepts. The sentences
 * already kept are passed as "do not repeat". The new drafts replace `state.drafts`; nothing is written. The step is
 * recorded as round `state.round + 1`, with its own step id.
 */
export const topUpNode: PromptNodeFactory = (deps) => async (state) => {
  const round = state.round + 1;
  const shortfall = Math.max(0, state.requested - state.kept.length);
  const result = await withStep(
    deps,
    promptRunOf(state),
    'topUp',
    async (ctx) => {
      const { brief, outline } = await readPromptSource(deps, state, 'topUp');
      if (!outline) {
        throw new CuratorStepError('topUp', 'INCONSISTENT_STATE', 'The outline is missing');
      }
      const view = viewOutline(outline);
      const tried = new Set(state.tried);
      const unused = view.sentences.filter((s) => !tried.has(s.index)).slice(0, shortfall);
      const newSlots: TopUpSlot[] = [];
      const missing = shortfall - unused.length;
      for (let k = 0; k < missing && view.concepts.length > 0; k += 1) {
        newSlots.push({
          index: view.sentences.length + NEW_SLOT_STRIDE * round + k,
          conceptSlug: view.concepts[k % view.concepts.length]!.slug,
        });
      }

      const prompt = buildTopUpPrompt({
        difficulty: brief.difficulty,
        concepts: view.concepts,
        sentences: unused,
        newSlots,
        kept: state.kept.map((k) => k.sentence),
      });
      const answer = await callStructured(deps, ctx, {
        node: 'topUp',
        label: 'curator.prompt.topup',
        schema: PromptDrafts,
        ...prompt,
      });

      const slots = new Map<number, string>([
        ...unused.map((s) => [s.index, s.conceptSlug] as const),
        ...newSlots.map((s) => [s.index, s.conceptSlug] as const),
      ]);
      const known = new Set(view.concepts.map((c) => c.slug));
      const seen = new Set<number>();
      const drafts: PromptDraft[] = [];
      for (const draft of answer.drafts) {
        const slug = slots.get(draft.index);
        if (slug === undefined || seen.has(draft.index)) continue;
        seen.add(draft.index);
        drafts.push({
          index: draft.index,
          sentence: draft.sentence,
          answers: draft.answers,
          distractors: draft.distractors,
          conceptSlug: known.has(draft.conceptSlug) ? draft.conceptSlug : slug,
          rewritten: false,
        });
      }
      drafts.sort((a, b) => a.index - b.index);
      const parts = [
        unused.length > 0 ? `${unused.length} planned fact${unused.length === 1 ? '' : 's'}` : '',
        newSlots.length > 0 ? `${newSlots.length} new` : '',
      ].filter((p) => p !== '');
      return {
        value: { drafts, asked: unused.map((s) => s.index) },
        log: `Round ${round}: asking for ${shortfall} (${parts.join(', ') || 'no slot'}), ${drafts.length} drafted`,
        counts: { round, asked: shortfall, drafted: drafts.length },
      };
    },
    round,
  );
  return {
    drafts: result.drafts,
    round,
    tried: [...state.tried, ...result.asked],
  };
};
