// Indexes, uniqueness constraints, and the vector index (contracts/internal-interfaces.md §2.7, data-model.md §1.4, §3.1).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GraphKit } from './client';
import { GraphKitError } from './errors';
import { defaultQueriesDir } from './loader';
import { assertNodeLabel, type NodeLabel } from './schema';

export interface SetupOptions {
  embeddingDim: number;
  rebuildVector?: boolean;
  /** How long to wait for a constraint to leave PENDING. Default 30_000. */
  constraintTimeoutMs?: number;
}

export interface SchemaItem {
  kind: 'range' | 'unique' | 'vector';
  label: NodeLabel;
  property: string;
}

export interface SetupReport {
  created: SchemaItem[];
  existing: SchemaItem[];
  /** Items the pinned server version cannot create, with the reason. */
  skipped: Array<SchemaItem & { reason: string }>;
  vectorIndex: { dimension: number; rebuilt: boolean; chunksWithEmbedding: number };
}

/** Uniqueness constraints (not Cypher; issued through the client). Each needs its range index first. */
const CONSTRAINTS: ReadonlyArray<{ label: NodeLabel; property: string }> = [
  { label: 'Learner', property: 'id' },
  { label: 'Concept', property: 'slug' },
];

const VECTOR_TARGET = { label: 'Chunk', property: 'embedding' } as const;
const DEFAULT_CONSTRAINT_TIMEOUT_MS = 30_000;
const CONSTRAINT_POLL_MS = 100;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function readSetupFile(name: string): string {
  return readFileSync(join(defaultQueriesDir(), 'setup', name), 'utf8');
}

/** The range indexes of queries/setup/010_range_indexes.cypher: one `CREATE INDEX FOR (n:L) ON (n.p)` per line. */
function rangeIndexStatements(): Array<{ item: SchemaItem; statement: string }> {
  const out: Array<{ item: SchemaItem; statement: string }> = [];
  for (const raw of readSetupFile('010_range_indexes.cypher').split(/\r?\n/)) {
    const statement = raw.trim();
    if (statement === '' || statement.startsWith('//')) continue;
    const match = /^CREATE INDEX FOR \(n:([A-Za-z]+)\) ON \(n\.([A-Za-z_]+)\)$/.exec(statement);
    if (!match) {
      throw new GraphKitError(
        'INVALID_QUERY_FILE',
        `010_range_indexes.cypher: cannot read "${statement}"`,
      );
    }
    assertNodeLabel(match[1]!);
    out.push({
      item: { kind: 'range', label: match[1] as NodeLabel, property: match[2]! },
      statement,
    });
  }
  return out;
}

interface IndexRow {
  label: string;
  properties: string[];
  types: Record<string, string[]>;
  options: Record<string, { dimension?: number }>;
}

function asLabel(value: unknown): NodeLabel | null {
  if (typeof value !== 'string') return null;
  try {
    assertNodeLabel(value);
    return value;
  } catch {
    return null;
  }
}

const sortItems = (items: SchemaItem[]): SchemaItem[] =>
  [...items].sort(
    (a, b) =>
      a.kind.localeCompare(b.kind) ||
      a.label.localeCompare(b.label) ||
      a.property.localeCompare(b.property),
  );

/** What exists now, without changing anything. */
export async function describeSchema(
  graph: GraphKit,
): Promise<{ items: SchemaItem[]; vectorDimension: number | null }> {
  const items: SchemaItem[] = [];
  let vectorDimension: number | null = null;

  const indexes = await graph.execute(
    'CALL db.indexes() YIELD label, properties, types, options RETURN label, properties, types, options',
    {},
    { readOnly: true },
  );
  for (const row of indexes.rows as unknown as IndexRow[]) {
    const label = asLabel(row.label); // an index on a label this package does not manage is ignored
    if (!label) continue;
    for (const property of row.properties ?? []) {
      const kinds = row.types?.[property] ?? [];
      if (kinds.includes('RANGE')) items.push({ kind: 'range', label, property });
      if (kinds.includes('VECTOR')) {
        items.push({ kind: 'vector', label, property });
        if (label === VECTOR_TARGET.label && property === VECTOR_TARGET.property) {
          const dimension = row.options?.[property]?.dimension;
          vectorDimension = typeof dimension === 'number' ? dimension : null;
        }
      }
    }
  }

  const constraints = await graph.execute(
    'CALL db.constraints() YIELD type, label, properties, status RETURN type, label, properties, status',
    {},
    { readOnly: true },
  );
  for (const row of constraints.rows as unknown as Array<{
    type: string;
    label: string;
    properties: string[];
    status: string;
  }>) {
    const label = asLabel(row.label);
    if (row.type !== 'UNIQUE' || !label) continue;
    for (const property of row.properties ?? []) items.push({ kind: 'unique', label, property });
  }

  return { items: sortItems(items), vectorDimension };
}

