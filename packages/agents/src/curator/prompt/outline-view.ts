import { slugify } from '../slug';
import type { OutlineConcept, PlannedSentence } from './prompts';
import type { Outline } from './schemas';

export interface OutlineView {
  concepts: OutlineConcept[];
  sentences: PlannedSentence[];
  criteria: string[];
  nameOf(slug: string): string;
}

/** The stored outline with slugs, as the writer, the critic, and `validate` read it. */
export function viewOutline(outline: Outline): OutlineView {
  const concepts: OutlineConcept[] = outline.concepts.map((c) => ({
    slug: slugify(c.name),
    name: c.name,
    description: c.description,
  }));
  const slugOf = (name: string): string =>
    concepts.find((c) => c.name === name)?.slug ?? slugify(name);
  return {
    concepts,
    sentences: outline.sentences.map((s, index) => ({
      index,
      conceptSlug: slugOf(s.concept),
      fact: s.fact,
    })),
    criteria: outline.criteria,
    nameOf: (slug) => concepts.find((c) => c.slug === slug)?.name ?? slug,
  };
}
