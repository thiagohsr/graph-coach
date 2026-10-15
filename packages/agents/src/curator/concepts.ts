// Concept reconciliation (plan §4): the same idea named differently becomes one concept; nothing existing is renamed.
import { MAX_CONCEPT_DESCRIPTION_CHARS } from './constants';
import { conceptId } from './ids';
import type { KnownConcept } from './ports';
import type { ExtractedConcept } from './schemas';
import { isProbableDuplicate, slugify } from './slug';

export interface ReconciledConcept {
  id: string;
  slug: string;
  name: string;
  description: string;
  chunkIds: string[];
  /** True when the concept was already known (so the run matched it rather than creating it). */
  known: boolean;
}

export interface ReconcileResult {
  concepts: ReconciledConcept[];
  /** Each name that ended up under a different slug than its own: `"name" → slug`. */
  merged: Array<{ name: string; into: string }>;
}

/**
 * Matching order for each extracted item: (1) `existingSlug`, only when it is in the known list; (2) the item's own
 * slug, when the run or the known list already holds it; (3) a probable duplicate among the known concepts and the
 * concepts of this run; otherwise a new concept. Order of first appearance is kept, so the result is deterministic.
 */
export function reconcileConcepts(input: {
  perChunk: Array<{ chunkId: string; concepts: ExtractedConcept[] }>;
  known: KnownConcept[];
}): ReconcileResult {
  const known = new Map<string, KnownConcept>();
  for (const concept of input.known) if (!known.has(concept.slug)) known.set(concept.slug, concept);

  const byIndex = new Map<string, ReconciledConcept>();
  const merged: ReconcileResult['merged'] = [];

  const entryFor = (
    slug: string,
    fallback: { name: string; description: string },
  ): ReconciledConcept => {
    let entry = byIndex.get(slug);
    if (!entry) {
      const existing = known.get(slug);
      entry = {
        id: existing?.conceptId ?? conceptId(slug),
        slug,
        name: existing?.name ?? fallback.name,
        description: (existing?.description ?? fallback.description).slice(
          0,
          MAX_CONCEPT_DESCRIPTION_CHARS,
        ),
        chunkIds: [],
        known: existing !== undefined,
      };
      byIndex.set(slug, entry);
    }
    return entry;
  };

  for (const { chunkId, concepts } of input.perChunk) {
    for (const item of concepts) {
      const ownSlug = slugify(item.name);
      if (ownSlug === '') continue;

      let target: string | undefined;
      if (item.existingSlug && known.has(item.existingSlug)) target = item.existingSlug;
      else if (known.has(ownSlug) || byIndex.has(ownSlug)) target = ownSlug;
      else {
        const candidates = [...known.keys(), ...byIndex.keys()];
        target = candidates.find((slug) => isProbableDuplicate(ownSlug, slug)) ?? ownSlug;
      }

      if (target !== ownSlug && !merged.some((m) => m.name === item.name && m.into === target)) {
        merged.push({ name: item.name, into: target });
      }
      const entry = entryFor(target, { name: item.name, description: item.description });
      if (!entry.chunkIds.includes(chunkId)) entry.chunkIds.push(chunkId);
    }
  }

  return { concepts: [...byIndex.values()], merged };
}
