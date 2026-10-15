// Update validation (contracts/admin-kit-package.md section 4). Pure; reports every failing field.
import type { AdminIssueCode, AdminValidationDetails, AdminValue } from '@coach/types';
import { assertResolved, fieldOf, type ResolvedAdminModel, type ResolvedField } from './declaration';
import {
  ADMIN_JSON_MAX_LENGTH,
  ADMIN_LIST_ITEM_MAX_LENGTH,
  ADMIN_LIST_MAX_ITEMS,
  ADMIN_STRING_MAX_LENGTH,
  ADMIN_TEXT_MAX_LENGTH,
} from './limits';

export type UpdateValidation =
  | { ok: true; changes: Record<string, AdminValue> }
  | { ok: false; details: AdminValidationDetails };

type Issue = AdminValidationDetails['issues'][number];

const MAX_PATH_KEY = 64;

function pathOf(key: string): string {
  return `values.${key.length > MAX_PATH_KEY ? `${key.slice(0, MAX_PATH_KEY)}...` : key}`;
}

function isJson(value: unknown, depth = 0): boolean {
  if (depth > 20) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJson(item, depth + 1));
  if (typeof value === 'object') return Object.values(value as object).every((item) => isJson(item, depth + 1));
  return false;
}

/** Returns an issue for a bad value, or null with `store` set to the value to write. */
function checkValue(field: ResolvedField, value: unknown): { issue: { code: AdminIssueCode; message: string } } | { value: AdminValue } {
  const label = field.label;
  const invalid = (what: string) => ({ issue: { code: 'invalid_type' as const, message: `${label} must be ${what}.` } });

  if (value === null) {
    if (field.required) return { issue: { code: 'required', message: `${label} is required.` } };
    return { value: null };
  }

  switch (field.type) {
    case 'string':
    case 'text': {
      if (typeof value !== 'string') return invalid('a string');
      if (field.required && value === '') return { issue: { code: 'required', message: `${label} is required.` } };
      const max = field.maxLength ?? (field.type === 'string' ? ADMIN_STRING_MAX_LENGTH : ADMIN_TEXT_MAX_LENGTH);
      if (value.length > max) return { issue: { code: 'too_long', message: `${label} is longer than ${max} characters.` } };
      return { value };
    }
    case 'integer': {
      if (typeof value !== 'number' || !Number.isSafeInteger(value)) return invalid('an integer');
      return rangeCheck(field, value);
    }
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return invalid('a number');
      return rangeCheck(field, value);
    }
    case 'boolean': {
      if (typeof value !== 'boolean') return invalid('true or false');
      return { value };
    }
    case 'enum': {
      if (typeof value !== 'string') return invalid('a string');
      if (field.required && value === '') return { issue: { code: 'required', message: `${label} is required.` } };
      if (!field.choices?.includes(value)) {
        return { issue: { code: 'invalid_choice', message: `${label} must be one of: ${(field.choices ?? []).join(', ')}.` } };
      }
      return { value };
    }
    case 'list': {
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return invalid('a list of strings');
      if (field.required && value.length === 0) return { issue: { code: 'required', message: `${label} is required.` } };
      if (value.length > ADMIN_LIST_MAX_ITEMS) {
        return { issue: { code: 'too_long', message: `${label} has more than ${ADMIN_LIST_MAX_ITEMS} items.` } };
      }
      if (value.some((item: string) => item.length > ADMIN_LIST_ITEM_MAX_LENGTH)) {
        return { issue: { code: 'too_long', message: `${label} has an item longer than ${ADMIN_LIST_ITEM_MAX_LENGTH} characters.` } };
      }
      return { value: value as string[] };
    }
    case 'json': {
      if (!isJson(value)) return invalid('a JSON value');
      const max = field.maxLength ?? ADMIN_JSON_MAX_LENGTH;
      if (JSON.stringify(value).length > max) {
        return { issue: { code: 'too_long', message: `${label} is longer than ${max} characters.` } };
      }
      return { value: value as AdminValue };
    }
    case 'datetime':
      return { issue: { code: 'read_only', message: `${label} cannot be changed.` } };
  }
}

function rangeCheck(field: ResolvedField, value: number) {
  if (field.min !== undefined && value < field.min) {
    return { issue: { code: 'out_of_range' as const, message: `${field.label} must be at least ${field.min}.` } };
  }
  if (field.max !== undefined && value > field.max) {
    return { issue: { code: 'out_of_range' as const, message: `${field.label} must be at most ${field.max}.` } };
  }
  return { value };
}

/**
 * Checks `values` against the declaration. `changes` holds only declared, editable keys, in declaration order; it is built
 * by iterating the declaration, never the input. A read-only model answers `read_only` for every declared key (the caller
 * answers 405 before this).
 */
export function validateUpdate(model: ResolvedAdminModel, values: Record<string, unknown>): UpdateValidation {
  assertResolved(model);
  const issues: Issue[] = [];
  const accepted = new Map<string, AdminValue>();

  for (const key of Object.keys(values)) {
    const field = fieldOf(model, key);
    if (!field) {
      issues.push({ path: pathOf(key), message: 'Unknown field.', code: 'unknown_field' });
      continue;
    }
    if (model.readOnly || field.readonly || field.computed) {
      issues.push({ path: pathOf(key), message: `${field.label} cannot be changed.`, code: 'read_only' });
      continue;
    }
    const checked = checkValue(field, values[key]);
    if ('issue' in checked) issues.push({ path: pathOf(key), message: checked.issue.message, code: checked.issue.code });
    else accepted.set(key, checked.value);
  }

  if (issues.length > 0) return { ok: false, details: { issues } };

  const changes: Record<string, AdminValue> = {};
  for (const key of model.fieldKeys) {
    if (accepted.has(key)) changes[key] = accepted.get(key)!;
  }
  return { ok: true, changes };
}
