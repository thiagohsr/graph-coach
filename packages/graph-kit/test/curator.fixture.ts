// Synthetic fixture for the Curator named-query tests (005 tasks T009, T056).
// Learners: A (Ann) and B (Bea) are learners, R (Rui) is a reviewer, M (Max) is an admin; each node has `id` and
// `displayName` only, no e-mail address and no username. Plus the Curator agent, three concepts (index -> b-tree is a
// prerequisite edge, sql stands alone), and two sources:
//   S1 (Ann's, with content, fingerprint FP1): chunks ch-1, ch-2, ch-3 with small test vectors; ch-1 mentions index,
//       ch-2 mentions b-tree, ch-3 mentions sql.
//   S2 (Bea's, private): one chunk ch-b1 whose vector is close to ch-1's, mentioning sql.
// The test graph's vector index has dimension 64 (the harness default), so vectors are padded to 64.

export type Run = (text: string, params?: Record<string, unknown>) => Promise<unknown[]>;

export interface CuratorIds {
  A: string;
  B: string;
  R: string;
  M: string;
}

export const IDS: CuratorIds = { A: 'learner-a', B: 'learner-b', R: 'learner-r', M: 'learner-m' };
export const NAMES: Record<keyof CuratorIds, string> = { A: 'Ann', B: 'Bea', R: 'Rui', M: 'Max' };
export const DIMENSION = 64;
export const FP1 = 'f'.repeat(64);

/** A vector of the index dimension that starts with `head` and is zero after it. */
export const vec = (...head: number[]): number[] => [
  ...head,
  ...new Array<number>(DIMENSION - head.length).fill(0),
];

export const VECTORS = {
  'ch-1': vec(1, 0, 0),
  'ch-2': vec(0, 1, 0),
  'ch-3': vec(0, 0, 1),
  /** Cosine distance to ch-1 is about 0.005. */
  'ch-b1': vec(1, 0.1, 0),
};

export const SOURCE_TEXT =
  'An index speeds up lookups. A B-tree keeps keys sorted. SQL asks for rows by value.';

export async function buildCuratorFixture(run: Run, ids: CuratorIds = IDS): Promise<void> {
  for (const key of Object.keys(ids) as Array<keyof CuratorIds>) {
    await run('MERGE (l:Learner {id: $id}) SET l.displayName = $name, l.createdAt = 1', {
      id: ids[key],
      name: NAMES[key],
    });
  }
  await run("MERGE (:Agent {name: 'Curator'})");
  await run(
    `UNWIND [{id: 'c-index', slug: 'index', name: 'Index'}, {id: 'c-btree', slug: 'b-tree', name: 'B-tree'},
             {id: 'c-sql', slug: 'sql', name: 'SQL'}] AS c
     CREATE (:Concept {id: c.id, slug: c.slug, name: c.name, description: c.name + ' concept', createdAt: 1})`,
  );
  await run(
    `MATCH (a:Concept {slug: 'index'}), (b:Concept {slug: 'b-tree'}) CREATE (a)-[:PREREQUISITE_OF {confidence: 0.8}]->(b)`,
  );

  await run(
    `MATCH (a:Learner {id: $A})
     CREATE (a)-[:OWNS]->(s:Source {id: 'S1', title: 'Ann notes', kind: 'text', fingerprint: $fp, content: $content, createdAt: 1000})
     CREATE (s)-[:HAS_CHUNK]->(c1:Chunk {id: 'ch-1', position: 0, text: 'An index speeds up lookups.'})
     CREATE (s)-[:HAS_CHUNK]->(c2:Chunk {id: 'ch-2', position: 1, text: 'A B-tree keeps keys sorted.'})
     CREATE (s)-[:HAS_CHUNK]->(c3:Chunk {id: 'ch-3', position: 2, text: 'SQL asks for rows by value.'})
     CREATE (c1)-[:NEXT]->(c2), (c2)-[:NEXT]->(c3)
     SET c1.embedding = vecf32($v1), c2.embedding = vecf32($v2), c3.embedding = vecf32($v3)
     WITH c1, c2, c3
     MATCH (i:Concept {slug: 'index'}), (b:Concept {slug: 'b-tree'}), (q:Concept {slug: 'sql'})
     CREATE (c1)-[:MENTIONS]->(i), (c2)-[:MENTIONS]->(b), (c3)-[:MENTIONS]->(q)`,
    {
      A: ids.A,
      fp: FP1,
      content: SOURCE_TEXT,
      v1: VECTORS['ch-1'],
      v2: VECTORS['ch-2'],
      v3: VECTORS['ch-3'],
    },
  );

  await run(
    `MATCH (b:Learner {id: $B}), (q:Concept {slug: 'sql'})
     CREATE (b)-[:OWNS]->(s:Source {id: 'S2', title: 'Bea notes', kind: 'markdown', fingerprint: $fp, content: 'Private text of Bea.', createdAt: 2000})
     CREATE (s)-[:HAS_CHUNK]->(c:Chunk {id: 'ch-b1', position: 0, text: 'PRIVATE CHUNK TEXT OF BEA'})
     SET c.embedding = vecf32($v)
     CREATE (c)-[:MENTIONS]->(q)`,
    { B: ids.B, fp: 'e'.repeat(64), v: VECTORS['ch-b1'] },
  );
}

/** A task for S1 requested by Ann, as create_task would write it. */
export async function addTaskFor(
  run: Run,
  ids: CuratorIds = IDS,
  taskId = 'task-1',
  sourceId = 'S1',
  requester: string = ids.A,
) {
  await run(
    `MATCH (l:Learner {id: $requester}), (a:Agent {name: 'Curator'}), (s:Source {id: $sourceId})
     CREATE (l)-[:REQUESTED]->(t:Task {id: $taskId, kind: 'ingest', status: 'queued', createdAt: 1000, updatedAt: 1000,
                                       modelCalls: 0, inputTokens: 0, outputTokens: 0, embeddingTokens: 0})
     CREATE (t)-[:ASSIGNED_TO]->(a), (t)-[:CONCERNS]->(s)`,
    { requester, taskId, sourceId },
  );
}
