import {
  MAX_CONCEPT_DESCRIPTION_CHARS,
  PROMPT_EXTRA_SENTENCES,
  PROMPT_MIN_LINK_CONFIDENCE,
} from '../../constants';
import { conceptId } from '../../ids';
import { slugify } from '../../slug';
import { callStructured } from '../../structured';
import { withStep } from '../../steps';
import { buildPlannerPrompt } from '../prompts';
import { Outline } from '../schemas';
import { promptRunOf, readPromptSource, type PromptNodeFactory } from '../state';

const MAX_PLANNED_SENTENCES = 12;

/**
 * Planner (one model call). Concepts are matched by slug only (no chunks, no vectors); planned sentences whose concept
 * is not in the planner's own list are dropped; prerequisite pairs are kept only between the planner's own concepts, at
 * the stricter confidence floor, and only when the cycle check allows them. The filtered outline is stored on the source.
 */
export const outlineNode: PromptNodeFactory = (deps) => async (state) => {
  const summary = await withStep(deps, promptRunOf(state), 'outline', async (ctx) => {
    const { brief } = await readPromptSource(deps, state, 'outline');
    const plan = Math.min(brief.sentences + PROMPT_EXTRA_SENTENCES, MAX_PLANNED_SENTENCES);
    const prompt = buildPlannerPrompt({ brief, plan });
    const planned = await callStructured(deps, ctx, {
      node: 'outline',
      label: 'curator.prompt.outline',
      schema: Outline,
      ...prompt,
    });

    // Concepts: slugify, drop empty slugs, keep the first of any slug.
    const bySlug = new Map<string, Outline['concepts'][number]>();
    const slugByName = new Map<string, string>();
    for (const concept of planned.concepts) {
      const slug = slugify(concept.name);
      if (slug === '') continue;
      slugByName.set(concept.name, slug);
      if (!bySlug.has(slug)) {
        bySlug.set(slug, {
          name: concept.name,
          description: concept.description.slice(0, MAX_CONCEPT_DESCRIPTION_CHARS),
        });
      }
    }
    const slugOf = (name: string): string | null => {
      const exact = slugByName.get(name);
      if (exact) return exact;
      const slug = slugify(name);
      return bySlug.has(slug) ? slug : null;
    };

    const sentences = planned.sentences
      .filter((s) => slugOf(s.concept) !== null)
      .slice(0, plan)
      .map((s) => ({ fact: s.fact, concept: bySlug.get(slugOf(s.concept)!)!.name }));
    const droppedSentences = Math.min(planned.sentences.length, plan) - sentences.length;

    const prerequisites = planned.prerequisites
      .map((p) => ({
        from: slugOf(p.prerequisite),
        to: slugOf(p.dependent),
        confidence: p.confidence,
      }))
      .filter(
        (p): p is { from: string; to: string; confidence: number } =>
          p.from !== null && p.to !== null && p.from !== p.to,
      );

    const outline: Outline = {
      concepts: [...bySlug.values()],
      sentences,
      criteria: planned.criteria,
      prerequisites: prerequisites.map((p) => ({
        prerequisite: bySlug.get(p.from)!.name,
        dependent: bySlug.get(p.to)!.name,
        confidence: p.confidence,
      })),
    };

    const written = await deps.graph.upsertConcepts(
      state.taskId,
      [...bySlug.entries()].map(([slug, concept]) => ({
        id: conceptId(slug),
        slug,
        name: concept.name,
        description: concept.description,
        chunkIds: [],
      })),
      deps.now(),
    );

    let linked = 0;
    let refused = 0;
    const proposals = prerequisites
      .filter((p) => p.confidence >= PROMPT_MIN_LINK_CONFIDENCE)
      .sort(
        (a, b) =>
          b.confidence - a.confidence || a.from.localeCompare(b.from) || a.to.localeCompare(b.to),
      );
    for (const link of proposals) {
      if (await deps.graph.wouldCreateCycle(link.from, link.to)) {
        refused += 1;
        continue;
      }
      if (await deps.graph.linkPrerequisite(link.from, link.to, link.confidence)) linked += 1;
      else refused += 1;
    }

    await deps.graph.saveOutline(state.sourceId, outline);

    const log =
      `${bySlug.size} concepts, ${sentences.length} sentences planned` +
      (droppedSentences > 0 ? `, ${droppedSentences} dropped` : '') +
      (linked + refused > 0 ? `, ${linked} linked, ${refused} refused` : '');
    return {
      value: { concepts: written.length, links: linked, planned: sentences.length },
      log,
      counts: { concepts: written.length, links: linked, planned: sentences.length },
    };
  });
  return {
    counts: {
      ...state.counts,
      concepts: summary.concepts,
      links: summary.links,
      planned: summary.planned,
    },
  };
};
