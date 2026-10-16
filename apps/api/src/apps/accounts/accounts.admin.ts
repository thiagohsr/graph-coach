// Admin registrations of the accounts feature: user, admin-setting, access-code
// (the design documents section 6). Imported by apps/admin/admin.registrations.ts.
//
// Never declared here: users.cognito_sub and the user_identities table, access_codes.code_hash and the
// code_redemptions table. The admin rules (V5) would refuse them.
import { registerAdmin, type AdminHookContext, type AdminHookResult } from '@coach/admin-kit';
import { SettingsSchema, isSettingKey } from '../../common/settings/settings.schema';

const ROLES = ['learner', 'reviewer', 'admin'];
const STATUSES = ['active', 'blocked'];

export const userAdmin = registerAdmin({
  name: 'user',
  label: 'Users',
  group: 'Accounts',
  source: 'sql',
  entity: 'users',
  titleField: 'email',
  listDisplay: ['email', 'displayName', 'role', 'status', 'createdAt'],
  searchFields: ['email', 'displayName'],
  ordering: ['email'],
  fields: {
    id: { readonly: true },
    email: { label: 'E-mail', readonly: true },
    displayName: { label: 'Display name', column: 'display_name', readonly: true },
    role: { type: 'enum', choices: ROLES },
    status: {
      type: 'enum',
      choices: STATUSES,
      quickActions: [
        { value: 'blocked', label: 'Block' },
        { value: 'active', label: 'Unblock' },
      ],
    },
    createdAt: { type: 'datetime', label: 'Created at', column: 'created_at', readonly: true },
    lastSeenAt: { type: 'datetime', label: 'Last seen at', column: 'last_seen_at', readonly: true },
    bonusSourceRuns: {
      type: 'integer',
      label: 'Bonus upload runs',
      column: 'bonus_source_runs',
      required: true,
      min: 0,
      max: 1000,
    },
    bonusPromptRuns: {
      type: 'integer',
      label: 'Bonus prompt runs',
      column: 'bonus_prompt_runs',
      required: true,
      min: 0,
      max: 1000,
    },
    limitsLiftedUntil: {
      type: 'datetime',
      label: 'Hourly limit lifted until',
      column: 'limits_lifted_until',
      readonly: true,
    },
    onboardedAt: {
      type: 'datetime',
      label: 'Onboarded at',
      column: 'onboarded_at',
      readonly: true,
    },
    uploadsThisMonth: { type: 'integer', label: 'Uploads this month', computed: true },
    promptsThisMonth: { type: 'integer', label: 'Prompt puzzles this month', computed: true },
    creationsLastHour: { type: 'integer', label: 'Creations in the last hour', computed: true },
    tokensThisMonth: { type: 'integer', label: 'Tokens this month', computed: true },
  },
  computeProvider: 'user.creations',
  updateProvider: 'user.account',
});

/**
 * Hook of `admin-setting`: the platform's settings schema decides what a value may be; this file defines no bounds.
 * `ctx.id` is the setting key.
 */
export function validateSetting(ctx: AdminHookContext): AdminHookResult {
  if (ctx.id === 'embeddingDim') {
    return {
      fields: { value: 'embeddingDim is written by setup-graph and cannot be edited here' },
    };
  }
  if (!isSettingKey(ctx.id)) return { fields: { value: 'This is not a setting key' } };
  const parsed = SettingsSchema.shape[ctx.id].safeParse(ctx.changes.value);
  if (!parsed.success) {
    return {
      fields: {
        value: parsed.error.issues[0]?.message ?? 'This value is not valid for this setting',
      },
    };
  }
}

export const adminSettingAdmin = registerAdmin({
  name: 'admin-setting',
  label: 'Admin settings',
  group: 'Accounts',
  source: 'sql',
  entity: 'admin_settings',
  idField: 'key',
  listDisplay: ['key', 'value', 'updatedAt'],
  searchFields: ['key'],
  ordering: ['key'],
  updatedAtField: 'updatedAt',
  fields: {
    key: { readonly: true },
    value: { type: 'json', required: true, help: 'A JSON value: a number, true or false.' },
    updatedAt: { type: 'datetime', label: 'Updated at', column: 'updated_at', readonly: true },
  },
  validate: validateSetting,
});

export const accessCodeAdmin = registerAdmin({
  name: 'access-code',
  label: 'Access codes',
  group: 'Accounts',
  source: 'sql',
  entity: 'access_codes',
  titleField: 'label',
  listDisplay: [
    'label',
    'sourceRuns',
    'promptRuns',
    'liftDays',
    'redeemedCount',
    'maxRedemptions',
    'expiresAt',
    'disabled',
    'createdAt',
  ],
  searchFields: ['label'],
  ordering: ['-createdAt'],
  fields: {
    id: { readonly: true },
    label: { readonly: true },
    sourceRuns: { type: 'integer', label: 'Upload runs', column: 'source_runs', readonly: true },
    promptRuns: { type: 'integer', label: 'Prompt runs', column: 'prompt_runs', readonly: true },
    liftDays: {
      type: 'integer',
      label: 'Days the hourly limit is lifted',
      column: 'lift_days',
      readonly: true,
    },
    redeemedCount: { type: 'integer', label: 'Redeemed', column: 'redeemed_count', readonly: true },
    maxRedemptions: {
      type: 'integer',
      label: 'Max redemptions',
      column: 'max_redemptions',
      readonly: true,
    },
    expiresAt: { type: 'datetime', label: 'Expires at', column: 'expires_at', readonly: true },
    disabled: {
      type: 'boolean',
      required: true,
      help: 'A disabled code cannot be enabled again; create a new code instead.',
    },
    createdAt: { type: 'datetime', label: 'Created at', column: 'created_at', readonly: true },
  },
  updateProvider: 'code.disable',
});
