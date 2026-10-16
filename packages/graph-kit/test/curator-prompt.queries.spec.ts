// Named-query tests of the prompt path (spec 005 task T067, the parts owned by the Curator): create_source with a brief,
// create_task with kind 'generate', upsert_concepts without chunks, source_chunks for a source with no chunk,
// create_draft_puzzle with an origin, create_generated_questions, save_outline, and list_sources for a prompt source.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { QueryParams } from '../src';
import { createTestGraph, type TestGraph } from '../src/testing';
import { FP1, IDS, buildCuratorFixture, type Run } from './curator.fixture';

const { A, B } = IDS;
const NOW = 1_760_000_000_000;
const BRIEF = JSON.stringify({
  subject: 'Library cataloguing',
  focus: 'call numbers',
  difficulty: 'easy',
  sentences: 4,
});

let tg: TestGraph;
const run: Run = (text, params) => tg.cypher(text, params as QueryParams);
const q = <T = Record<string, unknown>>(name: string, params: Record<string, unknown>) =>
  tg.graph.query<T>(name, params as QueryParams);

async function signature(): Promise<string> {
  const [nodes] = await tg.cypher<{ n: number }>('MATCH (n) RETURN count(n) AS n');
  const [edges] = await tg.cypher<{ n: number }>('MATCH ()-[r]->() RETURN count(r) AS n');
  return `${nodes!.n}/${edges!.n}`;
}

const createPromptSource = (id = 'P1', ownerId = A) =>
  q('create_source', {
    id,
    ownerId,
    title: 'Cataloguing',
    kind: 'prompt',
    fingerprint: null,
    content: null,
    brief: BRIEF,
    now: NOW,
  });

const createPromptTask = (taskId = 'gen-1', sourceId = 'P1', requesterId = A) =>
  q('create_task', { id: taskId, kind: 'generate', requesterId, sourceId, now: NOW });

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

describe('create_source for a prompt', () => {
  it('stores the brief and the kind, and no content or fingerprint', async () => {
    expect(await createPromptSource()).toEqual([{ sourceId: 'P1' }]);
    const [source] = await tg.cypher<{ p: Record<string, unknown> }>(
      `MATCH (:Learner {id: $A})-[:OWNS]->(s:Source {id: 'P1'}) RETURN properties(s) AS p`,
      { A },
    );
    expect(source!.p).toEqual({
      id: 'P1',
      title: 'Cataloguing',
      kind: 'prompt',
      brief: BRIEF,
      createdAt: NOW,
    });
  });

  it('twice changes nothing and keeps the first createdAt', async () => {
    await createPromptSource();
    const before = await signature();
    await q('create_source', {
      id: 'P1',
      ownerId: A,
      title: 'Other',
      kind: 'prompt',
      fingerprint: null,
      content: null,
      brief: BRIEF,
      now: NOW + 99,
    });
    expect(await signature()).toBe(before);
    const [row] = await tg.cypher<{ createdAt: number; title: string }>(
      `MATCH (s:Source {id: 'P1'}) RETURN s.createdAt AS createdAt, s.title AS title`,
    );
    expect(row).toEqual({ createdAt: NOW, title: 'Cataloguing' });
  });

  it('is never found by source_by_fingerprint, and does not disturb an upload with a fingerprint', async () => {
    await createPromptSource();
    expect(await q('source_by_fingerprint', { ownerId: A, fingerprint: 'null' })).toEqual([]);
    expect(await q('source_by_fingerprint', { ownerId: A, fingerprint: FP1 })).toMatchObject([
      { sourceId: 'S1' },
    ]);
  });

  it('two briefs from one owner are two sources', async () => {
    await createPromptSource('P1');
    await createPromptSource('P2');
    expect(await tg.count('Source')).toBe(4);
  });
});

