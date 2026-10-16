import { describe, expect, it } from 'vitest';
import { GraphKitError } from '../src/errors';
import { importGraph, type GraphFixture } from '../src/fixture';
import { useTestGraph } from '../src/testing/harness';

const graph = useTestGraph({ embeddingDim: 4 });

const base = (): GraphFixture => ({
  nodes: [
    { label: 'Concept', key: 'c1', props: { slug: 'one', name: 'One' } },
    { label: 'Concept', key: 'c2', props: { slug: 'two', name: 'Two' } },
    { label: 'Learner', key: 'l1', props: { displayName: 'L', createdAt: 1_760_000_000_000 } },
  ],
  edges: [
    {
      type: 'PREREQUISITE_OF',
      from: { label: 'Concept', key: 'c1' },
      to: { label: 'Concept', key: 'c2' },
      props: { confidence: 1 },
    },
  ],
});

describe('importGraph', () => {
  it('creates nodes and relationships once when the same fixture is imported twice', async () => {
    const tg = graph();
    await tg.clear();
    const first = await tg.load(base());
    expect(first).toMatchObject({ nodesCreated: 3, relationshipsCreated: 1 });
    const second = await tg.load(base());
    expect(second).toMatchObject({ nodesCreated: 0, relationshipsCreated: 0 });
    expect(await tg.count('Concept')).toBe(2);
    expect(await tg.countEdges('PREREQUISITE_OF')).toBe(1);
  });

  it("onMatch 'keep' leaves changed properties alone and 'update' overwrites them", async () => {
    const tg = graph();
    await tg.clear();
    await tg.load({
      nodes: [{ label: 'Concept', key: 'k1', props: { slug: 'k', name: 'Original' } }],
      edges: [],
    });
    await tg.cypher("MATCH (c:Concept {id: 'k1'}) SET c.name = 'Edited'");

    await tg.load({
      nodes: [
        { label: 'Concept', key: 'k1', props: { slug: 'k', name: 'Fixture' }, onMatch: 'keep' },
      ],
      edges: [],
    });
    expect(
      (await tg.cypher<{ n: string }>("MATCH (c:Concept {id: 'k1'}) RETURN c.name AS n"))[0]?.n,
    ).toBe('Edited');

    await tg.load({
      nodes: [{ label: 'Concept', key: 'k1', props: { slug: 'k', name: 'Fixture' } }],
      edges: [],
    });
    expect(
      (await tg.cypher<{ n: string }>("MATCH (c:Concept {id: 'k1'}) RETURN c.name AS n"))[0]?.n,
    ).toBe('Fixture');
  });

  it("onMatch 'keep' on an edge leaves its properties alone", async () => {
    const tg = graph();
    await tg.clear();
    const fixture = (confidence: number, onMatch: 'keep' | 'update'): GraphFixture => ({
      nodes: [
        { label: 'Concept', key: 'a', props: { slug: 'a' } },
        { label: 'Concept', key: 'b', props: { slug: 'b' } },
      ],
      edges: [
        {
          type: 'PREREQUISITE_OF',
          from: { label: 'Concept', key: 'a' },
          to: { label: 'Concept', key: 'b' },
          props: { confidence },
          onMatch,
        },
      ],
    });
    await tg.load(fixture(0.5, 'keep'));
    await tg.load(fixture(0.9, 'keep'));
    const read = () =>
      tg.cypher<{ c: number }>(
        'MATCH (:Concept {id: "a"})-[r:PREREQUISITE_OF]->() RETURN r.confidence AS c',
      );
    expect((await read())[0]?.c).toBe(0.5);
    await tg.load(fixture(0.9, 'update'));
    expect((await read())[0]?.c).toBe(0.9);
  });

  it('keyProps allow two ANSWERED edges between the same pair', async () => {
    const tg = graph();
    await tg.clear();
    const fixture: GraphFixture = {
      nodes: [
        { label: 'Session', key: 's1', props: { score: 0 } },
        { label: 'Question', key: 'q1', props: { sentence: 'a ___ b ___' } },
      ],
      edges: [0, 1].map((blank) => ({
        type: 'ANSWERED' as const,
        from: { label: 'Session' as const, key: 's1' },
        to: { label: 'Question' as const, key: 'q1' },
        props: { blank, word: `w${blank}`, correct: blank === 0 },
        keyProps: ['blank'],
      })),
    };
    await tg.load(fixture);
    await tg.load(fixture);
    expect(await tg.countEdges('ANSWERED')).toBe(2);
    const rows = await tg.cypher<{ blank: number; word: string }>(
      'MATCH (:Session)-[r:ANSWERED]->(:Question) RETURN r.blank AS blank, r.word AS word ORDER BY blank',
    );
    expect(rows).toEqual([
      { blank: 0, word: 'w0' },
      { blank: 1, word: 'w1' },
    ]);
  });

  it('stores vectors, which a vector query finds', async () => {
    const tg = graph();
    await tg.clear();
    await tg.load({
      nodes: [
        {
          label: 'Chunk',
          key: 'ch1',
          props: { text: 'one', position: 0 },
          vectors: { embedding: [1, 0, 0, 0] },
        },
        {
          label: 'Chunk',
          key: 'ch2',
          props: { text: 'two', position: 1 },
          vectors: { embedding: [0, 1, 0, 0] },
        },
      ],
      edges: [],
    });
    const rows = await tg.cypher<{ id: string; score: number }>(
      "CALL db.idx.vector.queryNodes('Chunk', 'embedding', 2, vecf32([1, 0.1, 0, 0])) YIELD node, score RETURN node.id AS id, score ORDER BY score",
    );
    expect(rows.map((r) => r.id)).toEqual(['ch1', 'ch2']);
    expect(rows[0]!.score).toBeLessThan(rows[1]!.score);
  });

  it('round-trips list properties, dropping nulls', async () => {
    const tg = graph();
    await tg.clear();
    await tg.load({
      nodes: [
        {
          label: 'Question',
          key: 'ql',
          props: {
            sentence: 'x',
            answers: ['a', 'b'],
            distractors: ['c', null as unknown as string],
            empty: [],
          },
        },
      ],
      edges: [],
    });
    const rows = await tg.cypher<{ answers: string[]; distractors: string[]; empty: unknown[] }>(
      "MATCH (q:Question {id: 'ql'}) RETURN q.answers AS answers, q.distractors AS distractors, q.empty AS empty",
    );
    expect(rows[0]).toEqual({ answers: ['a', 'b'], distractors: ['c'], empty: [] });
  });

  it('throws INVALID_IDENTIFIER for an unknown label or relationship type', async () => {
    const tg = graph();
    const badLabel = { nodes: [{ label: 'Nope', key: 'x' }], edges: [] } as unknown as GraphFixture;
    await expect(importGraph(tg.graph, badLabel)).rejects.toMatchObject({
      code: 'INVALID_IDENTIFIER',
    });
    const badType = {
      nodes: [],
      edges: [
        { type: 'NOPE', from: { label: 'Concept', key: 'a' }, to: { label: 'Concept', key: 'b' } },
      ],
    } as unknown as GraphFixture;
    await expect(importGraph(tg.graph, badType)).rejects.toBeInstanceOf(GraphKitError);
  });

  it('fails when an edge endpoint is missing', async () => {
    const tg = graph();
    await tg.clear();
    await tg.load({
      nodes: [{ label: 'Concept', key: 'only', props: { slug: 'only' } }],
      edges: [],
    });
    await expect(
      tg.load({
        nodes: [],
        edges: [
          {
            type: 'PREREQUISITE_OF',
            from: { label: 'Concept', key: 'only' },
            to: { label: 'Concept', key: 'ghost' },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'QUERY_FAILED' });
  });
});
