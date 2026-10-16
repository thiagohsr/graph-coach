import { beforeAll, describe, expect, it } from 'vitest';
import { creationCountsQuery } from '../src/queries/platform';
import { seedIds } from '../src/seed/to-fixture';
import { useTestGraph } from '../src/testing/harness';

const NOW = new Date('2026-10-11T12:00:00Z');
const DAY = 86_400_000;
const graph = useTestGraph();

beforeAll(async () => {
  await graph().loadSeed({ now: NOW });
});

const near = (actual: number, expected: number) => expect(actual).toBeCloseTo(expected, 9);

describe('loadSeed', () => {
  it('creates the counts of data-model.md §5', async () => {
    const tg = graph();
    expect(await tg.count('Concept')).toBe(25);
    expect(await tg.countEdges('PREREQUISITE_OF')).toBe(32);
    expect(await tg.count('Puzzle')).toBe(6);
    expect(await tg.count('Question')).toBe(36);
    expect(await tg.count('Learner')).toBe(4);
    expect(await tg.count('Agent')).toBe(2);
    expect(await tg.count('Session')).toBe(5);
    expect(await tg.countEdges('ANSWERED')).toBe(41);
    expect(await tg.countEdges('CHANGED_MASTERY')).toBe(16);
    expect(await tg.countEdges('HAS_MASTERY')).toBe(13);
  });

  it('gives every question a matching blank count, 2+ distractors, a TESTS edge, approval and an admin review', async () => {
    const tg = graph();
    const rows = await tg.cypher<{
      id: string;
      sentence: string;
      answers: string[];
      distractors: string[];
      status: string;
    }>(
      'MATCH (q:Question) RETURN q.id AS id, q.sentence AS sentence, q.answers AS answers, q.distractors AS distractors, q.status AS status',
    );
    const tested = new Set(
      (
        await tg.cypher<{ id: string }>(
          'MATCH (q:Question)-[:TESTS]->(:Concept) RETURN DISTINCT q.id AS id',
        )
      ).map((r) => r.id),
    );
    const reviewed = (
      await tg.cypher<{ id: string; reason: string }>(
        "MATCH (:Learner {id: $admin})-[r:REVIEWED {decision: 'approved'}]->(q:Question) RETURN q.id AS id, r.reason AS reason",
        { admin: seedIds.user('admin') },
      )
    ).map((r) => r.id);
    expect(rows).toHaveLength(36);
    expect(new Set(reviewed).size).toBe(36);
    for (const row of rows) {
      expect(row.sentence.split('___').length - 1).toBe(row.answers.length);
      expect(row.distractors.length).toBeGreaterThanOrEqual(2);
      expect(row.status).toBe('approved');
      expect(tested.has(row.id)).toBe(true);
      expect(reviewed).toContain(row.id);
    }
  });

  it('publishes all puzzles publicly, owned by the admin, with origin seed', async () => {
    const rows = await graph().cypher<{
      status: string;
      visibility: string;
      origin: string;
      owner: string;
    }>(
      'MATCH (o:Learner)-[:OWNS]->(p:Puzzle) RETURN p.status AS status, p.visibility AS visibility, p.origin AS origin, o.id AS owner',
    );
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(row).toEqual({
        status: 'published',
        visibility: 'public',
        origin: 'seed',
        owner: seedIds.user('admin'),
      });
    }
  });

  it('has exactly one concept without prerequisites: relational-model', async () => {
    const rows = await graph().cypher<{ slug: string }>(
      'MATCH (c:Concept) WHERE NOT (:Concept)-[:PREREQUISITE_OF]->(c) RETURN c.slug AS slug',
    );
    expect(rows).toEqual([{ slug: 'relational-model' }]);
  });

  it('has no puzzle that tests replication or sharding', async () => {
    const rows = await graph().cypher<{ n: number }>(
      "MATCH (:Question)-[:TESTS]->(c:Concept) WHERE c.slug IN ['replication', 'sharding'] RETURN count(c) AS n",
    );
    expect(rows[0]?.n).toBe(0);
  });

  it('stores the 16 CHANGED_MASTERY edges of §5.6 and chains each concept from 0.5 to its final score', async () => {
    const tg = graph();
    const rows = await tg.cypher<{
      session: string;
      slug: string;
      before: number;
      after: number;
      at: number;
    }>(
      `MATCH (s:Session)-[r:CHANGED_MASTERY]->(c:Concept)
       RETURN s.id AS session, c.slug AS slug, r.before AS before, r.after AS after, s.submittedAt AS at`,
    );
    expect(rows).toHaveLength(16);
    const find = (key: 'A' | 'B' | 'C' | 'D' | 'E', slug: string) =>
      rows.find((r) => r.session === seedIds.session(key) && r.slug === slug)!;

    for (const slug of ['relational-model', 'tables-rows-columns', 'primary-key', 'foreign-key']) {
      near(find('D', slug).before, 0.5);
      near(find('D', slug).after, 0.8285);
    }
    for (const slug of ['sql-select', 'sql-where', 'sql-joins', 'aggregation'])
      near(find('E', slug).after, 0.8285);
    near(find('A', 'storage-pages').after, 0.8285);
    near(find('A', 'b-trees').after, 0.12005);
    near(find('B', 'indexes').after, 0.3185);
    near(find('B', 'composite-indexes').after, 0.755);
    near(find('B', 'query-planner').after, 0.755);
    near(find('C', 'indexes').before, 0.3185);
    near(find('C', 'indexes').after, 0.2562455);
    near(find('C', 'composite-indexes').before, 0.755);
    near(find('C', 'composite-indexes').after, 0.87995);
    near(find('C', 'query-planner').after, 0.87995);

    const mastery = await tg.cypher<{ slug: string; score: number }>(
      'MATCH (:Learner {id: $id})-[m:HAS_MASTERY]->(c:Concept) RETURN c.slug AS slug, m.score AS score',
      { id: seedIds.user('learner') },
    );
    const finalScore = new Map(mastery.map((m) => [m.slug, m.score]));
    const slugs = [...new Set(rows.map((r) => r.slug))];
    for (const slug of slugs) {
      const chain = rows.filter((r) => r.slug === slug).sort((a, b) => a.at - b.at);
      near(chain[0]!.before, 0.5);
      for (let i = 1; i < chain.length; i += 1) near(chain[i]!.before, chain[i - 1]!.after);
      near(chain[chain.length - 1]!.after, finalScore.get(slug)!);
    }
  });

  it('stores the 13 HAS_MASTERY edges of the demo learner with the scores, attempts and lastSeen of §5.6', async () => {
    const rows = await graph().cypher<{
      slug: string;
      score: number;
      attempts: number;
      lastSeen: number;
    }>(
      `MATCH (:Learner {id: $id})-[m:HAS_MASTERY]->(c:Concept)
       RETURN c.slug AS slug, m.score AS score, m.attempts AS attempts, m.lastSeen AS lastSeen`,
      { id: seedIds.user('learner') },
    );
    expect(rows).toHaveLength(13);
    const expected: Record<string, [number, number, number]> = {
      'relational-model': [0.8285, 3, 12],
      'tables-rows-columns': [0.8285, 3, 12],
      'primary-key': [0.8285, 3, 12],
      'foreign-key': [0.8285, 3, 12],
      'sql-select': [0.8285, 3, 11],
      'sql-where': [0.8285, 3, 11],
      'sql-joins': [0.8285, 3, 11],
      aggregation: [0.8285, 3, 11],
      'storage-pages': [0.8285, 3, 9],
      'b-trees': [0.12005, 4, 9],
      indexes: [0.2562455, 6, 1],
      'composite-indexes': [0.87995, 4, 1],
      'query-planner': [0.87995, 4, 1],
    };
    for (const row of rows) {
      const [score, attempts, days] = expected[row.slug]!;
      near(row.score, score);
      expect(row.attempts).toBe(attempts);
      expect(row.lastSeen).toBe(NOW.getTime() - days * DAY);
    }
  });

  it('reproduces the mastery scores by replaying the ANSWERED edges with the canonical rule', async () => {
    const tg = graph();
    const answers = await tg.cypher<{
      at: number;
      order: number;
      blank: number;
      correct: boolean;
      concepts: string[];
    }>(
      `MATCH (s:Session)-[a:ANSWERED]->(q:Question)
       MATCH (p:Puzzle)-[c:CONTAINS]->(q)
       MATCH (q)-[:TESTS]->(k:Concept)
       RETURN s.submittedAt AS at, c.order AS order, a.blank AS blank, a.correct AS correct, collect(k.slug) AS concepts`,
    );
    answers.sort((a, b) => a.at - b.at || a.order - b.order || a.blank - b.blank);
    const state = new Map<string, { score: number; attempts: number }>();
    for (const a of answers) {
      for (const slug of a.concepts) {
        const s = state.get(slug) ?? { score: 0.5, attempts: 0 };
        s.score += 0.3 * ((a.correct ? 1 : 0) - s.score);
        s.attempts += 1;
        state.set(slug, s);
      }
    }
    const stored = await tg.cypher<{ slug: string; score: number; attempts: number }>(
      'MATCH (:Learner)-[m:HAS_MASTERY]->(c:Concept) RETURN c.slug AS slug, m.score AS score, m.attempts AS attempts',
    );
    expect(state.size).toBe(13);
    for (const row of stored) {
      near(state.get(row.slug)!.score, row.score);
      expect(state.get(row.slug)!.attempts).toBe(row.attempts);
    }
  });

  it('creates nothing on a second load and keeps a changed mastery edge', async () => {
    const tg = graph();
    await tg.cypher(
      "MATCH (:Learner {id: $id})-[m:HAS_MASTERY]->(:Concept {slug: 'indexes'}) SET m.score = 0.99",
      { id: seedIds.user('learner') },
    );
    const again = await tg.loadSeed({ now: NOW });
    expect(again.nodesCreated).toBe(0);
    expect(again.relationshipsCreated).toBe(0);
    const rows = await tg.cypher<{ score: number }>(
      "MATCH (:Learner {id: $id})-[m:HAS_MASTERY]->(:Concept {slug: 'indexes'}) RETURN m.score AS score",
      { id: seedIds.user('learner') },
    );
    expect(rows[0]?.score).toBe(0.99);
    expect(await tg.countEdges('ANSWERED')).toBe(41);
  });

  it('has four learners, no share and no source, so creation_counts is zero for every demo user', async () => {
    const tg = graph();
    expect(await tg.count('Learner')).toBe(4);
    expect(await tg.countEdges('SHARED_WITH')).toBe(0);
    expect(await tg.count('Source')).toBe(0);
    const userIds = (['learner', 'learner2', 'reviewer', 'admin'] as const).map((k) =>
      seedIds.user(k),
    );
    const rows = await tg.graph.run(creationCountsQuery, {
      userIds,
      monthStart: Date.UTC(2026, 9, 1),
      hourAgo: NOW.getTime() - 3_600_000,
      since: Date.UTC(2026, 9, 1),
    });
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row).toMatchObject({ uploadsThisMonth: 0, promptsThisMonth: 0, creationsLastHour: 0 });
    }
  });

  it('loads without the scenario: no Session', async () => {
    const other = await (await import('../src/testing/harness')).createTestGraph();
    try {
      await other.loadSeed({ now: NOW, scenario: false });
      expect(await other.count('Session')).toBe(0);
      expect(await other.count('Concept')).toBe(25);
      expect(await other.count('Learner')).toBe(4);
    } finally {
      await other.dispose();
    }
  });
});