describe('create_task with kind generate', () => {
  beforeEach(async () => {
    await createPromptSource();
  });

  it('creates a queued generate task with requester, assignee, and source', async () => {
    expect(await createPromptTask()).toEqual([{ taskId: 'gen-1', status: 'queued' }]);
    const [task] = await tg.cypher<{ kind: string; status: string }>(
      `MATCH (:Learner {id: $A})-[:REQUESTED]->(t:Task {id: 'gen-1'})-[:CONCERNS]->(:Source {id: 'P1'}) RETURN t.kind AS kind, t.status AS status`,
      { A },
    );
    expect(task).toEqual({ kind: 'generate', status: 'queued' });
    expect(await tg.countEdges('ASSIGNED_TO')).toBe(1);
  });

  it('twice changes nothing', async () => {
    await createPromptTask();
    const before = await signature();
    await createPromptTask();
    expect(await signature()).toBe(before);
  });
});

describe('upsert_concepts without chunks', () => {
  beforeEach(async () => {
    await createPromptSource();
    await createPromptTask();
  });

  const rows = [
    {
      id: 'n-1',
      slug: 'call-numbers',
      name: 'Call numbers',
      description: 'Codes on a spine.',
      chunkIds: [],
    },
    { id: 'n-2', slug: 'sql', name: 'Renamed SQL', description: 'Changed text', chunkIds: [] },
  ];

  it('returns its rows, creates the new concept, matches an existing slug without renaming it, and writes no MENTIONS', async () => {
    const before = await tg.countEdges('MENTIONS');
    const result = await q<{ conceptId: string; slug: string }>('upsert_concepts', {
      taskId: 'gen-1',
      concepts: rows,
      now: NOW,
    });
    expect(result.map((r) => r.slug).sort()).toEqual(['call-numbers', 'sql']);
    expect(result.find((r) => r.slug === 'sql')!.conceptId).toBe('c-sql');
    expect(result.find((r) => r.slug === 'call-numbers')!.conceptId).toBe('n-1');
    const [sql] = await tg.cypher<{ name: string }>(
      `MATCH (c:Concept {slug: 'sql'}) RETURN c.name AS name`,
    );
    expect(sql!.name).toBe('SQL');
    expect(await tg.countEdges('MENTIONS')).toBe(before);
    expect(await tg.countEdges('PRODUCED')).toBe(2);
  });

  it('twice changes nothing', async () => {
    await q('upsert_concepts', { taskId: 'gen-1', concepts: rows, now: NOW });
    const before = await signature();
    await q('upsert_concepts', { taskId: 'gen-1', concepts: rows, now: NOW + 1 });
    expect(await signature()).toBe(before);
  });
});

describe('save_outline and source_chunks for a source with no chunk', () => {
  const OUTLINE = JSON.stringify({ concepts: [], sentences: [], criteria: [], prerequisites: [] });

  beforeEach(async () => {
    await createPromptSource();
  });

  it('returns one row with the brief and null chunk columns, then the stored outline', async () => {
    const [first] = await q<Record<string, unknown>>('source_chunks', { sourceId: 'P1' });
    expect(first).toMatchObject({
      sourceTitle: 'Cataloguing',
      sourceKind: 'prompt',
      sourceContent: null,
      sourceBrief: BRIEF,
      sourceOutline: null,
      id: null,
      position: null,
      text: null,
    });
    expect(await q('save_outline', { sourceId: 'P1', outline: OUTLINE })).toEqual([
      { sourceId: 'P1' },
    ]);
    const rows = await q<Record<string, unknown>>('source_chunks', { sourceId: 'P1' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sourceBrief: BRIEF, sourceOutline: OUTLINE, id: null });
  });

  it('save_outline twice changes nothing, and refuses an upload source', async () => {
    await q('save_outline', { sourceId: 'P1', outline: OUTLINE });
    const before = await signature();
    await q('save_outline', { sourceId: 'P1', outline: OUTLINE });
    expect(await signature()).toBe(before);
    expect(await q('save_outline', { sourceId: 'S1', outline: OUTLINE })).toEqual([]);
    expect(await q('save_outline', { sourceId: 'nothing', outline: OUTLINE })).toEqual([]);
  });

  it('still returns the chunks of an upload with a null brief and outline', async () => {
    const rows = await q<Record<string, unknown>>('source_chunks', { sourceId: 'S1' });
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ sourceBrief: null, sourceOutline: null, id: 'ch-1' });
  });
});

