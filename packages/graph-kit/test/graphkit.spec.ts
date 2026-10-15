import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  GraphKitError,
  typedQuery,
  type GraphEdge,
  type GraphNode,
  type GraphPath,
} from '../src/index';
import { createTestGraph, type TestGraph } from '../src/testing';

const queries: Record<string, string> = {
  demo_concepts: `// name: demo_concepts
// owner: 002
// mode: read
MATCH (c:Concept) WHERE c.score < $max RETURN c.id AS id, c.score AS score ORDER BY c.score`,
  demo_store_note: `// name: demo_store_note
// owner: 002
// mode: write
MERGE (c:Concept {id: $id}) SET c.note = $note RETURN c.note AS note`,
  demo_read_that_writes: `// name: demo_read_that_writes
// owner: 002
// mode: read
CREATE (c:Concept {id: 'sneaky'}) RETURN c.id AS id`,
  demo_shapes: `// name: demo_shapes
// owner: 002
// mode: read
MATCH p = (a:Concept {id: 'a'})-[r:PREREQUISITE_OF]->(b:Concept) RETURN a, r, p`,
};

let dir: string;
let tg: TestGraph;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'graph-kit-queries-'));
  for (const [name, text] of Object.entries(queries)) writeFileSync(join(dir, `${name}.cypher`), text);
  tg = await createTestGraph({ queriesDir: dir });
});

afterAll(async () => {
  await tg?.dispose();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await tg.clear();
  await tg.cypher(
    `CREATE (:Concept {id: 'a', score: 1}), (:Concept {id: 'b', score: 3}), (:Concept {id: 'c', score: 2})`,
  );
});

async function failure(promise: Promise<unknown>): Promise<GraphKitError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(GraphKitError);
    return error as GraphKitError;
  }
  throw new Error('expected the call to fail');
}

describe('query', () => {
  it('returns plain row objects keyed by alias', async () => {
    const rows = await tg.graph.query<{ id: string; score: number }>('demo_concepts', { max: 3 });
    expect(rows).toEqual([
      { id: 'a', score: 1 },
      { id: 'c', score: 2 },
    ]);
  });

  it('rejects a row of the wrong shape with ROW_VALIDATION_FAILED naming the query', async () => {
    const error = await failure(
      tg.graph.query('demo_concepts', { max: 3 }, { schema: z.object({ id: z.number() }) }),
    );
    expect(error.code).toBe('ROW_VALIDATION_FAILED');
    expect(error.message).toContain('demo_concepts');
  });

  it('parses rows with a schema when they match', async () => {
    const rows = await tg.graph.query('demo_concepts', { max: 3 }, { schema: z.object({ id: z.string(), score: z.number() }) });
    expect(rows).toHaveLength(2);
  });

  it('fails with UNKNOWN_QUERY and the name', async () => {
    const error = await failure(tg.graph.query('no_such_query'));
    expect(error.code).toBe('UNKNOWN_QUERY');
    expect(error.message).toContain('no_such_query');
  });

  it('fails with MISSING_PARAM naming the query and the parameter', async () => {
    const error = await failure(tg.graph.query('demo_concepts', {}));
    expect(error.code).toBe('MISSING_PARAM');
    expect(error.message).toContain('demo_concepts');
    expect(error.message).toContain('$max');
    const undef = await failure(tg.graph.query('demo_concepts', { max: undefined as never }));
    expect(undef.code).toBe('MISSING_PARAM');
  });

  it('fails with UNEXPECTED_PARAM for a key the file does not use', async () => {
    const error = await failure(tg.graph.query('demo_concepts', { max: 3, extra: 1 }));
    expect(error.code).toBe('UNEXPECTED_PARAM');
    expect(error.message).toContain('$extra');
  });

  it('binds parameters: quotes and Cypher text are stored and returned unchanged', async () => {
    const note = `it's "quoted" }) DETACH DELETE n // MATCH (n) RETURN n`;
    const rows = await tg.graph.query<{ note: string }>('demo_store_note', { id: 'a', note });
    expect(rows[0]!.note).toBe(note);
    expect(await tg.count('Concept')).toBe(3);
  });

  it('refuses a write from a mode: read file', async () => {
    const error = await failure(tg.graph.query('demo_read_that_writes'));
    expect(error.code).toBe('QUERY_FAILED');
    expect(await tg.count('Concept')).toBe(3);
  });

  it('maps a node, a relationship, and a path', async () => {
    await tg.cypher(`MATCH (a:Concept {id: 'a'}), (b:Concept {id: 'b'}) CREATE (a)-[:PREREQUISITE_OF {weight: 2}]->(b)`);
    const [row] = await tg.graph.query<{ a: GraphNode; r: GraphEdge; p: GraphPath }>('demo_shapes');
    expect(row!.a.labels).toEqual(['Concept']);
    expect(row!.a.props.id).toBe('a');
    expect(row!.r.type).toBe('PREREQUISITE_OF');
    expect(row!.r.props.weight).toBe(2);
    expect(row!.p.nodes).toHaveLength(2);
    expect(row!.p.edges).toHaveLength(1);
  });
});

