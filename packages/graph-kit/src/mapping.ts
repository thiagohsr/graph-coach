// Converts FalkorDB client values (spike S1 result shapes) to plain objects. No import from `falkordb` here:
// the shapes below are the client's documented result shapes, matched structurally.

export interface GraphNode {
  internalId: number;
  labels: string[];
  props: Record<string, unknown>;
}

export interface GraphEdge {
  internalId: number;
  type: string;
  fromInternalId: number;
  toInternalId: number;
  props: Record<string, unknown>;
}

export interface GraphPath {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

type Plain = Record<string, unknown>;

function isPlainObject(value: unknown): value is Plain {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

const hasOnly = (value: Plain, keys: string[]): boolean =>
  Object.keys(value).every((k) => keys.includes(k));

function isClientNode(value: Plain): boolean {
  return (
    typeof value.id === 'number' &&
    Array.isArray(value.labels) &&
    isPlainObject(value.properties) &&
    hasOnly(value, ['id', 'labels', 'properties'])
  );
}

function isClientEdge(value: Plain): boolean {
  return (
    typeof value.id === 'number' &&
    typeof value.relationshipType === 'string' &&
    typeof value.sourceId === 'number' &&
    typeof value.destinationId === 'number' &&
    isPlainObject(value.properties) &&
    hasOnly(value, ['id', 'relationshipType', 'sourceId', 'destinationId', 'properties'])
  );
}

function isClientPath(value: Plain): boolean {
  return (
    Array.isArray(value.nodes) &&
    Array.isArray(value.edges) &&
    hasOnly(value, ['nodes', 'edges']) &&
    value.nodes.every((n) => isPlainObject(n) && isClientNode(n)) &&
    value.edges.every((e) => isPlainObject(e) && isClientEdge(e))
  );
}

function mapProps(props: Plain): Plain {
  const out: Plain = {};
  for (const [key, value] of Object.entries(props)) out[key] = mapValue(value);
  return out;
}

function mapNode(node: Plain): GraphNode {
  return {
    internalId: node.id as number,
    labels: [...(node.labels as string[])],
    props: mapProps(node.properties as Plain),
  };
}

function mapEdge(edge: Plain): GraphEdge {
  return {
    internalId: edge.id as number,
    type: edge.relationshipType as string,
    fromInternalId: edge.sourceId as number,
    toInternalId: edge.destinationId as number,
    props: mapProps(edge.properties as Plain),
  };
}

/** Maps one client value: scalars stay, lists and maps recurse, nodes, relationships, paths, and vectors are converted. */
export function mapValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value !== 'object') return value;
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return Array.from(value as unknown as ArrayLike<number>, Number);
  }
  if (Array.isArray(value)) return value.map(mapValue);
  if (value instanceof Date) return value.getTime();
  if (isPlainObject(value)) {
    if (isClientPath(value)) {
      return {
        nodes: (value.nodes as Plain[]).map(mapNode),
        edges: (value.edges as Plain[]).map(mapEdge),
      } satisfies GraphPath;
    }
    if (isClientNode(value)) return mapNode(value);
    if (isClientEdge(value)) return mapEdge(value);
    const out: Plain = {};
    for (const [key, inner] of Object.entries(value)) out[key] = mapValue(inner);
    return out;
  }
  return value;
}

/** Converts one result row (an object keyed by column alias) to a plain object. */
export function mapRow(row: Plain): Plain {
  const out: Plain = {};
  for (const [key, value] of Object.entries(row)) out[key] = mapValue(value);
  return out;
}