describe('create_draft_puzzle with an origin and create_generated_questions', () => {
  const critique = (note: string) => JSON.stringify({ verdict: 'pass', note, rewritten: false });
  const questions = [
    {
      id: 'gq-1',
      sentence: 'A ___ is on the spine.',
      answers: ['call number'],
      distractors: ['a', 'b'],
      order: 1,
      conceptSlugs: ['index'],
      critique: critique('one'),
    },
    {
      id: 'gq-2',
      sentence: 'The ___ lists new items.',
      answers: ['register'],
      distractors: ['c', 'd'],
      order: 2,
      conceptSlugs: ['index', 'sql'],
      critique: critique('two'),
    },
  ];
  const puzzle = {
    id: 'pz-1',
    ownerId: A,
    sourceId: 'P1',
    taskId: 'gen-1',
    name: 'Cataloguing',
    origin: 'prompt',
    now: NOW,
  };

  beforeEach(async () => {
    await createPromptSource();
    await createPromptTask();
  });

  it('creates a draft private puzzle with its origin, OWNS, PRODUCED, and YIELDED from the brief source', async () => {
    expect(await q('create_draft_puzzle', puzzle)).toEqual([{ puzzleId: 'pz-1', status: 'draft' }]);
    const [p] = await tg.cypher<{
      origin: string;
      visibility: string;
      owned: number;
      yielded: number;
      produced: number;
    }>(
      `MATCH (p:Puzzle {id: 'pz-1'})
       RETURN p.origin AS origin, p.visibility AS visibility,
              size([(:Learner {id: $A})-[:OWNS]->(p) | 1]) AS owned,
              size([(:Source {id: 'P1'})-[:YIELDED]->(p) | 1]) AS yielded,
              size([(:Task {id: 'gen-1'})-[:PRODUCED]->(p) | 1]) AS produced`,
      { A },
    );
    expect(p).toEqual({
      origin: 'prompt',
      visibility: 'private',
      owned: 1,
      yielded: 1,
      produced: 1,
    });
  });

  it('an upload puzzle keeps origin upload', async () => {
    await q('create_task', {
      id: 'ing-1',
      kind: 'ingest',
      requesterId: A,
      sourceId: 'S1',
      now: NOW,
    });
    await q('create_draft_puzzle', {
      ...puzzle,
      id: 'pz-up',
      sourceId: 'S1',
      taskId: 'ing-1',
      origin: 'upload',
    });
    const [p] = await tg.cypher<{ origin: string }>(
      `MATCH (p:Puzzle {id: 'pz-up'}) RETURN p.origin AS origin`,
    );
    expect(p!.origin).toBe('upload');
  });

  it('writes questions with CONTAINS.order, TESTS, GENERATED_FROM, PRODUCED, critique, and returns written', async () => {
    await q('create_draft_puzzle', puzzle);
    const written = await q('create_generated_questions', {
      puzzleId: 'pz-1',
      taskId: 'gen-1',
      sourceId: 'P1',
      questions,
      now: NOW,
    });
    expect(written).toEqual([{ written: 2 }]);
    const stored = await tg.cypher<{
      id: string;
      status: string;
      critique: string;
      order: number;
      tests: number;
      from: number;
      grounded: number;
    }>(
      `MATCH (:Puzzle {id: 'pz-1'})-[ct:CONTAINS]->(q:Question)
       RETURN q.id AS id, q.status AS status, q.critique AS critique, ct.order AS order,
              size([(q)-[:TESTS]->(:Concept) | 1]) AS tests,
              size([(q)-[:GENERATED_FROM]->(:Source {id: 'P1'}) | 1]) AS from,
              size([(q)-[:GROUNDED_IN]->(:Chunk) | 1]) AS grounded
       ORDER BY ct.order`,
    );
    expect(stored).toEqual([
      {
        id: 'gq-1',
        status: 'draft',
        critique: critique('one'),
        order: 1,
        tests: 1,
        from: 1,
        grounded: 0,
      },
      {
        id: 'gq-2',
        status: 'draft',
        critique: critique('two'),
        order: 2,
        tests: 2,
        from: 1,
        grounded: 0,
      },
    ]);
    expect(await tg.countEdges('PRODUCED')).toBe(3);
  });

  it('twice gives the same counts and the same graph', async () => {
    await q('create_draft_puzzle', puzzle);
    const args = { puzzleId: 'pz-1', taskId: 'gen-1', sourceId: 'P1', questions, now: NOW };
    expect(await q('create_generated_questions', args)).toEqual([{ written: 2 }]);
    const before = await signature();
    expect(await q('create_generated_questions', { ...args, now: NOW + 1 })).toEqual([
      { written: 2 },
    ]);
    expect(await signature()).toBe(before);
  });

  it('writes nothing for an upload source, an unknown puzzle, or an unknown task', async () => {
    await q('create_draft_puzzle', puzzle);
    const args = { puzzleId: 'pz-1', taskId: 'gen-1', sourceId: 'P1', questions, now: NOW };
    const before = await signature();
    const none = [{ written: 0 }];
    expect(await q('create_generated_questions', { ...args, sourceId: 'S1' })).toEqual(none);
    expect(await q('create_generated_questions', { ...args, puzzleId: 'nope' })).toEqual(none);
    expect(await q('create_generated_questions', { ...args, taskId: 'nope' })).toEqual(none);
    expect(await signature()).toBe(before);
  });

  it('counts only the questions whose concepts exist', async () => {
    await q('create_draft_puzzle', puzzle);
    const out = await q<{ written: number }>('create_generated_questions', {
      puzzleId: 'pz-1',
      taskId: 'gen-1',
      sourceId: 'P1',
      questions: [{ ...questions[0]!, conceptSlugs: ['ghost'] }, questions[1]],
      now: NOW,
    });
    expect(out[0]!.written).toBe(1);
  });
});

