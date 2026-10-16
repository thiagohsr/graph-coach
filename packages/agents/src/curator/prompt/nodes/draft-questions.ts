import { CuratorStepError } from '../../ports';
import { callStructured } from '../../structured';
import { withStep } from '../../steps';
import { viewOutline } from '../outline-view';
import { buildWriterPrompt } from '../prompts';
import { PromptDrafts } from '../schemas';
import { promptRunOf, readPromptSource, type PromptDraft, type PromptNodeFactory } from '../state';

/**
 * Writer (one model call), from the stored outline only: one draft per planned sentence. The drafts stay in memory
 * (`state.drafts`); nothing is written here. When the task already produced questions (a re-run after a crash) no call
 * is made.
 */
export const draftQuestionsNode: PromptNodeFactory = (deps) => async (state) => {
  const drafts = await withStep<PromptDraft[]>(
    deps,
    promptRunOf(state),
    'draftQuestions',
    async (ctx) => {
      const task = await deps.graph.loadTask(state.taskId);
      if (task && task.questions > 0) {
        return { value: [], log: 'Drafts already stored', counts: { drafts: 0, planned: 0 } };
      }
      const { brief, outline } = await readPromptSource(deps, state, 'draftQuestions');
      if (!outline) {
        throw new CuratorStepError(
          'draftQuestions',
          'INCONSISTENT_STATE',
          'The outline is missing',
        );
      }
      const view = viewOutline(outline);
      const prompt = buildWriterPrompt({
        difficulty: brief.difficulty,
        concepts: view.concepts,
        sentences: view.sentences,
      });
      const answer = await callStructured(deps, ctx, {
        node: 'draftQuestions',
        label: 'curator.prompt.write',
        schema: PromptDrafts,
        ...prompt,
      });

      const planned = new Map(view.sentences.map((s) => [s.index, s]));
      const known = new Set(view.concepts.map((c) => c.slug));
      const seen = new Set<number>();
      const value: PromptDraft[] = [];
      for (const draft of answer.drafts) {
        const plan = planned.get(draft.index);
        if (!plan || seen.has(draft.index)) continue;
        seen.add(draft.index);
        value.push({
          index: draft.index,
          sentence: draft.sentence,
          answers: draft.answers,
          distractors: draft.distractors,
          // The plan names the concept; a slug the writer made up is replaced by it.
          conceptSlug: known.has(draft.conceptSlug) ? draft.conceptSlug : plan.conceptSlug,
          rewritten: false,
        });
      }
      value.sort((a, b) => a.index - b.index);
      return {
        value,
        log: `${value.length} drafts for ${view.sentences.length} planned sentences`,
        counts: { drafts: value.length, planned: view.sentences.length },
      };
    },
  );
  return { drafts };
};
