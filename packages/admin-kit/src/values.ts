// Raw store values to the values the API returns (data-model.md section 2). Times are converted here and only here.
import type { AdminRecordDto, AdminValue } from '@coach/types';
import {
  assertResolved,
  fieldOf,
  storedFields,
  type ResolvedAdminModel,
  type ResolvedField,
} from './declaration';

export type AdminRow = Record<string, unknown>;

/** Epoch milliseconds (graph), Date (Postgres), or an ISO string to an ISO-8601 UTC string; anything else to null. */
export function toIsoString(value: unknown): string | null {
  let date: Date;
  if (value instanceof Date) date = value;
  else if (typeof value === 'number' || typeof value === 'bigint') date = new Date(Number(value));
  else if (typeof value === 'string' && value.trim() !== '') date = new Date(value);
  else return null;
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint')
    return String(value);
  return null;
}

/** Converts one raw value to the API form for the field's type. Missing values are null, never an error. */
export function toAdminValue(field: ResolvedField, raw: unknown): AdminValue {
  if (raw === undefined || raw === null) return null;
  switch (field.type) {
    case 'datetime':
      return toIsoString(raw);
    case 'integer':
    case 'number':
      return toNumber(raw);
    case 'boolean':
      return typeof raw === 'boolean' ? raw : null;
    case 'list':
      return Array.isArray(raw) ? raw.map((item) => String(item)) : null;
    case 'json':
      return raw as AdminValue;
    case 'string':
    case 'text':
    case 'enum':
      return toText(raw);
  }
}

/** list: only the `listDisplay` fields. all: every stored declared field (computed ones are merged in by the caller). */
export function toRecordDto(
  model: ResolvedAdminModel,
  row: AdminRow,
  fields: 'list' | 'all',
): AdminRecordDto {
  assertResolved(model);
  const idValue = toText(row[model.idField]) ?? '';
  const keys =
    fields === 'list'
      ? model.listDisplay.filter((key) => !model.fields[key]?.computed)
      : storedFields(model).map((field) => field.key);
  const values: Record<string, AdminValue> = {};
  for (const key of keys) {
    const field = fieldOf(model, key);
    if (field) values[key] = toAdminValue(field, row[key]);
  }
  const titleField = fieldOf(model, model.titleField);
  const title = titleField ? toAdminValue(titleField, row[model.titleField]) : null;
  return {
    id: idValue,
    title: typeof title === 'string' && title !== '' ? title : idValue,
    values,
  };
}