describe('list_sources with a prompt source', () => {
  beforeEach(async () => {
    await createPromptSource();
    await createPromptTask();
    await q('upsert_concepts', {
      taskId: 'gen-1',
      concepts: [
        {
          id: 'n-1',
          slug: 'call-numbers',
          name: 'Call numbers',
          description: 'Codes on a spine.',
          chunkIds: [],
        },
      ],
      now: NOW,
    });
    await q('create_draft_puzzle', {
      id: 'pz-1',
      ownerId: A,
      sourceId: 'P1',
      taskId: 'gen-1',
      name: 'Cataloguing',
      origin: 'prompt',
      now: NOW,
    });
    await q('create_generated_questions', {
      puzzleId: 'pz-1',
      taskId: 'gen-1',
      sourceId: 'P1',
      questions: [
        {
          id: 'gq-1',
          sentence: 'A ___ is on the spine.',
          answers: ['x'],
          distractors: ['a', 'b'],
          order: 1,
          conceptSlugs: ['call-numbers', 'sql'],
          critique: '{}',
        },
      ],
      now: NOW,
    });
  });

  it('lists it for its owner with chunkCount 0, the concepts its questions test, its puzzle and task, and no brief', async () => {
    const rows = await q<Record<string, unknown>>('list_sources', { userId: A });
    const prompt = rows.find((r) => r.id === 'P1')!;
    expect(prompt).toMatchObject({
      kind: 'prompt',
      access: 'owner',
      chunkCount: 0,
      conceptCount: 2,
      puzzleId: 'pz-1',
      taskId: 'gen-1',
      taskStatus: 'queued',
    });
    expect(Object.keys(prompt)).not.toContain('brief');
    expect(Object.keys(prompt)).not.toContain('content');
  });

  it('does not list it for another learner', async () => {
    const rows = await q<{ id: string }>('list_sources', { userId: B });
    expect(rows.map((r) => r.id)).not.toContain('P1');
  });
});

