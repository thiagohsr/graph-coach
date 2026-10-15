// Identifier rules (data-model.md section 4). Identifiers reach query text only from a declaration that passed these
// patterns; request data never does.

export type IdentifierKind = 'slug' | 'label' | 'property' | 'rel' | 'sql' | 'href';

export const IDENTIFIER_PATTERNS: Record<IdentifierKind, RegExp> = {
  slug: /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/,
  label: /^[A-Z][A-Za-z0-9]*$/,
  property: /^[a-z][A-Za-z0-9]*$/,
  rel: /^[A-Z][A-Z0-9_]*$/,
  sql: /^[a-z][a-z0-9_]*$/,
  href: /^(\/[a-z0-9-]+|\/:id)+$/,
};

export const IDENTIFIER_MAX_LENGTH: Record<IdentifierKind, number> = {
  slug: 40,
  label: 63,
  property: 63,
  rel: 63,
  sql: 63,
  href: 200,
};

/** The slug `models` is the path of the metadata endpoint. */
export const RESERVED_SLUGS: readonly string[] = ['models'];

export function isValidIdentifier(kind: IdentifierKind, value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (value.length > IDENTIFIER_MAX_LENGTH[kind]) return false;
  if (!IDENTIFIER_PATTERNS[kind].test(value)) return false;
  if (kind === 'href') return value.split('/:id').length === 2 && !value.includes(':id/:id');
  return true;
}

export const isValidSlug = (value: unknown) => isValidIdentifier('slug', value);
export const isValidLabel = (value: unknown) => isValidIdentifier('label', value);
export const isValidProperty = (value: unknown) => isValidIdentifier('property', value);
export const isValidRelType = (value: unknown) => isValidIdentifier('rel', value);
export const isValidSqlName = (value: unknown) => isValidIdentifier('sql', value);
export const isValidHref = (value: unknown) => isValidIdentifier('href', value);

/** Second check used by every query builder before it writes an identifier into query text. */
export function assertIdentifier(kind: IdentifierKind, value: string): string {
  if (!isValidIdentifier(kind, value)) {
    throw new Error(`Refused to use "${String(value).slice(0, 80)}" as a ${kind} identifier`);
  }
  return value;
}

/**
 * Name segment of a generated query: slug `-` becomes `_`, camelCase becomes lower snake case.
 * `producedConcepts` -> `produced_concepts`, `admin-setting` -> `admin_setting`.
 */
export function queryNameSegment(value: string): string {
  return value
    .replace(/-/g, '_')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

const SENSITIVE_NAMES: ReadonlySet<string> = new Set([
  'password',
  'passwordhash',
  'cognitosub',
  'code',
  'codehash',
  'embedding',
  'content',
  'brief',
  'outline',
  'answers',
  'distractors',
  'secret',
  'token',
  'accesstoken',
  'apikey',
]);

/** Field keys, columns, and title properties that can never be declared (rule V5). */
export function isSensitiveName(name: string): boolean {
  return SENSITIVE_NAMES.has(name.toLowerCase().replace(/[_-]/g, ''));
}

/** Graph labels that can never be an `entity` or the target of a `records` link (Principle VII). */
export const FORBIDDEN_LABELS: readonly string[] = ['Chunk', 'Question'];

export function isForbiddenLabel(label: string): boolean {
  return FORBIDDEN_LABELS.includes(label);
}
