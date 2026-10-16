import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createLearner, deleteLearner } from '../src/queries/platform';
import { createTestGraph, type TestGraph } from '../src/testing';

let tg: TestGraph;

beforeAll(async () => {
  tg = await createTestGraph();
});
afterAll(async () => {
  await tg?.dispose();
});
beforeEach(async () => {
  await tg.clear();
});

const ID = '11111111-1111-4111-8111-111111111111';

describe('create_learner', () => {
  it('creates a node with exactly id, displayName, createdAt and returns created: true', async () => {
    const row = await tg.graph.runOne(createLearner, {
      id: ID,
      displayName: 'Ada',
      createdAt: 1_760_000_000_000,
    });
    expect(row).toEqual({
      id: ID,
      displayName: 'Ada',
      createdAt: 1_760_000_000_000,
      created: true,
    });
    const [node] = await tg.cypher<{ props: Record<string, unknown> }>(
      'MATCH (l:Learner) RETURN properties(l) AS props',
    );
    expect(node!.props).toEqual({ id: ID, displayName: 'Ada', createdAt: 1_760_000_000_000 });
  });

  it('a second call with the same id creates nothing and keeps the first displayName', async () => {
    await tg.graph.runOne(createLearner, {
      id: ID,
      displayName: 'Ada',
      createdAt: 1_760_000_000_000,
    });
    const again = await tg.graph.runOne(createLearner, {
      id: ID,
      displayName: 'Other',
      createdAt: 1_770_000_000_000,
    });
    expect(again).toEqual({
      id: ID,
      displayName: 'Ada',
      createdAt: 1_760_000_000_000,
      created: false,
    });
    expect(await tg.count('Learner')).toBe(1);
  });
});

describe('delete_learner', () => {
  it('returns 1 for a learner without relationships and removes it', async () => {
    await tg.graph.runOne(createLearner, { id: ID, displayName: 'Ada', createdAt: 1 });
    expect(await tg.graph.runOne(deleteLearner, { id: ID })).toEqual({ deleted: 1 });
    expect(await tg.count('Learner')).toBe(0);
  });

  it('returns 0 for an unknown id', async () => {
    expect(await tg.graph.runOne(deleteLearner, { id: ID })).toEqual({ deleted: 0 });
  });

  it('returns 0 and keeps a learner that has a PLAYED relationship', async () => {
    await tg.cypher(
      `CREATE (:Learner {id: $id, displayName: 'Ada', createdAt: 1})-[:PLAYED]->(:Session {id: 's1'})`,
      { id: ID },
    );
    expect(await tg.graph.runOne(deleteLearner, { id: ID })).toEqual({ deleted: 0 });
    expect(await tg.count('Learner')).toBe(1);
  });
});
