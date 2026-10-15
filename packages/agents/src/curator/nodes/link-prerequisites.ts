import { MIN_LINK_CONFIDENCE } from '../constants';
import { CuratorStepError, type ChunkConcept } from '../ports';
import { buildLinkPrerequisitesPrompt } from '../prompts';
import { PrerequisiteLinks } from '../schemas';
import { callStructured } from '../structured';
import { withStep } from '../steps';
import { requireSourceId, runOf, type NodeFactory } from './common';

const MAX_CONCEPTS_IN_PROMPT = 60;

/** One model call over the source's concepts; each proposed link goes through the cycle check and is then merged. */
export const linkPrerequisitesNode: NodeFactory = (deps) => async (state) => {
  const sourceId = requireSourceId(state, 'linkPrerequisites');
  const linked = await withStep(deps, runOf(state), 'linkPrerequisites', async (ctx) => {
    const read = await deps.graph.sourceChunks(sourceId);
    if (!read)
      throw new CuratorStepError(
        'linkPrerequisites',
        'INCONSISTENT_STATE',
        'The source is missing',
      );

    const bySlug = new Map<string, ChunkConcept>();
    for (const chunk of read.chunks)
      for (const concept of chunk.concepts)
        if (!bySlug.has(concept.slug)) bySlug.set(concept.slug, concept);
    const concepts = [...bySlug.values()].slice(0, MAX_CONCEPTS_IN_PROMPT);

    if (concepts.length < 2)
      return { value: 0, log: 'No links to add', counts: { linked: 0, refused: 0 } };

    const prompt = buildLinkPrerequisitesPrompt({
      concepts: concepts.map((c) => ({ slug: c.slug, name: c.name, description: c.description })),
    });
    const answer = await callStructured(deps, ctx, {
      node: 'linkPrerequisites',
      label: 'curator.linkPrerequisites',
      schema: PrerequisiteLinks,
      ...prompt,
    });

    const slugs = new Set(concepts.map((c) => c.slug));
    const proposals = answer.links
      .filter(
        (link) =>
          slugs.has(link.prerequisite) &&
          slugs.has(link.dependent) &&
          link.prerequisite !== link.dependent &&
          link.confidence >= MIN_LINK_CONFIDENCE,
      )
      .sort(
        (a, b) =>
          b.confidence - a.confidence ||
          a.prerequisite.localeCompare(b.prerequisite) ||
          a.dependent.localeCompare(b.dependent),
      );

    let linkedCount = 0;
    let refused = 0;
    for (const link of proposals) {
      if (await deps.graph.wouldCreateCycle(link.prerequisite, link.dependent)) {
        refused += 1;
        continue;
      }
      if (await deps.graph.linkPrerequisite(link.prerequisite, link.dependent, link.confidence))
        linkedCount += 1;
      else refused += 1;
    }

    const log =
      linkedCount === 0 && refused === 0
        ? 'No links to add'
        : `${linkedCount} linked, ${refused} refused`;
    return { value: linkedCount, log, counts: { linked: linkedCount, refused } };
  });
  return { counts: { ...state.counts, links: linked } };
};
