import { z } from 'zod';
import { ValidationDetails } from './errors';

// Admin kit shapes (the design documents section 5, contracts/admin-api.md).

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export const JsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(JsonValue), z.record(JsonValue)]),
);

export const AdminFieldType = z.enum([
  'string',
  'text',
  'integer',
  'number',
  'boolean',
  'datetime',
  'enum',
  'list',
  'json',
]);
export type AdminFieldType = z.infer<typeof AdminFieldType>;

/** A value as the admin API returns it: string[] for a list, a JSON value for a json field. */
export const AdminValue = JsonValue;
export type AdminValue = JsonValue;

export const AdminQuickAction = z.object({ value: z.string(), label: z.string() });
export type AdminQuickAction = z.infer<typeof AdminQuickAction>;

export const AdminFieldMeta = z.object({
  name: z.string(),
  label: z.string(),
  type: AdminFieldType,
  required: z.boolean(),
  /** True for every field of a read-only model and for computed fields. */
  readonly: z.boolean(),
  /** True: shown on detail only, never in lists. */
  computed: z.boolean(),
  choices: z.array(z.string()).optional(),
  maxLength: z.number().int().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  help: z.string().optional(),
  quickActions: z.array(AdminQuickAction).optional(),
});
export type AdminFieldMeta = z.infer<typeof AdminFieldMeta>;

export const AdminLinkMeta = z.object({
  name: z.string(),
  label: z.string(),
  kind: z.enum(['records', 'count', 'route']),
  model: z.string().optional(),
});
export type AdminLinkMeta = z.infer<typeof AdminLinkMeta>;

export const AdminModelMeta = z.object({
  name: z.string(),
  label: z.string(),
  group: z.string(),
  source: z.enum(['graph', 'sql']),
  readOnly: z.boolean(),
  idField: z.string(),
  titleField: z.string(),
  listDisplay: z.array(z.string()),
  searchFields: z.array(z.string()),
  ordering: z.array(z.string()),
  pageSize: z.number().int(),
  maxPageSize: z.number().int(),
  maxSearchLength: z.number().int(),
  fields: z.array(AdminFieldMeta),
  links: z.array(AdminLinkMeta),
});
export type AdminModelMeta = z.infer<typeof AdminModelMeta>;

export const AdminRecordDto = z.object({
  id: z.string(),
  title: z.string(),
  values: z.record(AdminValue),
});
export type AdminRecordDto = z.infer<typeof AdminRecordDto>;

/** Query string of GET /admin/:model. page and pageSize arrive as strings. */
export const AdminListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).optional(),
  search: z.string().trim().optional(),
});
export type AdminListQuery = z.infer<typeof AdminListQuery>;

export const AdminListResponse = z.object({
  items: z.array(AdminRecordDto),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type AdminListResponse = z.infer<typeof AdminListResponse>;

export const AdminLink = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('records'),
    name: z.string(),
    label: z.string(),
    model: z.string().optional(),
    items: z.array(z.object({ id: z.string(), title: z.string() })),
    truncated: z.boolean(),
  }),
  z.object({ kind: z.literal('count'), name: z.string(), label: z.string(), count: z.number().int() }),
  z.object({ kind: z.literal('route'), name: z.string(), label: z.string(), href: z.string() }),
]);
export type AdminLink = z.infer<typeof AdminLink>;

/** Apply with PATCH { values: { [field]: value } }. */
export const AdminAction = z.object({ field: z.string(), value: z.string(), label: z.string() });
export type AdminAction = z.infer<typeof AdminAction>;

export const AdminDetailResponse = z.object({
  record: AdminRecordDto,
  links: z.array(AdminLink),
  actions: z.array(AdminAction),
});
export type AdminDetailResponse = z.infer<typeof AdminDetailResponse>;

export const AdminUpdateRequest = z.object({ values: z.record(z.unknown()) });
export type AdminUpdateRequest = z.infer<typeof AdminUpdateRequest>;

export const AdminUpdateResponse = z.object({ record: AdminRecordDto });
export type AdminUpdateResponse = z.infer<typeof AdminUpdateResponse>;

export const AdminIssueCode = z.enum([
  'unknown_field',
  'read_only',
  'required',
  'invalid_type',
  'invalid_choice',
  'too_long',
  'out_of_range',
  'rejected',
]);
export type AdminIssueCode = z.infer<typeof AdminIssueCode>;

/** 422 details: the shared ValidationDetails issue shape with the field code filled in. */
export const AdminValidationDetails = z.object({
  issues: z.array(z.object({ path: z.string(), message: z.string(), code: AdminIssueCode.optional() })),
  reasons: ValidationDetails.shape.reasons,
});
export type AdminValidationDetails = z.infer<typeof AdminValidationDetails>;
