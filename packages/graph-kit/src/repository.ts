// Single-node reads and writes (data-model.md §3.2). Labels and key names come from schema.ts only.
import type { z } from 'zod';
import type { CypherValue, GraphKit } from './client';
import { GraphKitError } from './errors';
import { assertNodeLabel, keyPropertyOf, type NodeLabel } from './schema';

export interface RepositoryOptions<T> {
  schema?: z.ZodType<T>;
}

export interface GraphRepository<T extends Record<string, CypherValue>> {
  /** Node properties by key (id, or name for Agent), or null. */
  find(key: string): Promise<T | null>;
  /** MERGE on the key, then set the given properties (others are left as they are). Returns all properties. */
  upsert(entity: T): Promise<T>;
  /** DETACH DELETE. Returns true if a node was deleted. */
  delete(key: string): Promise<boolean>;
}

export function createRepository<T extends Record<string, CypherValue>>(
  graph: GraphKit,
  label: NodeLabel,
  options: RepositoryOptions<T> = {},
): GraphRepository<T> {
  assertNodeLabel(label);
  const keyName = keyPropertyOf(label);

  const finish = (props: unknown): T => {
    if (!options.schema) return props as T;
    const parsed = options.schema.safeParse(props);
    if (!parsed.success) {
      throw new GraphKitError(
        'ROW_VALIDATION_FAILED',
        `${label} node failed validation at ${parsed.error.issues[0]?.path.join('.') || '(root)'}: ${parsed.error.issues[0]?.message ?? 'invalid'}`,
      );
    }
    return parsed.data;
  };

  return {
    async find(key) {
      const { rows } = await graph.execute(
        `MATCH (n:${label} {${keyName}: $key}) RETURN properties(n) AS props`,
        { key },
        { readOnly: true, queryName: `repository.find.${label}` },
      );
      return rows[0] ? finish(rows[0].props) : null;
    },

    async upsert(entity) {
      const key = entity[keyName];
      if (typeof key !== 'string' || key === '') {
        throw new GraphKitError('INVALID_IDENTIFIER', `${label} entity needs a non-empty "${keyName}" property`);
      }
      // A null inside a list is refused by the server (spike V6); drop them.
      const props: Record<string, CypherValue> = {};
      for (const [name, value] of Object.entries(entity)) {
        props[name] = Array.isArray(value) ? value.filter((item) => item !== null) : value;
      }
      const { rows } = await graph.execute(
        `MERGE (n:${label} {${keyName}: $key}) SET n += $props RETURN properties(n) AS props`,
        { key, props },
        { queryName: `repository.upsert.${label}` },
      );
      return finish(rows[0]?.props);
    },

    async delete(key) {
      const { stats } = await graph.execute(
        `MATCH (n:${label} {${keyName}: $key}) DETACH DELETE n`,
        { key },
        { queryName: `repository.delete.${label}` },
      );
      return stats.nodesDeleted > 0;
    },
  };
}
