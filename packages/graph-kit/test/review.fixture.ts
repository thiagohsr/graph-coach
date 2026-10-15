// Fixture extension for the review, sharing, and visibility query tests (005 tasks T056, T080, T092).
import { IDS, addTaskFor, type Run } from './curator.fixture';

const A_ID = IDS.A;

/** A draft puzzle PZ1 owned by Ann (source S1, task-1) with five drafts produced by task-1: q-1..q-5. */
export async function addDraftPuzzle(run: Run) {
  await addTaskFor(run);
  await run(
    `MATCH (a:Learner {id: $A}), (s:Source {id: 'S1'}), (t:Task {id: 'task-1'})
     CREATE (a)-[:OWNS]->(p:Puzzle {id: 'PZ1', name: 'Ann puzzle', origin: 'upload', status: 'draft', visibility: 'private', distractors: [], createdAt: 1000})
     CREATE (s)-[:YIELDED]->(p), (t)-[:PRODUCED]->(p)`,
    { A: A_ID },
  );
  for (let i = 1; i <= 5; i += 1) {
    const chunk = `ch-${Math.min(i, 3)}`;
    const concept = ['index', 'b-tree', 'sql'][Math.min(i, 3) - 1];
    await run(
      `MATCH (p:Puzzle {id: 'PZ1'}), (t:Task {id: 'task-1'}), (ch:Chunk {id: $chunk}), (c:Concept {slug: $concept})
       CREATE (qq:Question {id: $id, sentence: $sentence, answers: ['lookups'], distractors: ['a', 'b'], status: 'draft', createdAt: 1000})
       CREATE (p)-[:CONTAINS {order: $order}]->(qq), (qq)-[:GROUNDED_IN]->(ch), (qq)-[:TESTS]->(c), (t)-[:PRODUCED]->(qq)`,
      { id: `q-${i}`, sentence: `Question number ${i} about ___ here`, order: i, chunk, concept },
    );
  }
}

/** Publishes PZ1 and adds a published puzzle PZ2 of Ann's that has no source, and a prompt-free draft PZ3 with source. */
export async function addPublishedPuzzles(run: Run) {
  await run(`MATCH (p:Puzzle {id: 'PZ1'}) SET p.status = 'published'`);
  await run(
    `MATCH (a:Learner {id: $A})
     CREATE (a)-[:OWNS]->(:Puzzle {id: 'PZ2', name: 'No source', origin: 'upload', status: 'published', visibility: 'private', distractors: [], createdAt: 2000})
     CREATE (a)-[:OWNS]->(:Puzzle {id: 'PZ3', name: 'Draft', origin: 'upload', status: 'draft', visibility: 'private', distractors: [], createdAt: 3000})`,
    { A: A_ID },
  );
}
