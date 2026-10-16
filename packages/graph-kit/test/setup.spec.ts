import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GraphKitError } from '../src/errors';
import { describeSchema, dropGraph, setupGraph } from '../src/setup';
import { createTestGraph, type TestGraph } from '../src/testing/harness';

let tg: TestGraph;

beforeAll(async () => {
  tg = await createTestGraph({ setup: false });
});
afterAll(async () => {
  await tg?.dispose();
});

describe('setupGraph', () => {
  it('creates 17 range indexes, 2 uniqueness constraints and 1 vector index, then nothing the second time', async () => {
    const first = await setupGraph(tg.graph, { embeddingDim: 64 });
    expect(first.created.filter((i) => i.kind === 'range')).toHaveLength(17);
    expect(first.created.filter((i) => i.kind === 'unique')).toHaveLength(2);
    expect(first.created.filter((i) => i.kind === 'vector')).toHaveLength(1);
    expect(first.skipped).toEqual([]);
    expect(first.vectorIndex).toMatchObject({
      dimension: 64,
      rebuilt: false,
      chunksWithEmbedding: 0,
    });

    const schemaAfterFirst = await describeSchema(tg.graph);
    const second = await setupGraph(tg.graph, { embeddingDim: 64 });
    expect(second.created).toEqual([]);
    expect(second.existing).toHaveLength(20);
    expect(await describeSchema(tg.graph)).toEqual(schemaAfterFirst);
  });

  it('describes what exists, including the vector dimension', async () => {
    const schema = await describeSchema(tg.graph);
    expect(schema.vectorDimension).toBe(64);
    expect(schema.items).toContainEqual({ kind: 'unique', label: 'Learner', property: 'id' });
    expect(schema.items).toContainEqual({ kind: 'unique', label: 'Concept', property: 'slug' });
    expect(schema.items).toContainEqual({ kind: 'range', label: 'Agent', property: 'name' });
    expect(schema.items).toContainEqual({ kind: 'vector', label: 'Chunk', property: 'embedding' });
  });

  it('refuses two Concept nodes with the same slug with CONSTRAINT_VIOLATION', async () => {
    await tg.cypher("CREATE (:Concept {id: 'c1', slug: 'same'})");
    const error = await tg
      .cypher("CREATE (:Concept {id: 'c2', slug: 'same'})")
      .then(() => undefined)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GraphKitError);
    expect((error as GraphKitError).code).toBe('CONSTRAINT_VIOLATION');
  });

  it('recreates the vector index with another dimension only when asked', async () => {
    const kept = await setupGraph(tg.graph, { embeddingDim: 32 });
    expect(kept.vectorIndex.rebuilt).toBe(false);
    expect(kept.vectorIndex.dimension).toBe(64);
    expect((await describeSchema(tg.graph)).vectorDimension).toBe(64);

    const rebuilt = await setupGraph(tg.graph, { embeddingDim: 128, rebuildVector: true });
    expect(rebuilt.vectorIndex).toMatchObject({ dimension: 128, rebuilt: true });
    expect((await describeSchema(tg.graph)).vectorDimension).toBe(128);
  });

  it('rejects a dimension that is not a positive integer', async () => {
    await expect(setupGraph(tg.graph, { embeddingDim: 0 })).rejects.toBeInstanceOf(GraphKitError);
  });

  it('dropGraph removes the graph', async () => {
    const scratch = await createTestGraph({ setup: false });
    try {
      await scratch.cypher("CREATE (:Concept {id: 'x', slug: 'x'})");
      expect(await scratch.graph.listGraphs()).toContain(scratch.name);
      await dropGraph(scratch.graph);
      expect(await scratch.graph.listGraphs()).not.toContain(scratch.name);
    } finally {
      await scratch.graph.close();
    }
  });
});
