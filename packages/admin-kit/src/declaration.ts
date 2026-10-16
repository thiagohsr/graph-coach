// Declaration types (data-model.md section 1) and the branded, deeply read-only resolved model.
import type { AdminFieldType, AdminValue } from '@coach/types';

export type { AdminFieldType, AdminValue };

export type AdminSource = 'graph' | 'sql';

export interface AdminQuickActionDeclaration {
  value: string;
  label: string;
}

export interface AdminFieldDeclaration {
  /** Default 'string'. */
  type?: AdminFieldType;
  /** Default: humanised field key. */
  label?: string;
  /** Default false. On PATCH the field may be omitted; if present it must not be null, '' or []. */
  required?: boolean;
  /** Default false. */
  readonly?: boolean;
  /** Required when type = 'enum', forbidden otherwise. */
  choices?: readonly string[];
  /** Overrides the per-type default; never above the hard cap. */
  maxLength?: number;
  /** integer and number fields: lowest accepted value. */
  min?: number;
  /** integer and number fields: highest accepted value. */
  max?: number;
  /** sql only: column name when it differs from the field key. */
  column?: string;
  /** Value comes from the model's compute provider, not from the store; always read-only. */
  computed?: boolean;
  /** enum fields only: one-step buttons, for example Block / Unblock. */
  quickActions?: readonly AdminQuickActionDeclaration[];
  /** One line shown under the form control. */
  help?: string;
}

export interface AdminRecordsLink {
  kind: 'records';
  name: string;
  label: string;
  /** Relationship type, for example 'PRODUCED'. */
  rel: string;
  /** out: (n)-[:rel]->(m); in: (n)<-[:rel]-(m) */
  direction: 'out' | 'in';
  /** Never 'Chunk' or 'Question'. */
  targetLabel: string;
  titleProperty: string;
  /** Registered model slug the UI links to; omitted = plain text. */
  model?: string;
}

export interface AdminRouteLink {
  kind: 'route';
  name: string;
  label: string;
  /** Web route template; the only placeholder allowed is ':id'. */
  href: string;
}

export interface AdminCountLink {
  /** Shows how many neighbours exist; reads no property of them. */
  kind: 'count';
  name: string;
  label: string;
  rel: string;
  direction: 'out' | 'in';
  /** Never 'Chunk'; 'Question' is allowed here only. */
  targetLabel: string;
}

export type AdminLinkDeclaration = AdminRecordsLink | AdminCountLink | AdminRouteLink;

export interface AdminHookContext {
  /** Slug. */
  model: string;
  id: string;
  /** Every stored declared field, as stored now. */
  current: Readonly<Record<string, AdminValue>>;
  /** Validated, editable fields only. */
  changes: Readonly<Record<string, AdminValue>>;
  actor: { id: string; role: 'admin' };
}

export type AdminHookResult = void | { fields?: Record<string, string>; form?: string[] };
export type AdminValidateHook = (
  ctx: AdminHookContext,
) => AdminHookResult | Promise<AdminHookResult>;

export type AdminComputeProvider = (record: {
  id: string;
  values: Readonly<Record<string, AdminValue>>;
}) => Promise<Record<string, AdminValue>>;

/** Checks AND writes (used instead of validate + adapter.update). */
export type AdminUpdateProvider = (ctx: AdminHookContext) => Promise<AdminHookResult>;

export interface AdminDeclaration {
  /** URL slug, unique. */
  name: string;
  /** Plural display name. */
  label: string;
  /** Default 'Other'. */
  group?: string;
  source: AdminSource;
  /** Node label (graph) or table name (sql). */
  entity: string;
  /** Default 'id'; always read-only. */
  idField?: string;
  /** Default listDisplay[0]. */
  titleField?: string;
  listDisplay: readonly string[];
  searchFields?: readonly string[];
  fields: Record<string, AdminFieldDeclaration>;
  /** Field key, '-' prefix = descending; default [idField]. */
  ordering?: readonly string[];
  /** Default 25. */
  pageSize?: number;
  /** true: no update is ever accepted for this model. */
  readOnly?: boolean;
  /** sql only in v1: set to now() on every update. */
  updatedAtField?: string;
  /** graph only. */
  links?: readonly AdminLinkDeclaration[];
  computeProvider?: string;
  updateProvider?: string;
  validate?: AdminValidateHook;
}

// ─── Resolved model ──────────────────────────────────────────────────────────

export interface ResolvedField {
  readonly key: string;
  readonly type: AdminFieldType;
  readonly label: string;
  readonly required: boolean;
  /** Declared read-only, computed, or the id field. The model's own `readOnly` is separate. */
  readonly readonly: boolean;
  readonly computed: boolean;
  readonly choices?: readonly string[];
  readonly maxLength?: number;
  readonly min?: number;
  readonly max?: number;
  /** sql column (explicit or the key). Absent for graph models and computed fields. */
  readonly column?: string;
  readonly help?: string;
  readonly quickActions?: readonly AdminQuickActionDeclaration[];
}

declare const resolvedBrand: unique symbol;

export interface ResolvedAdminModel {
  readonly [resolvedBrand]: true;
  readonly name: string;
  readonly label: string;
  readonly group: string;
  readonly source: AdminSource;
  readonly entity: string;
  readonly idField: string;
  readonly titleField: string;
  readonly listDisplay: readonly string[];
  readonly searchFields: readonly string[];
  /** Declaration order. */
  readonly fieldKeys: readonly string[];
  readonly fields: Readonly<Record<string, ResolvedField>>;
  readonly ordering: readonly string[];
  readonly pageSize: number;
  readonly readOnly: boolean;
  readonly updatedAtField?: string;
  readonly links: readonly AdminLinkDeclaration[];
  readonly computeProvider?: string;
  readonly updateProvider?: string;
  readonly validate?: AdminValidateHook;
}

const resolvedModels = new WeakSet<object>();

/** Used by the registry only. */
export function markResolved(model: object): void {
  resolvedModels.add(model);
}

export function isResolvedModel(model: unknown): model is ResolvedAdminModel {
  return typeof model === 'object' && model !== null && resolvedModels.has(model);
}

/** Runtime half of the brand: every builder calls this first. */
export function assertResolved(model: unknown): asserts model is ResolvedAdminModel {
  if (!isResolvedModel(model)) {
    throw new Error('Admin builders accept only models resolved by the registry');
  }
}

export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const inner of Object.values(value)) deepFreeze(inner);
  return value;
}

// ─── Field helpers ───────────────────────────────────────────────────────────

export function fieldOf(model: ResolvedAdminModel, key: string): ResolvedField | undefined {
  return Object.hasOwn(model.fields, key) ? model.fields[key] : undefined;
}

/** Fields stored in the graph or table, in declaration order (computed fields are not). */
export function storedFields(model: ResolvedAdminModel): ResolvedField[] {
  return model.fieldKeys.map((key) => model.fields[key]!).filter((field) => !field.computed);
}

/** Fields an update may change: never on a read-only model, never read-only, computed, or the id field. */
export function editableFields(model: ResolvedAdminModel): ResolvedField[] {
  if (model.readOnly) return [];
  return model.fieldKeys
    .map((key) => model.fields[key]!)
    .filter((field) => !field.readonly && !field.computed);
}

export function sqlColumnOf(field: ResolvedField): string {
  return field.column ?? field.key;
}
