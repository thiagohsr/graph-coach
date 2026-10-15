import type { GraphPort, SqlPort } from '@coach/admin-kit';
import type { GraphKit, QueryParams } from '@coach/graph-kit';
import type { SqlClient } from '../../common/db/db.module';

/** Injection token: the two store ports of the admin kit. */
export const ADMIN_PORTS = Symbol('ADMIN_PORTS');

export interface AdminPorts {
  graph: GraphPort;
  sql: SqlPort;
}

/**
 * The only code that knows the `defineQuery` signature. Store errors are not caught: `GraphUnavailableError` reaches the
 * platform filter, which answers 503 GRAPH_UNAVAILABLE. A name registered twice with different text fails with
 * DUPLICATE_QUERY and stops start-up.
 */
export function createGraphPort(graph: GraphKit): GraphPort {
  return {
    register(query) {
      graph.defineQuery({ name: query.name, cypher: query.cypher, mode: query.mode, owner: '006' });
    },
    run(name, params) {
      return graph.query(name, params as QueryParams);
    },
  };
}

/**
 * Executes text with positional parameters on the postgres.js client that backs the injected `DB` (the `SQL_CLIENT`
 * token). Connection errors pass through to the platform filter (503 SQL_UNAVAILABLE).
 */
export function createSqlPort(client: SqlClient): SqlPort {
  return {
    async execute(text, params) {
      const rows = await client.unsafe(text, params as Parameters<SqlClient['unsafe']>[1]);
      return Array.from(rows) as Record<string, unknown>[];
    },
  };
}
