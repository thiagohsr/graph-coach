import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GraphKitError } from '../src/index';
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

describe('GraphRepository', () => {
  it('upsert creates then updates without duplicating', async () => {
    const repo = tg.graph.repository('Concept');
    const created = await repo.upsert({ id: 'c1', title: 'First', level: 1 });
    expect(created).toEqual({ id: 'c1', title: 'First', level: 1 });
    const updated = await repo.upsert({ id: 'c1', title: 'Second' });
    expect(updated).toEqual({ id: 'c1', title: 'Second', level: 1 });
    expect(await tg.count('Concept')).toBe(1);
  });

  it('find returns properties or null', async () => {
    const repo = tg.graph.repository('Concept');
    await repo.upsert({ id: 'c1', title: 'First' });
    expect(await repo.find('c1')).toEqual({ id: 'c1', title: 'First' });
    expect(await repo.find('missing')).toBeNull();
  });

  it('delete returns true once then false and removes attached relationships', async () => {
    await tg.cypher(`CREATE (:Concept {id: 'a'})-[:PREREQUISITE_OF]->(:Concept {id: 'b'})`);
    const repo = tg.graph.repository('Concept');
    expect(await repo.delete('a')).toBe(true);
    expect(await repo.delete('a')).toBe(false);
    expect(await tg.countEdges('PREREQUISITE_OF')).toBe(0);
    expect(await tg.count('Concept')).toBe(1);
  });

  it('Agent uses name as its key', async () => {
    const repo = tg.graph.repository('Agent');
    await repo.upsert({ name: 'coach', role: 'planner' });
    await repo.upsert({ name: 'coach', role: 'critic' });
    expect(await tg.count('Agent')).toBe(1);
    expect(await repo.find('coach')).toEqual({ name: 'coach', role: 'critic' });
    expect(await repo.delete('coach')).toBe(true);
  });

  it('an unknown label throws INVALID_IDENTIFIER', () => {
    try {
      tg.graph.repository('Bogus' as never);
      throw new Error('expected a throw');
    } catch (error) {
      expect(error).toBeInstanceOf(GraphKitError);
      expect((error as GraphKitError).code).toBe('INVALID_IDENTIFIER');
    }
  });

  it('list properties round-trip', async () => {
    const repo = tg.graph.repository('Concept');
    await repo.upsert({ id: 'c1', tags: ['a', 'b'], scores: [1, 2, 3] });
    expect(await repo.find('c1')).toEqual({ id: 'c1', tags: ['a', 'b'], scores: [1, 2, 3] });
  });

  it('refuses an entity without the key property', async () => {
    const repo = tg.graph.repository('Concept');
    await expect(repo.upsert({ title: 'no id' } as never)).rejects.toMatchObject({
      code: 'INVALID_IDENTIFIER',
    });
  });
});