async function pollConstraints(graph: GraphKit, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { rows } = await graph.execute(
      'CALL db.constraints() YIELD type, label, properties, status RETURN type, label, properties, status',
      {},
      { readOnly: true },
    );
    const ours = (
      rows as unknown as Array<{ label: string; properties: string[]; status: string }>
    ).filter((row) =>
      CONSTRAINTS.some((c) => c.label === row.label && row.properties?.includes(c.property)),
    );
    const failed = ours.find((row) => row.status === 'FAILED');
    if (failed) {
      throw new GraphKitError(
        'QUERY_FAILED',
        `Constraint on ${failed.label}(${failed.properties.join(', ')}) FAILED: the graph already holds duplicate values`,
      );
    }
    if (ours.every((row) => row.status !== 'PENDING')) return;
    if (Date.now() >= deadline) {
      throw new GraphKitError('QUERY_TIMEOUT', `Constraints still PENDING after ${timeoutMs} ms`);
    }
    await sleep(CONSTRAINT_POLL_MS);
  }
}

async function countChunksWithEmbedding(graph: GraphKit): Promise<number> {
  const { rows } = await graph.execute(
    'MATCH (c:Chunk) WHERE c.embedding IS NOT NULL RETURN count(c) AS n',
    {},
    { readOnly: true },
  );
  return (rows[0]?.n as number | undefined) ?? 0;
}

const isAlreadyThere = (error: unknown): boolean =>
  error instanceof Error &&
  /already indexed|already exists/i.test(error.message + String(error.cause ?? ''));

/** Idempotent: a second call returns `created = []`. Range indexes first, then constraints, then the vector index. */
export async function setupGraph(graph: GraphKit, options: SetupOptions): Promise<SetupReport> {
  if (!Number.isInteger(options.embeddingDim) || options.embeddingDim < 1) {
    throw new GraphKitError(
      'INVALID_IDENTIFIER',
      `embeddingDim must be a positive integer, got ${options.embeddingDim}`,
    );
  }
  const created: SchemaItem[] = [];
  const existing: SchemaItem[] = [];
  const skipped: SetupReport['skipped'] = [];

  const before = await describeSchema(graph);
  const has = (item: SchemaItem) =>
    before.items.some(
      (i) => i.kind === item.kind && i.label === item.label && i.property === item.property,
    );

  // 1. Range indexes.
  for (const { item, statement } of rangeIndexStatements()) {
    if (has(item)) {
      existing.push(item);
      continue;
    }
    try {
      await graph.execute(statement);
      created.push(item);
    } catch (error) {
      if (!isAlreadyThere(error)) throw error;
      existing.push(item);
    }
  }

  // 2. Uniqueness constraints (created PENDING, then polled).
  let issued = false;
  for (const { label, property } of CONSTRAINTS) {
    const item: SchemaItem = { kind: 'unique', label, property };
    if (has(item)) {
      existing.push(item);
      continue;
    }
    try {
      await graph.createUniqueConstraint(label, property);
      issued = true;
      created.push(item);
    } catch (error) {
      if (!isAlreadyThere(error)) throw error;
      existing.push(item);
    }
  }
  if (issued)
    await pollConstraints(graph, options.constraintTimeoutMs ?? DEFAULT_CONSTRAINT_TIMEOUT_MS);

  // 3. Vector index.
  const vectorItem: SchemaItem = { kind: 'vector', ...VECTOR_TARGET };
  const vectorStatement = readSetupFile('020_vector_index.cypher').trim();
  let dimension = before.vectorDimension;
  let rebuilt = false;
  const vectorExists = has(vectorItem);
  if (vectorExists && options.rebuildVector) {
    await graph.execute('DROP VECTOR INDEX FOR (c:Chunk) ON (c.embedding)');
    rebuilt = true;
  }
  if (!vectorExists || rebuilt) {
    try {
      await graph.execute(vectorStatement, { dim: options.embeddingDim });
      dimension = options.embeddingDim;
      if (!rebuilt) created.push(vectorItem);
    } catch (error) {
      if (!isAlreadyThere(error)) throw error;
      existing.push(vectorItem);
    }
  } else {
    existing.push(vectorItem);
  }

  return {
    created: sortItems(created),
    existing: sortItems(existing),
    skipped,
    vectorIndex: {
      dimension: dimension ?? options.embeddingDim,
      rebuilt,
      chunksWithEmbedding: await countChunksWithEmbedding(graph),
    },
  };
}

/** Deletes the whole graph. Used by `reset` and the harness. */
export async function dropGraph(graph: GraphKit): Promise<void> {
  await graph.deleteGraph();
}
