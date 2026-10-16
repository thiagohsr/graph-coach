// Metadata returned to the UI (data-model.md section 5). Pure; omits entity, columns, relationships, and hooks.
import type {
  AdminAction,
  AdminFieldMeta,
  AdminLinkMeta,
  AdminModelMeta,
  AdminRecordDto,
} from '@coach/types';
import { assertResolved, type ResolvedAdminModel, type ResolvedField } from './declaration';
import {
  ADMIN_JSON_MAX_LENGTH,
  ADMIN_MAX_PAGE_SIZE,
  ADMIN_MAX_SEARCH_LENGTH,
  ADMIN_STRING_MAX_LENGTH,
  ADMIN_TEXT_MAX_LENGTH,
} from './limits';

function effectiveMaxLength(field: ResolvedField, editable: boolean): number | undefined {
  if (field.maxLength !== undefined) return field.maxLength;
  if (!editable) return undefined;
  if (field.type === 'string') return ADMIN_STRING_MAX_LENGTH;
  if (field.type === 'text') return ADMIN_TEXT_MAX_LENGTH;
  if (field.type === 'json') return ADMIN_JSON_MAX_LENGTH;
  return undefined;
}

function buildFieldMeta(model: ResolvedAdminModel, field: ResolvedField): AdminFieldMeta {
  const readonly = model.readOnly || field.readonly || field.computed;
  const maxLength = effectiveMaxLength(field, !readonly);
  return {
    name: field.key,
    label: field.label,
    type: field.type,
    required: field.required,
    readonly,
    computed: field.computed,
    ...(field.choices ? { choices: [...field.choices] } : {}),
    ...(maxLength !== undefined ? { maxLength } : {}),
    ...(field.min !== undefined ? { min: field.min } : {}),
    ...(field.max !== undefined ? { max: field.max } : {}),
    ...(field.help !== undefined ? { help: field.help } : {}),
    ...(field.quickActions
      ? { quickActions: field.quickActions.map((a) => ({ value: a.value, label: a.label })) }
      : {}),
  };
}

export function buildModelMeta(model: ResolvedAdminModel): AdminModelMeta {
  assertResolved(model);
  const links: AdminLinkMeta[] = model.links.map((link) => ({
    name: link.name,
    label: link.label,
    kind: link.kind,
    ...(link.kind === 'records' && link.model !== undefined ? { model: link.model } : {}),
  }));
  return {
    name: model.name,
    label: model.label,
    group: model.group,
    source: model.source,
    readOnly: model.readOnly,
    idField: model.idField,
    titleField: model.titleField,
    listDisplay: [...model.listDisplay],
    searchFields: [...model.searchFields],
    ordering: [...model.ordering],
    pageSize: model.pageSize,
    maxPageSize: ADMIN_MAX_PAGE_SIZE,
    maxSearchLength: ADMIN_MAX_SEARCH_LENGTH,
    fields: model.fieldKeys.map((key) => buildFieldMeta(model, model.fields[key]!)),
    links,
  };
}

export function computedFieldKeys(model: ResolvedAdminModel): string[] {
  return model.fieldKeys.filter((key) => model.fields[key]!.computed);
}

/** For each field with quick actions, the entries whose value differs from the record's current value. */
export function buildActions(model: ResolvedAdminModel, record: AdminRecordDto): AdminAction[] {
  assertResolved(model);
  if (model.readOnly) return [];
  const actions: AdminAction[] = [];
  for (const key of model.fieldKeys) {
    const field = model.fields[key]!;
    if (!field.quickActions || field.readonly || field.computed) continue;
    const current = record.values[key];
    for (const action of field.quickActions) {
      if (action.value !== current)
        actions.push({ field: key, value: action.value, label: action.label });
    }
  }
  return actions;
}
