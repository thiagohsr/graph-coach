// The registry and start-up validation (rules V1 to V20 of data-model.md section 4).
import {
  deepFreeze,
  markResolved,
  type AdminDeclaration,
  type AdminFieldDeclaration,
  type AdminLinkDeclaration,
  type ResolvedAdminModel,
  type ResolvedField,
} from './declaration';
import {
  RESERVED_SLUGS,
  isForbiddenLabel,
  isSensitiveName,
  isValidHref,
  isValidLabel,
  isValidProperty,
  isValidRelType,
  isValidSlug,
  isValidSqlName,
} from './identifiers';
import { ADMIN_DEFAULT_PAGE_SIZE, ADMIN_HARD_MAX_LENGTH, ADMIN_MAX_PAGE_SIZE } from './limits';

export interface AdminDeclarationProblem {
  model: string;
  /** 'V1' to 'V20' */
  rule: string;
  message: string;
}

export class AdminDeclarationError extends Error {
  constructor(readonly problems: readonly AdminDeclarationProblem[]) {
    super(
      `Invalid admin declarations:\n${problems.map((p) => `  [${p.rule}] ${p.model}: ${p.message}`).join('\n')}`,
    );
    this.name = 'AdminDeclarationError';
  }
}

export class AdminRegistryFrozenError extends Error {
  constructor() {
    super('The admin registry is frozen: register models before start-up completes');
    this.name = 'AdminRegistryFrozenError';
  }
}

export interface AdminRegistry {
  register(declaration: AdminDeclaration): AdminDeclaration;
  /** Throws AdminDeclarationError listing every violation (V1 to V20). */
  validate(): void;
  /** Validates, then refuses later register() calls. Idempotent. */
  freeze(): void;
  /** Sorted by group, then label. */
  list(): readonly ResolvedAdminModel[];
  /** Exact, case-sensitive slug match on a Map. */
  get(name: string): ResolvedAdminModel | undefined;
}

const FIELD_TYPES = [
  'string',
  'text',
  'integer',
  'number',
  'boolean',
  'datetime',
  'enum',
  'list',
  'json',
];

function humanise(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function stripDesc(entry: string): string {
  return entry.startsWith('-') ? entry.slice(1) : entry;
}

const isInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value);

// ─── Validation ──────────────────────────────────────────────────────────────