describe('queryOne and queryWithStats', () => {
  it('queryOne returns the first row, null for none, and fails for several', async () => {
    expect(await tg.graph.queryOne('demo_concepts', { max: 2 })).toEqual({ id: 'a', score: 1 });
    expect(await tg.graph.queryOne('demo_concepts', { max: 0 })).toBeNull();
    const error = await failure(tg.graph.queryOne('demo_concepts', { max: 10 }));
    expect(error.code).toBe('QUERY_FAILED');
  });

  it('queryWithStats reports nodesCreated', async () => {
    const { rows, stats } = await tg.graph.queryWithStats('demo_store_note', { id: 'new', note: 'n' });
    expect(rows).toHaveLength(1);
    expect(stats.nodesCreated).toBe(1);
    expect(stats.propertiesSet).toBeGreaterThanOrEqual(1);
  });
});

describe('typedQuery', () => {
  it('typedQuery + run / runOne return validated rows', async () => {
    const def = typedQuery<{ max: number }, { id: string; score: number }>(
      'demo_concepts',
      z.object({ id: z.string(), score: z.number() }),
    );
    expect(await tg.graph.run(def, { max: 3 })).toHaveLength(2);
    expect(await tg.graph.runOne(def, { max: 2 })).toEqual({ id: 'a', score: 1 });
    const wrong = typedQuery<{ max: number }, { id: number }>('demo_concepts', z.object({ id: z.number() }));
    expect((await failure(tg.graph.run(wrong, { max: 3 }))).code).toBe('ROW_VALIDATION_FAILED');
  });
});

describe('generated queries', () => {
  const cypher = 'MATCH (c:Concept) WHERE c.score >= $min RETURN c.id AS id ORDER BY id';

  it('defineQuery makes the name callable with the same parameter checks and lists it as generated', async () => {
    const def = tg.graph.defineQuery({ name: 'admin_concept_list', cypher, mode: 'read' });
    expect(def.name).toBe('admin_concept_list');
    expect(await tg.graph.query('admin_concept_list', { min: 2 })).toEqual([{ id: 'b' }, { id: 'c' }]);
    expect((await failure(tg.graph.query('admin_concept_list', {}))).code).toBe('MISSING_PARAM');
    expect((await failure(tg.graph.query('admin_concept_list', { min: 1, z: 1 }))).code).toBe('UNEXPECTED_PARAM');
    const info = tg.graph.listQueries().find((q) => q.name === 'admin_concept_list');
    expect(info).toMatchObject({ source: 'generated', mode: 'read', params: ['min'] });
    expect(tg.graph.listQueries().find((q) => q.name === 'demo_concepts')).toMatchObject({
      source: 'file',
      file: 'demo_concepts.cypher',
    });
  });

  it('registerQuery is an alias; identical text is a no-op, different text is DUPLICATE_QUERY', () => {
    tg.graph.registerQuery({ name: 'admin_concept_alias', cypher, mode: 'read' });
    expect(() => tg.graph.registerQuery({ name: 'admin_concept_alias', cypher, mode: 'read' })).not.toThrow();
    try {
      tg.graph.registerQuery({ name: 'admin_concept_alias', cypher: `${cypher} LIMIT 1`, mode: 'read' });
      throw new Error('expected DUPLICATE_QUERY');
    } catch (error) {
      expect((error as GraphKitError).code).toBe('DUPLICATE_QUERY');
    }
  });

  it('refuses a name that is not admin_<model>_<operation>', () => {
    for (const name of ['concept_list', 'admin_concept', 'Admin_concept_list', 'admin_concept_List']) {
      try {
        tg.graph.defineQuery({ name, cypher, mode: 'read' });
        throw new Error(`expected INVALID_QUERY_FILE for ${name}`);
      } catch (error) {
        expect((error as GraphKitError).code).toBe('INVALID_QUERY_FILE');
      }
    }
  });
});
