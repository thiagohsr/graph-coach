// Generated Cypher (data-model.md section 7). One set of statements per graph model, generated once at start-up from the
// validated declaration. Identifiers come only from the declaration; every request value is a $parameter.
import {
  assertResolved,
  editableFields,
  storedFields,
  type AdminCountLink,
  type AdminRecordsLink,
  type ResolvedAdminModel,
} from '../declaration';
import { assertIdentifier, queryNameSegment } from '../identifiers';

export interface GeneratedGraphQuery {
  name: string;
  cypher: string;
  mode: 'read' | 'write';
}

export type GraphOperation =
  'list' | 'list_search' | 'count' | 'count_search' | 'detail' | 'update';

/** `admin_<model>_<operation>`, with the slug's `-` turned into `_`. */
export function graphQueryName(model: ResolvedAdminModel, operation: GraphOperation): string {
  return `admin_${queryNameSegment(model.name)}_${operation}`;
}

/** `admin_<model>_link_<link>`, with the link name converted from camelCase to lower snake case. */
export function graphLinkQueryName(model: ResolvedAdminModel, linkName: string): string {
  return `admin_${queryNameSegment(model.name)}_link_${queryNameSegment(linkName)}`;
}

const prop = (key: string) => `n.${assertIdentifier('property', key)}`;

function returnClause(keys: readonly string[]): string {
  return `RETURN ${keys.map((key) => `${prop(key)} AS ${assertIdentifier('property', key)}`).join(', ')}`;
}

function uniqueKeys(keys: readonly string[]): string[] {
  return [...new Set(keys)];
}

function orderClause(model: ResolvedAdminModel): string {
  const entries = model.ordering.map((entry) => {
    const desc = entry.startsWith('-');
    return `${prop(desc ? entry.slice(1) : entry)} ${desc ? 'DESC' : 'ASC'}`;
  });
  const idEntry = `${prop(model.idField)} ASC`;
  if (!entries.includes(idEntry) && !entries.includes(`${prop(model.idField)} DESC`))
    entries.push(idEntry);
  return `ORDER BY ${entries.join(', ')}`;
}

function searchClause(model: ResolvedAdminModel): string {
  return `WHERE ${model.searchFields.map((key) => `toLower(${prop(key)}) CONTAINS $search`).join(' OR ')}`;
}

function nodePattern(model: ResolvedAdminModel): string {
  return `(n:${assertIdentifier('label', model.entity)} {${assertIdentifier('property', model.idField)}: $id})`;
}

function relPattern(link: AdminRecordsLink | AdminCountLink): string {
  const rel = assertIdentifier('rel', link.rel);
  return link.direction === 'out' ? `-[:${rel}]->` : `<-[:${rel}]-`;
}

function listQuery(model: ResolvedAdminModel, search: boolean): string {
  const keys = uniqueKeys([model.idField, ...model.listDisplay, model.titleField]).filter(
    (key) => !model.fields[key]?.computed,
  );
  return [
    `MATCH (n:${assertIdentifier('label', model.entity)})`,
    ...(search ? [searchClause(model)] : []),
    returnClause(keys),
    orderClause(model),
    'SKIP $skip LIMIT $limit',
  ].join('\n');
}

function countQuery(model: ResolvedAdminModel, search: boolean): string {
  return [
    `MATCH (n:${assertIdentifier('label', model.entity)})`,
    ...(search ? [searchClause(model)] : []),
    'RETURN count(n) AS total',
  ].join('\n');
}

function storedKeys(model: ResolvedAdminModel): string[] {
  return storedFields(model).map((field) => field.key);
}

function detailQuery(model: ResolvedAdminModel): string {
  return [`MATCH ${nodePattern(model)}`, returnClause(storedKeys(model)), 'LIMIT 1'].join('\n');
}

function updateQuery(model: ResolvedAdminModel): string {
  return [`MATCH ${nodePattern(model)}`, 'SET n += $props', returnClause(storedKeys(model))].join(
    '\n',
  );
}

function linkQuery(model: ResolvedAdminModel, link: AdminRecordsLink | AdminCountLink): string {
  const target = assertIdentifier('label', link.targetLabel);
  const match = `MATCH ${nodePattern(model)}${relPattern(link)}(m:${target})`;
  if (link.kind === 'count') return [match, 'RETURN count(m) AS total'].join('\n');
  const title = assertIdentifier('property', link.titleProperty);
  return [
    match,
    `RETURN m.id AS id, m.${title} AS title`,
    'ORDER BY m.id ASC',
    'LIMIT $limit',
  ].join('\n');
}

/** Every statement the adapter registers for one graph model. Takes only resolved, validated models. */
export function buildGraphQueries(model: ResolvedAdminModel): GeneratedGraphQuery[] {
  assertResolved(model);
  if (model.source !== 'graph') throw new Error(`Model ${model.name} is not a graph model`);
  const queries: GeneratedGraphQuery[] = [
    { name: graphQueryName(model, 'list'), cypher: listQuery(model, false), mode: 'read' },
    { name: graphQueryName(model, 'count'), cypher: countQuery(model, false), mode: 'read' },
  ];
  if (model.searchFields.length > 0) {
    queries.push(
      { name: graphQueryName(model, 'list_search'), cypher: listQuery(model, true), mode: 'read' },
      {
        name: graphQueryName(model, 'count_search'),
        cypher: countQuery(model, true),
        mode: 'read',
      },
    );
  }
  queries.push({ name: graphQueryName(model, 'detail'), cypher: detailQuery(model), mode: 'read' });
  if (!model.readOnly && editableFields(model).length > 0) {
    queries.push({
      name: graphQueryName(model, 'update'),
      cypher: updateQuery(model),
      mode: 'write',
    });
  }
  for (const link of model.links) {
    if (link.kind === 'route') continue;
    queries.push({
      name: graphLinkQueryName(model, link.name),
      cypher: linkQuery(model, link),
      mode: 'read',
    });
  }
  return queries;
}
