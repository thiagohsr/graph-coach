// Builds the graph of a finished Curator run (source, chunk, awaiting_review task, draft puzzle, drafts) directly,
// so that the review, sharing, and visibility tests control the number of drafts and need no model call.
import { randomBytes } from 'node:crypto';
import type { QueryParams } from '@coach/graph-kit';
import type { TestApp, TestUser } from './test-app';

export const PASSAGE =
  'The index speeds up lookups in large tables, and a hash index answers equality tests.';

export interface SeededRun {
  sourceId: string;
  taskId: string;
  puzzleId: string;
  questionIds: string[];
}

export interface SeedOptions {
  drafts?: number;
  kind?: 'upload' | 'prompt';
  taskStatus?: 'awaiting_review' | 'in_progress';
}

/** Draft question text that passes validateDraft against PASSAGE. */
export function draftSentence(i: number): string {
  return `Question ${i}: an ___ makes reading rows from big tables much faster.`;
}

export async function seedRun(
  app: TestApp,
  owner: TestUser,
  options: SeedOptions = {},
): Promise<SeededRun> {
  const n = options.drafts ?? 5;
  const kind = options.kind ?? 'upload';
  const tag = randomBytes(5).toString('hex');
  const sourceId = `src-${tag}`;
  const taskId = `task-${tag}`;
  const puzzleId = `puz-${tag}`;
  const questionIds = Array.from({ length: n }, (_, i) => `q-${tag}-${i + 1}`);
  const run = (text: string, params: QueryParams) => app.testGraph.cypher(text, params);

  await run(
    `MATCH (l:Learner {id: $owner})
     MERGE (a:Agent {name: 'Curator'})
     CREATE (l)-[:OWNS]->(s:Source {id: $sourceId, title: 'Seed notes', kind: $srcKind, createdAt: 1000})
     SET s.content = CASE WHEN $kind = 'upload' THEN $passage ELSE null END,
         s.brief = CASE WHEN $kind = 'prompt' THEN '{"subject":"indexes","difficulty":"easy","sentences":5}' ELSE null END
     CREATE (l)-[:REQUESTED]->(t:Task {id: $taskId, kind: $taskKind, status: $taskStatus, createdAt: 1000, updatedAt: 1000,
                                       modelCalls: 0, inputTokens: 0, outputTokens: 0, embeddingTokens: 0})
     CREATE (t)-[:ASSIGNED_TO]->(a), (t)-[:CONCERNS]->(s)
     CREATE (l)-[:OWNS]->(p:Puzzle {id: $puzzleId, name: 'Seed puzzle', origin: $kind, status: 'draft', visibility: 'private',
                                    distractors: [], createdAt: 1000})
     CREATE (s)-[:YIELDED]->(p), (t)-[:PRODUCED]->(p)`,
    {
      owner: owner.id,
      sourceId,
      taskId,
      puzzleId,
      kind,
      srcKind: kind === 'upload' ? 'text' : 'prompt',
      taskKind: kind === 'upload' ? 'ingest' : 'generate',
      taskStatus: options.taskStatus ?? 'awaiting_review',
      passage: PASSAGE,
    },
  );
  await run(
    `MERGE (c:Concept {slug: 'indexes'}) ON CREATE SET c.id = 'c-indexes', c.name = 'Indexes', c.createdAt = 1`,
    {},
  );
  if (kind === 'upload') {
    await run(
      `MATCH (s:Source {id: $sourceId}) CREATE (s)-[:HAS_CHUNK]->(:Chunk {id: $chunkId, position: 0, text: $passage})`,
      { sourceId, chunkId: `ch-${tag}`, passage: PASSAGE },
    );
  }
  for (const [i, id] of questionIds.entries()) {
    await run(
      `MATCH (p:Puzzle {id: $puzzleId}), (t:Task {id: $taskId}), (s:Source {id: $sourceId}), (c:Concept {slug: 'indexes'})
       CREATE (q:Question {id: $id, sentence: $sentence, answers: ['index'], distractors: ['queue', 'stack'], status: 'draft', createdAt: 1000})
       CREATE (p)-[:CONTAINS {order: $order}]->(q), (t)-[:PRODUCED]->(q), (q)-[:TESTS]->(c)
       SET q.critique = CASE WHEN $kind = 'prompt' THEN '{"verdict":"pass","note":"fine","rewritten":false}' ELSE null END
       WITH q, s
       OPTIONAL MATCH (s)-[:HAS_CHUNK]->(ch:Chunk)
       FOREACH (_ IN CASE WHEN ch IS NULL THEN [] ELSE [1] END | MERGE (q)-[:GROUNDED_IN]->(ch))
       FOREACH (_ IN CASE WHEN ch IS NULL THEN [1] ELSE [] END | MERGE (q)-[:GENERATED_FROM]->(s))`,
      { puzzleId, taskId, sourceId, id, sentence: draftSentence(i + 1), order: i + 1, kind },
    );
  }
  return { sourceId, taskId, puzzleId, questionIds };
}

/** Sets a puzzle published directly (for sharing and visibility tests that do not exercise review). */
export async function publishDirectly(app: TestApp, puzzleId: string): Promise<void> {
  await app.testGraph.cypher(`MATCH (p:Puzzle {id: $puzzleId}) SET p.status = 'published'`, {
    puzzleId,
  });
}
