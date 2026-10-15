import type { PromptBrief } from '@coach/types';
import type { CuratorDeps, StepContext } from '../../ports';
import { callStructured } from '../../structured';
import type { StepName } from '../../steps';
import type { OutlineView } from '../outline-view';
import { buildCriticPrompt } from '../prompts';
import { critiquesFor, type Verdict } from '../schemas';
import type { PromptDraft } from '../state';

export interface Judgement {
  verdict: Verdict;
  note: string;
}

/**
 * One critic call over the given drafts. Every draft must come back with exactly one review (the schema enforces it, so
 * a miss is retried by the provider and then fails the step as INVALID_MODEL_OUTPUT). The critic sees the brief, the
 * outline, the criteria, and each draft's sentence, answers, distractors, and concept: nothing the writer produced besides.
 */
export async function judge(
  deps: Pick<CuratorDeps, 'chat'>,
  ctx: Pick<StepContext, 'meter' | 'trace'>,
  input: {
    node: StepName;
    label: string;
    brief: PromptBrief;
    view: OutlineView;
    drafts: PromptDraft[];
  },
): Promise<Map<number, Judgement>> {
  const prompt = buildCriticPrompt({
    brief: input.brief,
    concepts: input.view.concepts,
    sentences: input.view.sentences,
    criteria: input.view.criteria,
    drafts: input.drafts.map((d) => ({
      index: d.index,
      sentence: d.sentence,
      answers: d.answers,
      distractors: d.distractors,
      concept: input.view.nameOf(d.conceptSlug),
    })),
  });
  const answer = await callStructured(deps, ctx, {
    node: input.node,
    label: input.label,
    schema: critiquesFor(input.drafts.map((d) => d.index)),
    ...prompt,
  });
  return new Map(answer.reviews.map((r) => [r.index, { verdict: r.verdict, note: r.note }]));
}
