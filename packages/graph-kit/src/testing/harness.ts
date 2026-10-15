// Test harness: every test file gets its own empty graph in the running FalkorDB (spec 002, contracts §3).
import { randomBytes } from 'node:crypto';
import { basename } from 'node:path';
import { afterAll, beforeAll, expect } from 'vitest';
import { GraphKit, type QueryParams } from '../client';
import { importGraph, type GraphFixture, type ImportReport } from '../fixture';
import { assertNodeLabel, assertRelType, type NodeLabel, type RelType } from '../schema';
import { readSeedDir } from '../seed/read';
import { seedToFixture } from '../seed/to-fixture';
import { validateSeed } from '../seed/validate';
import { setupGraph } from '../setup';

/** Default seed time for tests: 2026-10-11T12:00:00Z (data-model.md §5.6). */
export const DEFAULT_SEED_NOW = new Date('2026-10-11T12:00:00Z');

export interface TestGraphOptions {
  /** Run setupGraph (indexes, constraints, vector index). Default true. */
  setup?: boolean;
  /** Default 64 (matches the stub embeddings default). */
  embeddingDim?: number;
  /** Default: the real queries/ directory. */
  queriesDir?: string;
}

export interface TestGraph {
  /** Bound to a graph named test_<file>_<random>. */
  readonly graph: GraphKit;
  readonly name: string;
  load(fixture: GraphFixture): Promise<ImportReport>;
  /** readSeedDir, validateSeed, seedToFixture, importGraph. `now` defaults to 2026-10-11T12:00:00Z. */
  loadSeed(options?: { now?: Date; scenario?: boolean }): Promise<ImportReport>;
  /** Raw Cypher with bound parameters, for assertions and odd fixtures. Test code only. */
  cypher<T = Record<string, unknown>>(text: string, params?: QueryParams): Promise<T[]>;
  count(label: NodeLabel): Promise<number>;
  countEdges(type: RelType): Promise<number>;
  /** Delete all data, keep indexes. */
  clear(): Promise<void>;
  /** Delete the graph and close the connection. */
  dispose(): Promise<void>;
}

export const TEST_GRAPH_PREFIX = 'test_';

export function falkorConnectionFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const port = Number.parseInt(env.FALKORDB_PORT ?? '', 10);
  return {
    host: env.FALKORDB_HOST || 'localhost',
    port: Number.isFinite(port) ? port : 6379,
    ...(env.FALKORDB_USERNAME ? { username: env.FALKORDB_USERNAME } : {}),
    ...(env.FALKORDB_PASSWORD ? { password: env.FALKORDB_PASSWORD } : {}),
  };
}

/** `test_<test file base name>_<8 random hex>`; the file name is reduced to [a-z0-9_]. */
export function testGraphName(testPath: string | undefined): string {
  const base = basename(testPath ?? 'adhoc')
    .replace(/\.(spec|test)\.[cm]?[jt]sx?$/, '')
    .replace(/\.[cm]?[jt]sx?$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return `${TEST_GRAPH_PREFIX}${base || 'adhoc'}_${randomBytes(4).toString('hex')}`;
}

class TestGraphImpl implements TestGraph {
  constructor(
    readonly graph: GraphKit,
    readonly name: string,
  ) {}

  async cypher<T = Record<string, unknown>>(text: string, params: QueryParams = {}): Promise<T[]> {
    const { rows } = await this.graph.execute(text, params);
    return rows as T[];
  }

  load(fixture: GraphFixture): Promise<ImportReport> {
    return importGraph(this.graph, fixture);
  }

  async loadSeed(options: { now?: Date; scenario?: boolean } = {}): Promise<ImportReport> {
    const data = await readSeedDir();
    const issues = validateSeed(data);
    if (issues.length > 0) {
      throw new Error(
        `The seed is invalid:\n${issues.map((i) => `  ${i.file} ${i.path}: ${i.message}`).join('\n')}`,
      );
    }
    return importGraph(
      this.graph,
      seedToFixture(data, {
        now: options.now ?? DEFAULT_SEED_NOW,
        ...(options.scenario !== undefined ? { scenario: options.scenario } : {}),
      }),
    );
  }

  async count(label: NodeLabel): Promise<number> {
    assertNodeLabel(label);
    const rows = await this.cypher<{ c: number }>(`MATCH (n:${label}) RETURN count(n) AS c`);
    return rows[0]?.c ?? 0;
  }

  async countEdges(type: RelType): Promise<number> {
    assertRelType(type);
    const rows = await this.cypher<{ c: number }>(`MATCH ()-[r:${type}]->() RETURN count(r) AS c`);
    return rows[0]?.c ?? 0;
  }

  async clear(): Promise<void> {
    await this.cypher('MATCH (n) DETACH DELETE n');
  }

  async dispose(): Promise<void> {
    try {
      await this.graph.deleteGraph();
    } finally {
      await this.graph.close();
    }
  }
}

export async function createTestGraph(options: TestGraphOptions = {}): Promise<TestGraph> {
  const connection = falkorConnectionFromEnv();
  const name = testGraphName(expect.getState().testPath);
  const graph = await GraphKit.create({
    ...connection,
    graphName: name,
    ...(options.queriesDir ? { queriesDir: options.queriesDir } : {}),
  });

  const health = await graph.health();
  if (health.status !== 'ok') {
    await graph.close();
    throw new Error(
      `FalkorDB is not reachable at ${connection.host}:${connection.port}. ` +
        'Start the local stores with `make up`, or set FALKORDB_HOST and FALKORDB_PORT.' +
        (health.error ? ` (${health.error})` : ''),
    );
  }

  const testGraph = new TestGraphImpl(graph, name);
  // Writing to a missing graph creates it, so every test starts from an existing, empty graph.
  await testGraph.clear();

  if (options.setup ?? true) {
    try {
      await setupGraph(graph, { embeddingDim: options.embeddingDim ?? 64 });
    } catch (error) {
      await testGraph.dispose();
      throw error;
    }
  }
  return testGraph;
}

/** Registers beforeAll/afterAll in the current test file; the returned function gives the instance. */
export function useTestGraph(options: TestGraphOptions = {}): () => TestGraph {
  let current: TestGraph | undefined;
  beforeAll(async () => {
    current = await createTestGraph(options);
  });
  afterAll(async () => {
    const graph = current;
    current = undefined;
    await graph?.dispose();
  });
  return () => {
    if (!current)
      throw new Error('The test graph is only available inside tests and hooks after beforeAll');
    return current;
  };
}
