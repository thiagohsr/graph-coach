import { afterAll, describe, expect, it } from 'vitest';
import { describeSchema } from '../src/setup';
import { createTestGraph, type TestGraph } from '../src/testing/harness';
import { fixtureIds, fixtures } from '../src/testing/fixtures';

const created: TestGraph[] = [];
async function make(options?: Parameters<typeof createTestGraph>[0]): Promise<TestGraph> {
  const tg = await createTestGraph(options);
  created.push(tg);
  return tg;
}
afterAll(async () => {
  for (const tg of created) await tg.dispose().catch(() => undefined);
});

describe('test graph isolation', () => {
  it('gives two instances different names and isolated data', async () => {
    const a = await make();
    const b = await make();
    expect(a.name).not.toBe(b.name);
    expect(a.name).toMatch(/^test_harness_[0-9a-f]{8}$/);
    await a.load(fixtures.learner('only-in-a', 'A'));
    expect(await a.count('Learner')).toBe(1);
    expect(await b.count('Learner')).toBe(0);
  });

  it('clear removes data and keeps indexes', async () => {
    const tg = await make();
    const before = await describeSchema(tg.graph);
    expect(before.items.length).toBe(20);
    await tg.load(fixtures.merge(fixtures.conceptChain(), fixtures.learner('l', 'L')));
    expect(await tg.count('Concept')).toBe(6);
    await tg.clear();
    expect(await tg.count('Concept')).toBe(0);
    expect(await tg.count('Learner')).toBe(0);
    expect(await describeSchema(tg.graph)).toEqual(before);
  });

  it('dispose removes the graph', async () => {
    const tg = await make();
    const lister = await make({ setup: false });
    await tg.load(fixtures.learner('x', 'X'));
    expect(await lister.graph.listGraphs()).toContain(tg.name);
    await tg.dispose();
    expect(await lister.graph.listGraphs()).not.toContain(tg.name);
  });

  it('skips setup with setup: false', async () => {
    const tg = await make({ setup: false });
    expect((await describeSchema(tg.graph)).items).toEqual([]);
  });
});

describe('fixtures', () => {
  it('conceptChain: six concepts, five prerequisite edges, no learners', async () => {
    const tg = await make();
    await tg.load(fixtures.conceptChain());
    expect(await tg.count('Concept')).toBe(6);
    expect(await tg.countEdges('PREREQUISITE_OF')).toBe(5);
    expect(await tg.count('Learner')).toBe(0);
  });

  it('tinyPuzzle: one puzzle, three approved questions on two concepts, one owner', async () => {
    const tg = await make();
    await tg.load(fixtures.tinyPuzzle());
    expect(await tg.count('Puzzle')).toBe(1);
    expect(await tg.count('Question')).toBe(3);
    expect(await tg.count('Concept')).toBe(2);
    expect(await tg.count('Learner')).toBe(1);
    expect(await tg.countEdges('OWNS')).toBe(1);
    expect(await tg.countEdges('CONTAINS')).toBe(3);
    expect(await tg.countEdges('TESTS')).toBe(3);
    const rows = await tg.cypher<{ n: number }>(
      "MATCH (q:Question {status: 'approved'}) RETURN count(q) AS n",
    );
    expect(rows[0]?.n).toBe(3);
    const puzzle = await tg.cypher<{ status: string; visibility: string }>(
      'MATCH (p:Puzzle) RETURN p.status AS status, p.visibility AS visibility',
    );
    expect(puzzle).toEqual([{ status: 'published', visibility: 'public' }]);
  });

  it('tinyPuzzle honours its options and is idempotent', async () => {
    const tg = await make();
    const fixture = fixtures.tinyPuzzle({
      ownerId: 'owner-1',
      visibility: 'private',
      status: 'draft',
    });
    await tg.load(fixture);
    await tg.load(fixture);
    expect(await tg.count('Question')).toBe(3);
    const rows = await tg.cypher<{ owner: string; status: string; visibility: string }>(
      'MATCH (o:Learner)-[:OWNS]->(p:Puzzle) RETURN o.id AS owner, p.status AS status, p.visibility AS visibility',
    );
    expect(rows).toEqual([{ owner: 'owner-1', status: 'draft', visibility: 'private' }]);
  });

  it('loadSeed({ scenario: false }) creates no Session', async () => {
    const tg = await make();
    await tg.loadSeed({ scenario: false });
    expect(await tg.count('Session')).toBe(0);
    expect(await tg.count('Puzzle')).toBe(6);
  });
});

describe('access fragments (contracts §5.3)', () => {
  const CAN_PLAY = `
    WHERE p.status = 'published'
      AND (p.visibility = 'public'
           OR (:Learner {id: $userId})-[:OWNS]->(p)
           OR (p)-[:SHARED_WITH]->(:Learner {id: $userId}))`;
  const CAN_READ_SOURCE = `
    WHERE ((:Learner {id: $userId})-[:OWNS]->(s)
           OR (s)-[:YIELDED]->(:Puzzle)-[:SHARED_WITH {withSource: true}]->(:Learner {id: $userId}))`;

  async function build(): Promise<TestGraph> {
    const tg = await make();
    const puzzleId = fixtureIds.tinyPuzzle;
    await tg.load(
      fixtures.merge(
        fixtures.tinyPuzzle({ ownerId: 'owner', visibility: 'private' }),
        fixtures.learner('no-source', 'Shared without source'),
        fixtures.learner('with-source', 'Shared with source'),
        fixtures.learner('other', 'Another learner'),
        fixtures.sourceFor(puzzleId, 'owner'),
        fixtures.share(puzzleId, 'no-source', false),
        fixtures.share(puzzleId, 'with-source', true),
      ),
    );
    return tg;
  }

  it('canPlay returns the private puzzle for the owner and both shared users, not for another learner', async () => {
    const tg = await build();
    const playable = async (userId: string) =>
      (
        await tg.cypher<{ id: string }>(`MATCH (p:Puzzle) ${CAN_PLAY} RETURN p.id AS id`, {
          userId,
        })
      ).map((r) => r.id);
    expect(await playable('owner')).toEqual([fixtureIds.tinyPuzzle]);
    expect(await playable('no-source')).toEqual([fixtureIds.tinyPuzzle]);
    expect(await playable('with-source')).toEqual([fixtureIds.tinyPuzzle]);
    expect(await playable('other')).toEqual([]);
  });

  it('canReadSource returns the source for the owner and the with-source user only', async () => {
    const tg = await build();
    const readable = async (userId: string) =>
      (
        await tg.cypher<{ id: string }>(`MATCH (s:Source) ${CAN_READ_SOURCE} RETURN s.id AS id`, {
          userId,
        })
      ).map((r) => r.id);
    const sourceId = fixtureIds.source(fixtureIds.tinyPuzzle, 'owner');
    expect(await readable('owner')).toEqual([sourceId]);
    expect(await readable('with-source')).toEqual([sourceId]);
    expect(await readable('no-source')).toEqual([]);
    expect(await readable('other')).toEqual([]);
  });
});
