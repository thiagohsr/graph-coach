// Test helpers (entry `@coach/admin-kit/testing`): recording ports, two sample declarations, and the pure builders.
import type { AdminDeclaration } from './declaration';
import type { GraphPort, SqlPort } from './adapters/adapter';

export { buildGraphQueries, graphLinkQueryName, graphQueryName } from './adapters/graph.cypher';
export {
  buildSqlCount,
  buildSqlDetail,
  buildSqlList,
  buildSqlUpdate,
  likePattern,
} from './adapters/sql.builder';
export type { GeneratedGraphQuery } from './adapters/graph.cypher';
export type { BuiltSql } from './adapters/sql.builder';

type Rows = Record<string, unknown>[];

export interface RecordingGraphPort extends GraphPort {
  readonly registered: { name: string; cypher: string; mode: 'read' | 'write' }[];
  readonly calls: { name: string; params: Record<string, unknown> }[];
}

export interface RecordingSqlPort extends SqlPort {
  readonly calls: { text: string; params: readonly unknown[] }[];
}

/** Stores registered statements and every run (name and parameters); returns the canned rows for a name, else []. */
export function createRecordingGraphPort(
  canned: Record<string, Rows | ((params: Record<string, unknown>) => Rows)> = {},
): RecordingGraphPort {
  const registered: RecordingGraphPort['registered'] = [];
  const calls: RecordingGraphPort['calls'] = [];
  return {
    registered,
    calls,
    register(query) {
      registered.push({ ...query });
    },
    async run(name, params) {
      calls.push({ name, params });
      const reply = canned[name];
      return typeof reply === 'function' ? reply(params) : (reply ?? []);
    },
  };
}

/** Stores every executed text with its parameters; returns the canned rows (one reply per call, then the last) or []. */
export function createRecordingSqlPort(canned: Rows[] = []): RecordingSqlPort {
  const calls: RecordingSqlPort['calls'] = [];
  return {
    calls,
    async execute(text, params) {
      calls.push({ text, params });
      return canned[Math.min(calls.length - 1, canned.length - 1)] ?? [];
    },
  };
}

/** A graph declaration with a hyphenated slug, a searchable null-able text field, and three kinds of link. */
export const sampleGraphDeclaration: AdminDeclaration = {
  name: 'sample-concept',
  label: 'Sample concepts',
  group: 'Samples',
  source: 'graph',
  entity: 'Concept',
  listDisplay: ['name', 'slug', 'createdAt'],
  searchFields: ['slug', 'name', 'description'],
  fields: {
    id: { readonly: true },
    slug: { readonly: true },
    name: { type: 'string', required: true },
    description: { type: 'text' },
    createdAt: { type: 'datetime', readonly: true },
  },
  ordering: ['name'],
  links: [
    {
      kind: 'records',
      name: 'prerequisites',
      label: 'Prerequisites',
      rel: 'PREREQUISITE_OF',
      direction: 'in',
      targetLabel: 'Concept',
      titleProperty: 'name',
      model: 'sample-concept',
    },
    {
      kind: 'records',
      name: 'unlocks',
      label: 'Unlocks',
      rel: 'PREREQUISITE_OF',
      direction: 'out',
      targetLabel: 'Concept',
      titleProperty: 'name',
    },
    {
      kind: 'count',
      name: 'questionCount',
      label: 'Questions',
      rel: 'TESTS',
      direction: 'in',
      targetLabel: 'Question',
    },
    { kind: 'route', name: 'open', label: 'Open', href: '/concepts/:id' },
  ],
};

/** A sql declaration with an explicit column, an enum, a json field, a computed field, and an updated-at column. */
export const sampleSqlDeclaration: AdminDeclaration = {
  name: 'sample-item',
  label: 'Sample items',
  group: 'Samples',
  source: 'sql',
  entity: 'sample_items',
  listDisplay: ['title', 'status', 'createdAt'],
  searchFields: ['title'],
  fields: {
    id: { readonly: true },
    title: { type: 'string', required: true, column: 'item_title' },
    status: { type: 'enum', choices: ['open', 'closed'] },
    payload: { type: 'json' },
    size: { type: 'integer', min: 0, max: 10 },
    createdAt: { type: 'datetime', readonly: true, column: 'created_at' },
    updatedAt: { type: 'datetime', readonly: true, column: 'updated_at' },
    total: { type: 'integer', computed: true },
  },
  ordering: ['-createdAt'],
  updatedAtField: 'updatedAt',
  computeProvider: 'sample.total',
};