function checkDeclaration(
  decl: AdminDeclaration,
  add: (rule: string, message: string) => void,
): void {
  const isGraph = decl.source === 'graph';
  const isSql = decl.source === 'sql';
  const fields: Record<string, AdminFieldDeclaration> =
    typeof decl.fields === 'object' && decl.fields !== null ? decl.fields : {};
  const keys = Object.keys(fields);
  const idField = decl.idField ?? 'id';
  const isDeclared = (key: unknown): key is string =>
    typeof key === 'string' && Object.hasOwn(fields, key);
  const fieldOf = (key: string): AdminFieldDeclaration | undefined =>
    isDeclared(key) ? fields[key] : undefined;

  // V2 (the per-model part)
  if (!isGraph && !isSql) add('V2', `source must be 'graph' or 'sql', not ${String(decl.source)}`);
  if (isGraph && !isValidLabel(decl.entity))
    add('V2', `graph entity "${String(decl.entity)}" is not a valid label`);
  if (isSql && !isValidSqlName(decl.entity))
    add('V2', `sql entity "${String(decl.entity)}" is not a valid table name`);

  // V5: forbidden labels
  if (isGraph && isForbiddenLabel(decl.entity)) {
    add(
      'V5',
      `${decl.entity} can never be registered (source text, chunks, and questions are not shown in the admin)`,
    );
  }

  // V3
  if (keys.length === 0) add('V3', 'fields must not be empty');
  for (const key of keys) {
    if (!isValidProperty(key))
      add('V3', `field key "${key.slice(0, 80)}" is not a valid property name`);
  }

  // Per-field rules
  for (const key of keys) {
    const field = fields[key]!;
    const where = `field ${key.slice(0, 80)}`;
    const type = field.type ?? 'string';
    if (!FIELD_TYPES.includes(type)) add('V11', `${where}: unknown type ${String(type)}`);

    // V5: sensitive names
    if (isSensitiveName(key)) add('V5', `${where}: this name can never be declared`);
    if (field.column !== undefined && isSensitiveName(field.column)) {
      add('V5', `${where}: column "${field.column}" can never be declared`);
    }

    // V4
    if (isGraph && field.column !== undefined) add('V4', `${where}: column is only for sql models`);
    if (isSql && !field.computed) {
      const column = field.column ?? key;
      if (!isValidSqlName(column))
        add('V4', `${where}: column "${column.slice(0, 80)}" is not a valid column name`);
    }

    // V11
    if (type === 'enum') {
      if (!Array.isArray(field.choices) || field.choices.length === 0)
        add('V11', `${where}: enum needs choices`);
    } else if (field.choices !== undefined) {
      add('V11', `${where}: choices only belong on enum fields`);
    }

    // V12
    if (type === 'datetime' && field.readonly !== true && !field.computed) {
      add('V12', `${where}: datetime fields must be readonly`);
    }

    // V13
    if (type === 'list' && !isGraph)
      add('V13', `${where}: list fields are only supported on graph models`);
    if (type === 'json' && !isSql)
      add('V13', `${where}: json fields are only supported on sql models`);

    // V17
    if (field.maxLength !== undefined) {
      const cap = (ADMIN_HARD_MAX_LENGTH as Record<string, number | undefined>)[type];
      if (cap === undefined) add('V17', `${where}: maxLength does not apply to ${type} fields`);
      else if (!isInteger(field.maxLength) || field.maxLength < 1 || field.maxLength > cap) {
        add('V17', `${where}: maxLength must be an integer from 1 to ${cap}`);
      }
    }
    if (field.min !== undefined || field.max !== undefined) {
      if (type !== 'integer' && type !== 'number')
        add('V17', `${where}: min and max only apply to integer and number fields`);
      else {
        if (field.min !== undefined && !Number.isFinite(field.min))
          add('V17', `${where}: min must be a number`);
        if (field.max !== undefined && !Number.isFinite(field.max))
          add('V17', `${where}: max must be a number`);
        if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
          add('V17', `${where}: min is greater than max`);
        }
      }
    }

    // V18 (per field)
    if (field.computed) {
      if (field.column !== undefined) add('V18', `${where}: a computed field has no column`);
      if (field.required) add('V18', `${where}: a computed field cannot be required`);
      if (decl.listDisplay?.includes(key))
        add('V18', `${where}: a computed field cannot be in listDisplay`);
      if (decl.searchFields?.includes(key))
        add('V18', `${where}: a computed field cannot be in searchFields`);
      if (decl.ordering?.some((entry) => stripDesc(entry) === key)) {
        add('V18', `${where}: a computed field cannot be in ordering`);
      }
      if (key === idField) add('V18', `${where}: the id field cannot be computed`);
      if (key === (decl.titleField ?? decl.listDisplay?.[0]))
        add('V18', `${where}: the title field cannot be computed`);
    }

    // V19
    if (field.quickActions !== undefined) {
      if (type !== 'enum') add('V19', `${where}: quickActions only apply to enum fields`);
      if (field.readonly || field.computed || decl.readOnly) {
        add('V19', `${where}: quickActions need an editable field`);
      }
      for (const action of field.quickActions) {
        if (typeof action.label !== 'string' || action.label.trim() === '') {
          add('V19', `${where}: a quick action has an empty label`);
        }
        if (!field.choices?.includes(action.value)) {
          add(
            'V19',
            `${where}: quick action value "${String(action.value)}" is not one of the choices`,
          );
        }
      }
    }
  }

  // V18 (per model)
  const hasComputed = keys.some((key) => fields[key]!.computed);
  if (hasComputed && !decl.computeProvider)
    add('V18', 'a model with computed fields needs a computeProvider');
  if (!hasComputed && decl.computeProvider)
    add('V18', 'computeProvider is set but no field is computed');

  // V6
  if (!isDeclared(idField)) add('V6', `idField "${idField}" is not a declared field`);
  else if (fields[idField]!.readonly === false) add('V6', `idField "${idField}" must be readonly`);

  // V7
  if (!Array.isArray(decl.listDisplay) || decl.listDisplay.length === 0)
    add('V7', 'listDisplay must not be empty');
  else {
    for (const key of decl.listDisplay) {
      if (!isDeclared(key))
        add('V7', `listDisplay names an undeclared field "${String(key).slice(0, 80)}"`);
    }
  }
  if (decl.titleField !== undefined && !isDeclared(decl.titleField)) {
    add('V7', `titleField "${decl.titleField}" is not a declared field`);
  }

  // V8
  for (const key of decl.searchFields ?? []) {
    const field = fieldOf(key);
    if (!field) add('V8', `searchFields names an undeclared field "${String(key).slice(0, 80)}"`);
    else if (!['string', 'text'].includes(field.type ?? 'string')) {
      add('V8', `searchFields: ${key} must be a string or text field`);
    }
  }

  // V9
  for (const entry of decl.ordering ?? []) {
    const key = stripDesc(String(entry));
    const field = fieldOf(key);
    if (!field) add('V9', `ordering names an undeclared field "${key.slice(0, 80)}"`);
    else if (['list', 'json'].includes(field.type ?? 'string'))
      add('V9', `ordering: ${key} cannot be a list or json field`);
  }

  // V10
  if (
    decl.pageSize !== undefined &&
    (!isInteger(decl.pageSize) || decl.pageSize < 1 || decl.pageSize > ADMIN_MAX_PAGE_SIZE)
  ) {
    add('V10', `pageSize must be an integer from 1 to ${ADMIN_MAX_PAGE_SIZE}`);
  }

  // V14 and V5 (links)
  if (decl.links !== undefined && decl.links.length > 0 && !isGraph)
    add('V14', 'links are only supported on graph models');
  const linkNames = new Set<string>();
  for (const link of decl.links ?? []) {
    const where = `link ${String((link as { name?: unknown }).name).slice(0, 80)}`;
    if (!isValidProperty(link.name)) add('V14', `${where}: name is not a valid identifier`);
    else if (linkNames.has(link.name)) add('V14', `${where}: duplicate link name`);
    else linkNames.add(link.name);
    if (typeof link.label !== 'string' || link.label === '') add('V14', `${where}: label is empty`);
    checkLink(link, where, add);
  }

  // V16
  if (decl.updatedAtField !== undefined) {
    const field = fieldOf(decl.updatedAtField);
    if (!isSql) add('V16', 'updatedAtField is only supported on sql models');
    if (!field) add('V16', `updatedAtField "${decl.updatedAtField}" is not a declared field`);
    else if ((field.type ?? 'string') !== 'datetime')
      add('V16', `updatedAtField ${decl.updatedAtField} must be a datetime field`);
  }

  // V20
  if (decl.updateProvider !== undefined) {
    if (decl.readOnly) add('V20', 'updateProvider on a read-only model');
    if (decl.validate) add('V20', 'updateProvider cannot be combined with a validate hook');
    if (decl.updatedAtField !== undefined)
      add('V20', 'updateProvider cannot be combined with updatedAtField');
  }
}

