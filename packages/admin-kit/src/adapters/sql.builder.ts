// Generated SQL (data-model.md section 8). Built per request from the validated declaration: identifiers are the
// declared table and column names, double-quoted; values are positional parameters.
import {
  assertResolved,
  editableFields,
  sqlColumnOf,
  storedFields,
  type ResolvedAdminModel,
  type ResolvedField,
} from '../declaration';
import { assertIdentifier } from '../identifiers';
import type { AdminValue } from '@coach/types';

export interface BuiltSql {
  text: string;
  params: unknown[];
}

const quote = (name: string) => `"${assertIdentifier('sql', name)}"`;
const columnOf = (field: ResolvedField) => quote(sqlColumnOf(field));

function sqlModel(model: ResolvedAdminModel): ResolvedAdminModel {
  assertResolved(model);
  if (model.source !== 'sql') throw new Error(`Model ${model.name} is not a sql model`);
  return model;
}

/** Escapes `\`, `%`, and `_` so the term is matched literally, then wraps it in `%...%`. */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function selectColumns(model: ResolvedAdminModel, keys: readonly string[]): string {
  return keys.map((key) => columnOf(model.fields[key]!)).join(', ');
}

function listKeys(model: ResolvedAdminModel): string[] {
  return [...new Set([model.idField, ...model.listDisplay, model.titleField])].filter(
    (key) => !model.fields[key]?.computed,
  );
}

function searchWhere(model: ResolvedAdminModel, placeholder: string): string {
  return `WHERE ${model.searchFields
    .map((key) => `${columnOf(model.fields[key]!)}::text ILIKE ${placeholder} ESCAPE '\\'`)
    .join(' OR ')}`;
}

function orderBy(model: ResolvedAdminModel): string {
  const parts = model.ordering.map((entry) => {
    const desc = entry.startsWith('-');
    return `${columnOf(model.fields[desc ? entry.slice(1) : entry]!)} ${desc ? 'DESC' : 'ASC'}`;
  });
  const idColumn = columnOf(model.fields[model.idField]!);
  if (!parts.includes(`${idColumn} ASC`) && !parts.includes(`${idColumn} DESC`)) parts.push(`${idColumn} ASC`);
  return `ORDER BY ${parts.join(', ')}`;
}

export function buildSqlList(
  model: ResolvedAdminModel,
  params: { search?: string; page: number; pageSize: number },
): BuiltSql {
  sqlModel(model);
  const search = params.search !== undefined && params.search !== '' && model.searchFields.length > 0;
  const values: unknown[] = [];
  const lines = [`SELECT ${selectColumns(model, listKeys(model))} FROM ${quote(model.entity)}`];
  if (search) {
    values.push(likePattern(params.search!));
    lines.push(searchWhere(model, '$1'));
  }
  lines.push(orderBy(model));
  values.push(params.pageSize, (params.page - 1) * params.pageSize);
  lines.push(`LIMIT $${values.length - 1} OFFSET $${values.length}`);
  return { text: lines.join('\n'), params: values };
}

export function buildSqlCount(model: ResolvedAdminModel, params: { search?: string }): BuiltSql {
  sqlModel(model);
  const search = params.search !== undefined && params.search !== '' && model.searchFields.length > 0;
  const lines = [`SELECT count(*)::int AS total FROM ${quote(model.entity)}`];
  const values: unknown[] = [];
  if (search) {
    values.push(likePattern(params.search!));
    lines.push(searchWhere(model, '$1'));
  }
  return { text: lines.join('\n'), params: values };
}

function storedKeys(model: ResolvedAdminModel): string[] {
  return storedFields(model).map((field) => field.key);
}

export function buildSqlDetail(model: ResolvedAdminModel, id: string): BuiltSql {
  sqlModel(model);
  const idColumn = columnOf(model.fields[model.idField]!);
  return {
    text: [
      `SELECT ${selectColumns(model, storedKeys(model))} FROM ${quote(model.entity)}`,
      `WHERE ${idColumn}::text = $1 LIMIT 1`,
    ].join('\n'),
    params: [id],
  };
}

/** One assignment per editable field present in `changes`, in declaration order. Returns null when nothing is assigned. */
export function buildSqlUpdate(
  model: ResolvedAdminModel,
  id: string,
  changes: Record<string, AdminValue>,
): BuiltSql | null {
  sqlModel(model);
  const assignments: string[] = [];
  const values: unknown[] = [];
  for (const field of editableFields(model)) {
    if (!Object.hasOwn(changes, field.key)) continue;
    const value = changes[field.key];
    if (field.type === 'json') {
      values.push(JSON.stringify(value ?? null));
      assignments.push(`${columnOf(field)} = $${values.length}::jsonb`);
    } else {
      values.push(value);
      assignments.push(`${columnOf(field)} = $${values.length}`);
    }
  }
  if (assignments.length === 0) return null;
  if (model.updatedAtField !== undefined) {
    assignments.push(`${columnOf(model.fields[model.updatedAtField]!)} = now()`);
  }
  values.push(id);
  const idColumn = columnOf(model.fields[model.idField]!);
  return {
    text: [
      `UPDATE ${quote(model.entity)} SET ${assignments.join(', ')}`,
      `WHERE ${idColumn}::text = $${values.length}`,
      `RETURNING ${selectColumns(model, storedKeys(model))}`,
    ].join('\n'),
    params: values,
  };
}
