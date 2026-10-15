// Synthetic gameplay fixture (003 tasks T012). Used by gameplay.queries.spec.ts. A copy lives in
// apps/api/test/support/gameplay-fixture.ts for the API tests.
// Learners A, B, C (learners), R (reviewer), M (admin). Puzzles: P1 public seed, P2 private upload of B (source S2),
// P3 draft of B, P4 public upload of R (source S4), P5 private prompt of A (source S5, no chunks).

export type Run = (text: string, params?: Record<string, unknown>) => Promise<unknown[]>;

export interface FixtureIds {
  A: string;
  B: string;
  C: string;
  R: string;
  M: string;
}

export const DEFAULT_IDS: FixtureIds = { A: 'learner-a', B: 'learner-b', C: 'learner-c', R: 'learner-r', M: 'learner-m' };

const NAMES: Record<keyof FixtureIds, string> = { A: 'Ann', B: 'Bea', C: 'Cid', R: 'Rui', M: 'Max' };

const text = (seed: string, n: number) => (seed + ' lorem ipsum dolor sit amet ').repeat(40).slice(0, n);

export async function buildGameplayFixture(
  run: Run,
  ids: FixtureIds = DEFAULT_IDS,
  options: { createLearners?: boolean } = {},
): Promise<void> {
  if (options.createLearners !== false) {
    for (const key of Object.keys(ids) as Array<keyof FixtureIds>) {
      await run(`MERGE (l:Learner {id: $id}) SET l.displayName = $name, l.createdAt = 1`, {
        id: ids[key],
        name: NAMES[key],
      });
    }
  }

  await run(
    `UNWIND [{id: 'c-index', name: 'Indexes'}, {id: 'c-btree', name: 'B-trees'}, {id: 'c-sql', name: 'SQL'}] AS c
     CREATE (:Concept {id: c.id, name: c.name})`,
  );

  // P1: seed, public, owned by M, no source.
  await run(
    `MATCH (m:Learner {id: $M})
     CREATE (m)-[:OWNS]->(p:Puzzle {id: 'P1', name: 'Databases 101', status: 'published', visibility: 'public',
                                    origin: 'seed', distractors: ['heap']})
     CREATE (p)-[:CONTAINS {order: 1}]->(q1:Question {id: 'q1', sentence: 'A ___ speeds up lookups but slows ___.',
                                    status: 'approved', answers: ['index', 'writes'], distractors: ['cache']})
     CREATE (p)-[:CONTAINS {order: 2}]->(q2:Question {id: 'q2', sentence: 'A ___ keeps keys sorted.',
                                    status: 'approved', answers: ['B-tree']})
     CREATE (p)-[:CONTAINS {order: 3}]->(q3:Question {id: 'q3', sentence: 'Every table benefits from an ___.',
                                    status: 'approved', answers: ['index']})
     CREATE (p)-[:CONTAINS {order: 4}]->(:Question {id: 'q4', sentence: 'Draft ___.', status: 'draft', answers: ['secretdraft']})
     CREATE (p)-[:CONTAINS {order: 5}]->(:Question {id: 'q5', sentence: 'Rejected ___.', status: 'rejected', answers: ['secretrejected']})
     WITH q1, q2
     MATCH (ci:Concept {id: 'c-index'}), (cb:Concept {id: 'c-btree'})
     CREATE (q1)-[:TESTS]->(ci), (q2)-[:TESTS]->(ci), (q2)-[:TESTS]->(cb)`,
    { M: ids.M },
  );

  // S2 -> P2 (private upload of B) with two chunks.
  await run(
    `MATCH (b:Learner {id: $B})
     CREATE (b)-[:OWNS]->(s:Source {id: 'S2', kind: 'upload', title: 'Notes B'})
     CREATE (s)-[:HAS_CHUNK]->(:Chunk {id: 'ch-1', position: 1, text: $t1})
     CREATE (s)-[:HAS_CHUNK]->(:Chunk {id: 'ch-2', position: 2, text: $t2})
     CREATE (b)-[:OWNS]->(p:Puzzle {id: 'P2', name: 'B notes', status: 'published', visibility: 'private', origin: 'upload'})
     CREATE (s)-[:YIELDED]->(p)
     CREATE (p)-[:CONTAINS {order: 1}]->(q:Question {id: 'q6', sentence: 'SQL stands for structured query ___.',
                                    status: 'approved', answers: ['language']})
     WITH q
     MATCH (c:Concept {id: 'c-sql'}), (c1:Chunk {id: 'ch-1'}), (c2:Chunk {id: 'ch-2'})
     CREATE (q)-[:TESTS]->(c), (q)-[:GROUNDED_IN]->(c2), (q)-[:GROUNDED_IN]->(c1)`,
    { B: ids.B, t1: text('first chunk', 600), t2: text('second chunk', 600) },
  );

  // P3: draft puzzle of B with an approved question.
  await run(
    `MATCH (b:Learner {id: $B})
     CREATE (b)-[:OWNS]->(p:Puzzle {id: 'P3', name: 'B draft', status: 'draft', visibility: 'private', origin: 'upload'})
     CREATE (p)-[:CONTAINS {order: 1}]->(:Question {id: 'q9', sentence: 'Hidden ___.', status: 'approved', answers: ['hidden']})`,
    { B: ids.B },
  );

  // S4 -> P4 (public upload of R).
  await run(
    `MATCH (r:Learner {id: $R}), (c:Concept {id: 'c-sql'})
     CREATE (r)-[:OWNS]->(s:Source {id: 'S4', kind: 'upload', title: 'Notes R'})
     CREATE (s)-[:HAS_CHUNK]->(ch:Chunk {id: 'ch-4', position: 1, text: $t})
     CREATE (r)-[:OWNS]->(p:Puzzle {id: 'P4', name: 'R public', status: 'published', visibility: 'public', origin: 'upload'})
     CREATE (s)-[:YIELDED]->(p)
     CREATE (p)-[:CONTAINS {order: 1}]->(q:Question {id: 'q7', sentence: 'A ___ joins tables.', status: 'approved', answers: ['join']})
     CREATE (q)-[:TESTS]->(c), (q)-[:GROUNDED_IN]->(ch)`,
    { R: ids.R, t: text('public chunk', 400) },
  );

  // S5 -> P5 (private prompt puzzle of A; no chunks, no GROUNDED_IN).
  await run(
    `MATCH (a:Learner {id: $A}), (c:Concept {id: 'c-sql'})
     CREATE (a)-[:OWNS]->(s:Source {id: 'S5', kind: 'prompt', title: 'Prompt', brief: '{"topic":"SQL"}'})
     CREATE (a)-[:OWNS]->(p:Puzzle {id: 'P5', name: 'A prompt', status: 'published', visibility: 'private', origin: 'prompt'})
     CREATE (s)-[:YIELDED]->(p)
     CREATE (p)-[:CONTAINS {order: 1}]->(q:Question {id: 'q8', sentence: 'SELECT picks ___.', status: 'approved', answers: ['columns']})
     CREATE (q)-[:TESTS]->(c), (q)-[:GENERATED_FROM]->(s)`,
    { A: ids.A },
  );
}

export async function share(run: Run, puzzleId: string, learnerId: string, withSource: boolean): Promise<void> {
  await run(
    `MATCH (p:Puzzle {id: $puzzleId}), (l:Learner {id: $learnerId})
     MERGE (p)-[sh:SHARED_WITH]->(l) SET sh.withSource = $withSource, sh.at = 1`,
    { puzzleId, learnerId, withSource },
  );
}

export async function unshare(run: Run, puzzleId: string, learnerId: string): Promise<void> {
  await run(`MATCH (:Puzzle {id: $puzzleId})-[sh:SHARED_WITH]->(:Learner {id: $learnerId}) DELETE sh`, {
    puzzleId,
    learnerId,
  });
}