function checkLink(
  link: AdminLinkDeclaration,
  where: string,
  add: (rule: string, message: string) => void,
): void {
  if (link.kind === 'route') {
    if (!isValidHref(link.href)) add('V14', `${where}: href must be a path with exactly one :id`);
    return;
  }
  if (link.kind !== 'records' && link.kind !== 'count') {
    add('V14', `${where}: unknown link kind`);
    return;
  }
  if (!isValidRelType(link.rel)) add('V14', `${where}: rel is not a valid relationship type`);
  if (!isValidLabel(link.targetLabel)) add('V14', `${where}: targetLabel is not a valid label`);
  if (link.direction !== 'in' && link.direction !== 'out')
    add('V14', `${where}: direction must be 'in' or 'out'`);
  if (link.kind === 'records') {
    if (isForbiddenLabel(link.targetLabel))
      add('V5', `${where}: ${link.targetLabel} can never be a link target`);
    if (!isValidProperty(link.titleProperty))
      add('V14', `${where}: titleProperty is not a valid property name`);
    else if (isSensitiveName(link.titleProperty))
      add('V5', `${where}: titleProperty "${link.titleProperty}" can never be shown`);
  } else {
    if (link.targetLabel === 'Chunk') add('V5', `${where}: Chunk can never be a link target`);
    if (
      'titleProperty' in link &&
      (link as { titleProperty?: unknown }).titleProperty !== undefined
    ) {
      add('V14', `${where}: a count link has no titleProperty`);
    }
    if ('model' in link && (link as { model?: unknown }).model !== undefined) {
      add('V14', `${where}: a count link has no model`);
    }
  }
}

// ─── Resolution ──────────────────────────────────────────────────────────────

function resolveField(key: string, field: AdminFieldDeclaration, isId: boolean): ResolvedField {
  const computed = field.computed === true;
  return {
    key,
    type: field.type ?? 'string',
    label: field.label ?? humanise(key),
    required: field.required === true,
    readonly: isId || computed || field.readonly === true,
    computed,
    ...(field.choices ? { choices: [...field.choices] } : {}),
    ...(field.maxLength !== undefined ? { maxLength: field.maxLength } : {}),
    ...(field.min !== undefined ? { min: field.min } : {}),
    ...(field.max !== undefined ? { max: field.max } : {}),
    ...(field.column !== undefined ? { column: field.column } : {}),
    ...(field.help !== undefined ? { help: field.help } : {}),
    ...(field.quickActions
      ? { quickActions: field.quickActions.map((a) => ({ value: a.value, label: a.label })) }
      : {}),
  };
}

