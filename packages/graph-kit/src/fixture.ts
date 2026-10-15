// Bulk, idempotent import of nodes and edges (contracts/internal-interfaces.md §2.8, data-model.md §3.3).
import type { CypherValue, GraphKit, QueryStats } from './client';
import { GraphKitError } from './errors';
import {
  assertNodeLabel,
  assertRelType,
  keyPropertyOf,
  type NodeLabel,
  type RelType,
} from './schema';

export interface NodeRef {
  label: NodeLabel;
  key: string;
}

export interface FixtureNode extends NodeRef {
  /** The key property is added automatically. */
  props?: Record<string, CypherValue>;
  /** Property name to embedding. */
  vectors?: Record<string, number[]>;
  /** Default 'update'. */
  onMatch?: 'update' | 'keep';
}

export interface FixtureEdge {
  type: RelType;
  from: NodeRef;
  to: NodeRef;
  props?: Record<string, CypherValue>;
  /** Properties that distinguish parallel edges, e.g. ['blank'] for ANSWERED. Read from `props`. */
  keyProps?: string[];
  /** Default 'update'. */
  onMatch?: 'update' | 'keep';
}

export interface GraphFixture {
  nodes: FixtureNode[];
  edges: FixtureEdge[];
}

export interface ImportReport {
  nodesCreated: number;
  relationshipsCreated: number;
  propertiesSet: number;
}

const BATCH_SIZE = 500;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertIdentifier(value: string, what: string): void {
  if (!IDENTIFIER.test(value)) {
    throw new GraphKitError('INVALID_IDENTIFIER', `Invalid ${what} "${value}"`);
  }
}

/** A null inside a list is refused by the server (spike V6); drop them. Null-valued properties are left out. */
function cleanProps(props: Record<string, CypherValue> | undefined): Record<string, CypherValue> {
  const out: Record<string, CypherValue> = {};
  for (const [name, value] of Object.entries(props ?? {})) {
    if (value === null) continue;
    out[name] = Array.isArray(value) ? value.filter((item) => item !== null) : value;
  }
  return out;
}

function chunk<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) out.push(items.slice(i, i + BATCH_SIZE));
  return out;
}

function addStats(report: ImportReport, stats: QueryStats): void {
  report.nodesCreated += stats.nodesCreated;
  report.relationshipsCreated += stats.relationshipsCreated;
  report.propertiesSet += stats.propertiesSet;
}

function group<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = out.get(key);
    if (list) list.push(item);
    else out.set(key, [item]);
  }
  return out;
}

/** MERGE-based and idempotent. Throws INVALID_IDENTIFIER on an unknown label or type, QUERY_FAILED if an edge endpoint is missing. */
export async function importGraph(graph: GraphKit, fixture: GraphFixture): Promise<ImportReport> {
  // Validate every identifier before sending anything.
  for (const node of fixture.nodes) {
    assertNodeLabel(node.label);
    for (const prop of Object.keys(node.vectors ?? {})) assertIdentifier(prop, 'vector property');
  }
  for (const edge of fixture.edges) {
    assertRelType(edge.type);
    assertNodeLabel(edge.from.label);
    assertNodeLabel(edge.to.label);
    for (const prop of edge.keyProps ?? []) assertIdentifier(prop, 'key property');
  }

  const report: ImportReport = { nodesCreated: 0, relationshipsCreated: 0, propertiesSet: 0 };

  // Nodes, per label and mode.
  for (const nodes of group(fixture.nodes, (n) => `${n.label}|${n.onMatch ?? 'update'}`).values()) {
    const label = nodes[0]!.label;
    const keep = (nodes[0]!.onMatch ?? 'update') === 'keep';
    const keyName = keyPropertyOf(label);
    const create =
      `UNWIND $rows AS row MERGE (n:${label} {${keyName}: row.key}) ON CREATE SET n += row.props` +
      (keep ? '' : ' ON MATCH SET n += row.props');
    for (const batch of chunk(nodes)) {
      const rows = batch.map((n) => ({ key: n.key, props: cleanProps(n.props) }));
      addStats(report, (await graph.execute(create, { rows })).stats);
    }
    // Vector properties are set separately with vecf32() (a plain list would not be indexed).
    const withVectors = nodes.filter((n) => n.vectors && Object.keys(n.vectors).length > 0);
    const vectorProps = new Set(withVectors.flatMap((n) => Object.keys(n.vectors!)));
    for (const prop of vectorProps) {
      const rows = withVectors
        .filter((n) => n.vectors![prop] !== undefined)
        .map((n) => ({ key: n.key, vectors: { [prop]: n.vectors![prop]! } }));
      const set =
        `UNWIND $rows AS row MATCH (n:${label} {${keyName}: row.key})` +
        (keep ? ` WHERE n.${prop} IS NULL` : '') +
        ` SET n.${prop} = vecf32(row.vectors.${prop})`;
      for (const batch of chunk(rows)) addStats(report, (await graph.execute(set, { rows: batch })).stats);
    }
  }

  // Edges, per type, endpoint labels, key properties, and mode.
  const edgeGroups = group(
    fixture.edges,
    (e) =>
      [e.type, e.from.label, e.to.label, [...(e.keyProps ?? [])].sort().join(','), e.onMatch ?? 'update'].join('|'),
  );
  for (const edges of edgeGroups.values()) {
    const first = edges[0]!;
    const keyProps = [...(first.keyProps ?? [])].sort();
    const keep = (first.onMatch ?? 'update') === 'keep';
    const fromKey = keyPropertyOf(first.from.label);
    const toKey = keyPropertyOf(first.to.label);

    await assertEndpoints(graph, first.from.label, edges.map((e) => e.from.key));
    await assertEndpoints(graph, first.to.label, edges.map((e) => e.to.key));

    const pattern = keyProps.length
      ? `(a)-[r:${first.type} {${keyProps.map((p) => `${p}: row.keys.${p}`).join(', ')}}]->(b)`
      : `(a)-[r:${first.type}]->(b)`;
    const statement =
      `UNWIND $rows AS row MATCH (a:${first.from.label} {${fromKey}: row.from}), (b:${first.to.label} {${toKey}: row.to}) ` +
      `MERGE ${pattern} ON CREATE SET r += row.props` +
      (keep ? '' : ' ON MATCH SET r += row.props');
    for (const batch of chunk(edges)) {
      const rows = batch.map((e) => {
        const all = cleanProps(e.props);
        const keys: Record<string, CypherValue> = {};
        for (const prop of keyProps) {
          const value = all[prop];
          if (value === undefined) {
            throw new GraphKitError('INVALID_IDENTIFIER', `Edge ${e.type} lacks key property "${prop}"`);
          }
          keys[prop] = value;
        }
        return { from: e.from.key, to: e.to.key, keys, props: all };
      });
      addStats(report, (await graph.execute(statement, { rows })).stats);
    }
  }

  return report;
}

async function assertEndpoints(graph: GraphKit, label: NodeLabel, keys: string[]): Promise<void> {
  const distinct = [...new Set(keys)];
  const keyName = keyPropertyOf(label);
  let found = 0;
  for (const batch of chunk(distinct)) {
    const { rows } = await graph.execute(
      `UNWIND $keys AS k MATCH (n:${label} {${keyName}: k}) RETURN count(n) AS c`,
      { keys: batch },
      { readOnly: true },
    );
    found += (rows[0]?.c as number | undefined) ?? 0;
  }
  if (found < distinct.length) {
    throw new GraphKitError(
      'QUERY_FAILED',
      `Import: ${distinct.length - found} ${label} node(s) named by an edge do not exist`,
    );
  }
}
