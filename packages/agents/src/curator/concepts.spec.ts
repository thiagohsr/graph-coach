import { describe, expect, it } from 'vitest';
import { reconcileConcepts } from './concepts';
import { conceptId } from './ids';
import type { KnownConcept } from './ports';

const concept = (name: string, existingSlug: string | null = null) => ({
  name,
  description: `${name} is described here in a sentence.`,
  existingSlug,
});

const known = (slug: string, name = slug): KnownConcept => ({
  conceptId: `id-${slug}`,
  slug,
  name,
  description: `Known concept ${name}.`,
});

describe('reconcileConcepts', () => {
  it('merges the same idea named differently in two chunks into one concept with both chunk ids', () => {
    const result = reconcileConcepts({
      perChunk: [
        { chunkId: 'c1', concepts: [concept('B-tree index')] },
        { chunkId: 'c2', concepts: [concept('B-tree indexes')] },
      ],
      known: [],
    });
    expect(result.concepts).toHaveLength(1);
    expect(result.concepts[0]).toMatchObject({
      slug: 'b-tree-index',
      chunkIds: ['c1', 'c2'],
      known: false,
    });
    expect(result.merged).toEqual([{ name: 'B-tree indexes', into: 'b-tree-index' }]);
  });

  it('gives a new concept the deterministic id of its slug', () => {
    const { concepts } = reconcileConcepts({
      perChunk: [{ chunkId: 'c1', concepts: [concept('Buffer pool')] }],
      known: [],
    });
    expect(concepts[0]!.id).toBe(conceptId('buffer-pool'));
  });

  it('honours existingSlug when it is in the known list and keeps the known concept as it is', () => {
    const result = reconcileConcepts({
      perChunk: [{ chunkId: 'c1', concepts: [concept('Search trees', 'b-tree')] }],
      known: [known('b-tree', 'B-tree')],
    });
    expect(result.concepts).toEqual([
      expect.objectContaining({
        slug: 'b-tree',
        name: 'B-tree',
        id: 'id-b-tree',
        known: true,
        chunkIds: ['c1'],
      }),
    ]);
    expect(result.merged).toEqual([{ name: 'Search trees', into: 'b-tree' }]);
  });

  it('ignores existingSlug when it is not in the known list', () => {
    const result = reconcileConcepts({
      perChunk: [{ chunkId: 'c1', concepts: [concept('Hash index', 'made-up-slug')] }],
      known: [known('b-tree')],
    });
    expect(result.concepts.map((c) => c.slug)).toEqual(['hash-index']);
    expect(result.merged).toEqual([]);
  });

  it('matches a known concept by its own slug without reporting a merge', () => {
    const result = reconcileConcepts({
      perChunk: [{ chunkId: 'c1', concepts: [concept('B-tree')] }],
      known: [known('b-tree', 'B-tree')],
    });
    expect(result.concepts[0]).toMatchObject({ slug: 'b-tree', known: true });
    expect(result.merged).toEqual([]);
  });

  it('merges a probable duplicate of a known concept into it', () => {
    const result = reconcileConcepts({
      perChunk: [{ chunkId: 'c1', concepts: [concept('Foreign keys')] }],
      known: [known('foreign-key', 'Foreign key')],
    });
    expect(result.concepts).toHaveLength(1);
    expect(result.concepts[0]).toMatchObject({ slug: 'foreign-key', known: true });
    expect(result.merged).toEqual([{ name: 'Foreign keys', into: 'foreign-key' }]);
  });

  it('drops a concept whose name has no usable characters', () => {
    const result = reconcileConcepts({
      perChunk: [{ chunkId: 'c1', concepts: [concept('???')] }],
      known: [],
    });
    expect(result.concepts).toEqual([]);
  });

  it('cuts long descriptions and lists a chunk id once', () => {
    const long = { name: 'Long one', description: 'x'.repeat(500), existingSlug: null };
    const result = reconcileConcepts({
      perChunk: [{ chunkId: 'c1', concepts: [long, long] }],
      known: [],
    });
    expect(result.concepts[0]!.description.length).toBeLessThanOrEqual(200);
    expect(result.concepts[0]!.chunkIds).toEqual(['c1']);
  });

  it('is deterministic and keeps the order of first appearance', () => {
    const input = {
      perChunk: [
        { chunkId: 'c1', concepts: [concept('Zebra'), concept('Apple')] },
        { chunkId: 'c2', concepts: [concept('Mango')] },
      ],
      known: [],
    };
    const a = reconcileConcepts(input);
    expect(a.concepts.map((c) => c.slug)).toEqual(['zebra', 'apple', 'mango']);
    expect(reconcileConcepts(input)).toEqual(a);
  });
});