function resolve(decl: AdminDeclaration): ResolvedAdminModel {
  const idField = decl.idField ?? 'id';
  const fieldKeys = Object.keys(decl.fields);
  const fields: Record<string, ResolvedField> = {};
  for (const key of fieldKeys) fields[key] = resolveField(key, decl.fields[key]!, key === idField);
  const model = {
    name: decl.name,
    label: decl.label,
    group: decl.group ?? 'Other',
    source: decl.source,
    entity: decl.entity,
    idField,
    titleField: decl.titleField ?? decl.listDisplay[0]!,
    listDisplay: [...decl.listDisplay],
    searchFields: [...(decl.searchFields ?? [])],
    fieldKeys,
    fields,
    ordering: [...(decl.ordering ?? [idField])],
    pageSize: decl.pageSize ?? ADMIN_DEFAULT_PAGE_SIZE,
    readOnly: decl.readOnly === true,
    ...(decl.updatedAtField !== undefined ? { updatedAtField: decl.updatedAtField } : {}),
    links: (decl.links ?? []).map((link) => ({ ...link })),
    ...(decl.computeProvider !== undefined ? { computeProvider: decl.computeProvider } : {}),
    ...(decl.updateProvider !== undefined ? { updateProvider: decl.updateProvider } : {}),
    ...(decl.validate !== undefined ? { validate: decl.validate } : {}),
  };
  deepFreeze(model);
  markResolved(model);
  return model as unknown as ResolvedAdminModel;
}

// ─── Registry ────────────────────────────────────────────────────────────────

export function createAdminRegistry(): AdminRegistry {
  const declarations: AdminDeclaration[] = [];
  let resolved: Map<string, ResolvedAdminModel> | null = null;
  let sorted: readonly ResolvedAdminModel[] = [];
  let frozen = false;

  function validate(): void {
    const problems: AdminDeclarationProblem[] = [];
    const seenNames = new Set<string>();
    const seenEntities = new Set<string>();

    for (const decl of declarations) {
      const model = typeof decl.name === 'string' ? decl.name : '(unnamed)';
      const add = (rule: string, message: string) => problems.push({ model, rule, message });

      // V1
      if (!isValidSlug(decl.name))
        add('V1', `name "${String(decl.name).slice(0, 80)}" is not a valid slug`);
      else if (RESERVED_SLUGS.includes(decl.name)) add('V1', `name "${decl.name}" is reserved`);
      else if (seenNames.has(decl.name)) add('V1', `name "${decl.name}" is registered twice`);
      seenNames.add(String(decl.name));

      // V2 (uniqueness)
      const entityKey = `${decl.source}:${decl.entity}`;
      if (seenEntities.has(entityKey))
        add('V2', `${decl.source} entity "${decl.entity}" is registered twice`);
      seenEntities.add(entityKey);

      checkDeclaration(decl, add);
    }

    // V15
    for (const decl of declarations) {
      for (const link of decl.links ?? []) {
        if (link.kind === 'records' && link.model !== undefined && !seenNames.has(link.model)) {
          problems.push({
            model: decl.name,
            rule: 'V15',
            message: `link ${link.name}: model "${link.model}" is not registered`,
          });
        }
      }
    }

    if (problems.length > 0) throw new AdminDeclarationError(problems);

    const map = new Map<string, ResolvedAdminModel>();
    for (const decl of declarations) map.set(decl.name, resolve(decl));
    resolved = map;
    sorted = [...map.values()].sort(
      (a, b) => a.group.localeCompare(b.group, 'en') || a.label.localeCompare(b.label, 'en'),
    );
    Object.freeze(sorted);
  }

  function ensureValid(): Map<string, ResolvedAdminModel> {
    if (!resolved) validate();
    return resolved!;
  }

  return {
    register(declaration) {
      if (frozen) throw new AdminRegistryFrozenError();
      declarations.push(declaration);
      resolved = null;
      return declaration;
    },
    validate,
    freeze() {
      if (frozen) return;
      ensureValid();
      frozen = true;
    },
    list() {
      ensureValid();
      return sorted;
    },
    get(name) {
      return ensureValid().get(name);
    },
  };
}

/** Default instance used by `registerAdmin`. */
export const adminRegistry: AdminRegistry = createAdminRegistry();

/** Adds the declaration to the default registry and returns it unchanged. No I/O, no validation. */
export function registerAdmin(declaration: AdminDeclaration): AdminDeclaration {
  return adminRegistry.register(declaration);
}
