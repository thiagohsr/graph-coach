// Named-query test of the cover pickup read (spec 005 cover stretch): cover_concepts.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { QueryParams } from '../src';
import { createTestGraph, type TestGraph } from '../src/testing';
import { buildCuratorFixture, type Run } from './curator.fixture';

let tg: TestGraph;
const run: Run = (text, params) => tg.cypher(text, params as QueryParams);
const q = <T = Record<string, unknown>>(name: string, params: Record<string, unknown>) =>
  tg.graph.query<T>(name, params as QueryParams);

beforeAll(async () => {
  tg = await createTestGraph();
});
afterAll(async () => {
  await tg?.dispose();
});
beforeEach(async () => {
  await tg.clear();
  await buildCuratorFixture(run);
});

describe('cover_concepts', () => {
  it('returns the requested concepts by id with id, name and description, ordered by name', async () => {
    const rows = await q('cover_concepts', { ids: ['c-sql', 'c-index', 'c-btree'] });
    expect(rows).toEqual([
      { id: 'c-btree', name: 'B-tree', description: 'B-tree concept' },
      { id: 'c-index', name: 'Index', description: 'Index concept' },
      { id: 'c-sql', name: 'SQL', description: 'SQL concept' },
    ]);
  });

  it('returns only the requested subset', async () => {
    expect(await q('cover_concepts', { ids: ['c-sql'] })).toEqual([
      { id: 'c-sql', name: 'SQL', description: 'SQL concept' },
    ]);
  });

  it('ignores unknown ids', async () => {
    const rows = await q<{ id: string }>('cover_concepts', { ids: ['c-index', 'nope'] });
    expect(rows.map((r) => r.id)).toEqual(['c-index']);
    expect(await q('cover_concepts', { ids: ['nope'] })).toEqual([]);
  });

  it('returns nothing for an empty list', async () => {
    expect(await q('cover_concepts', { ids: [] })).toEqual([]);
  });

  it('gives an empty description when the concept has none', async () => {
    await run(`CREATE (:Concept {id: 'c-bare', slug: 'bare', name: 'Bare', createdAt: 1})`);
    expect(await q('cover_concepts', { ids: ['c-bare'] })).toEqual([
      { id: 'c-bare', name: 'Bare', description: '' },
    ]);
  });

  it('is read-only and applies no access rule (concepts are global): nothing is written', async () => {
    const count = async () => {
      const [n] = await tg.cypher<{ n: number }>('MATCH (n) RETURN count(n) AS n');
      const [e] = await tg.cypher<{ n: number }>('MATCH ()-[r]->() RETURN count(r) AS n');
      return `${n!.n}/${e!.n}`;
    };
    const before = await count();
    await q('cover_concepts', { ids: ['c-index', 'c-btree', 'c-sql'] });
    expect(await count()).toBe(before);
  });
});