describe('get_source and list_drafts for a prompt', () => {
  const critique = JSON.stringify({ verdict: 'pass', note: 'clear', rewritten: false });

  beforeEach(async () => {
    await createPromptSource();
    await createPromptTask();
    await q('create_draft_puzzle', {
      id: 'pz-1',
      ownerId: A,
      sourceId: 'P1',
      taskId: 'gen-1',
      name: 'x',
      origin: 'prompt',
      now: NOW,
    });
    await q('create_generated_questions', {
      puzzleId: 'pz-1',
      taskId: 'gen-1',
      sourceId: 'P1',
      questions: [
        {
          id: 'gq-1',
          sentence: 'A ___ is on the spine.',
          answers: ['x'],
          distractors: ['a', 'b'],
          order: 1,
          conceptSlugs: ['index'],
          critique,
        },
      ],
      now: NOW,
    });
  });

  it('get_source returns the brief and null content to the owner, and the same under the share rule as an upload', async () => {
    const [own] = await q<Record<string, unknown>>('get_source', { sourceId: 'P1', userId: A });
    expect(own).toMatchObject({
      id: 'P1',
      kind: 'prompt',
      brief: BRIEF,
      content: null,
      access: 'owner',
      puzzleId: 'pz-1',
    });

    // Not shared, shared without the source, then shared with it.
    expect(await q('get_source', { sourceId: 'P1', userId: B })).toEqual([]);
    await run(
      `MATCH (p:Puzzle {id: 'pz-1'}), (b:Learner {id: $B}) SET p.status = 'published' CREATE (p)-[:SHARED_WITH {withSource: false, at: 1}]->(b)`,
      { B },
    );
    expect(await q('get_source', { sourceId: 'P1', userId: B })).toEqual([]);
    await run(
      `MATCH (:Puzzle {id: 'pz-1'})-[s:SHARED_WITH]->(:Learner {id: $B}) SET s.withSource = true`,
      { B },
    );
    const [shared] = await q<Record<string, unknown>>('get_source', { sourceId: 'P1', userId: B });
    expect(shared).toMatchObject({ brief: BRIEF, access: 'shared', content: null });
    // No role sees more: a reviewer and an admin have no row.
    expect(await q('get_source', { sourceId: 'P1', userId: IDS.R })).toEqual([]);
    expect(await q('get_source', { sourceId: 'P1', userId: IDS.M })).toEqual([]);
  });

  it('list_drafts returns origin, critique, hasBrief, and null chunk columns for the owner only', async () => {
    const rows = await q<Record<string, unknown>>('list_drafts', {
      userId: A,
      status: 'draft',
      taskId: 'gen-1',
      questionId: null,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'gq-1',
      origin: 'prompt',
      critique,
      hasBrief: true,
      chunkId: null,
      chunkText: null,
      puzzleId: 'pz-1',
      taskId: 'gen-1',
      questionOrder: 1,
    });
    for (const userId of [B, IDS.R, IDS.M]) {
      expect(
        await q('list_drafts', { userId, status: null, taskId: null, questionId: null }),
      ).toEqual([]);
    }
  });
});

describe('invariant of the prompt path', () => {
  it('every question generated from a brief has GENERATED_FROM, no GROUNDED_IN, and a non-null critique', async () => {
    await createPromptSource();
    await createPromptTask();
    await q('create_draft_puzzle', {
      id: 'pz-1',
      ownerId: A,
      sourceId: 'P1',
      taskId: 'gen-1',
      name: 'x',
      origin: 'prompt',
      now: NOW,
    });
    await q('create_generated_questions', {
      puzzleId: 'pz-1',
      taskId: 'gen-1',
      sourceId: 'P1',
      questions: [
        {
          id: 'gq-1',
          sentence: 'A ___ is on the spine.',
          answers: ['x'],
          distractors: ['a', 'b'],
          order: 1,
          conceptSlugs: ['index'],
          critique: '{"verdict":"pass"}',
        },
      ],
      now: NOW,
    });
    const [bad] = await tg.cypher<{ n: number }>(
      `MATCH (p:Puzzle {origin: 'prompt'})-[:CONTAINS]->(q:Question)
       WHERE NOT (q)-[:GENERATED_FROM]->(:Source {kind: 'prompt'}) OR (q)-[:GROUNDED_IN]->(:Chunk) OR q.critique IS NULL
       RETURN count(q) AS n`,
    );
    expect(bad!.n).toBe(0);
    const [total] = await tg.cypher<{ n: number }>(
      `MATCH (:Puzzle {origin: 'prompt'})-[:CONTAINS]->(q:Question) RETURN count(q) AS n`,
    );
    expect(total!.n).toBe(1);
  });
});
