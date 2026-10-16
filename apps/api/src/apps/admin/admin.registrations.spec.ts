import { describe, expect, it } from 'vitest';
import {
  AdminDeclarationError,
  adminRegistry,
  createAdminRegistry,
  editableFields,
  type AdminDeclaration,
  type ResolvedAdminModel,
} from '@coach/admin-kit';
import './admin.registrations';
import { accessCodeAdmin, adminSettingAdmin, userAdmin } from '../accounts/accounts.admin';
import { decisionAdmin } from '../coach/coach.admin';
import { conceptAdmin, sourceAdmin, taskAdmin } from '../curator/curator.admin';
import { puzzleAdmin } from '../puzzles/puzzles.admin';

adminRegistry.validate();
const models = new Map(adminRegistry.list().map((model) => [model.name, model]));
const model = (name: string): ResolvedAdminModel => {
  const found = models.get(name);
  if (!found) throw new Error(`model ${name} is not registered`);
  return found;
};
const keys = (name: string) => model(name).fieldKeys;

// ─── The canonical data model, copied (the design documents section 1 and 2) ─────────

const CANONICAL_PROPERTIES: Record<string, string[]> = {
  Learner: ['id', 'displayName', 'createdAt'],
  Concept: ['id', 'slug', 'name', 'description', 'createdAt'],
  Source: ['id', 'title', 'kind', 'fingerprint', 'content', 'brief', 'outline', 'createdAt'],
  Puzzle: ['id', 'name', 'origin', 'status', 'visibility', 'distractors', 'createdAt'],
  Decision: [
    'id',
    'kind',
    'summary',
    'flags',
    'modelCalls',
    'inputTokens',
    'outputTokens',
    'embeddingTokens',
    'llmProvider',
    'llmModel',
    'createdAt',
  ],
  Task: [
    'id',
    'kind',
    'status',
    'result',
    'lastCompletedStep',
    'error',
    'modelCalls',
    'inputTokens',
    'outputTokens',
    'embeddingTokens',
    'llmProvider',
    'llmModel',
    'createdAt',
    'updatedAt',
  ],
};

/** [from, relationship, to] */
const CANONICAL_RELATIONSHIPS: [string, string, string][] = [
  ['Concept', 'PREREQUISITE_OF', 'Concept'],
  ['Learner', 'OWNS', 'Source'],
  ['Learner', 'OWNS', 'Puzzle'],
  ['Source', 'YIELDED', 'Puzzle'],
  ['Decision', 'FOR', 'Learner'],
  ['Decision', 'RECOMMENDED', 'Puzzle'],
  ['Decision', 'BECAUSE', 'Concept'],
  ['Learner', 'REQUESTED', 'Task'],
  ['Task', 'CONCERNS', 'Source'],
  ['Task', 'PRODUCED', 'Concept'],
  ['Task', 'PRODUCED', 'Question'],
  ['Task', 'PRODUCED', 'Puzzle'],
];

const CANONICAL_COLUMNS: Record<string, string[]> = {
  users: [
    'id',
    'email',
    'display_name',
    'role',
    'status',
    'bonus_source_runs',
    'bonus_prompt_runs',
    'limits_lifted_until',
    'created_at',
    'last_seen_at',
  ],
  access_codes: [
    'id',
    'code_hash',
    'label',
    'source_runs',
    'prompt_runs',
    'lift_days',
    'max_redemptions',
    'redeemed_count',
    'expires_at',
    'disabled',
    'created_at',
  ],
  admin_settings: ['key', 'value', 'updated_at'],
};

describe('registrations', () => {
  it('validate and are exactly the eight models of v1', () => {
    expect(() => adminRegistry.validate()).not.toThrow();
    expect([...models.keys()].sort()).toEqual([
      'access-code',
      'admin-setting',
      'concept',
      'decision',
      'puzzle',
      'source',
      'task',
      'user',
    ]);
    expect(models.has('question')).toBe(false);
    expect(models.has('chunk')).toBe(false);
  });

  it('use only properties, relationships, and columns of the canonical data model', () => {
    for (const m of models.values()) {
      if (m.source === 'graph') {
        const allowed = CANONICAL_PROPERTIES[m.entity];
        expect(allowed, `${m.name}: entity ${m.entity}`).toBeDefined();
        for (const key of m.fieldKeys) expect(allowed, `${m.name}.${key}`).toContain(key);
        for (const link of m.links) {
          if (link.kind === 'route') continue;
          const [from, to] =
            link.direction === 'out' ? [m.entity, link.targetLabel] : [link.targetLabel, m.entity];
          expect(CANONICAL_RELATIONSHIPS, `${m.name}.${link.name}`).toContainEqual([
            from,
            link.rel,
            to,
          ]);
          if (link.kind === 'records') {
            expect(CANONICAL_PROPERTIES[link.targetLabel], link.name).toContain(link.titleProperty);
            expect(models.has(link.model ?? 'user'), link.name).toBe(true);
          }
        }
      } else {
        const columns = CANONICAL_COLUMNS[m.entity];
        expect(columns, `${m.name}: table ${m.entity}`).toBeDefined();
        for (const key of m.fieldKeys) {
          const field = m.fields[key]!;
          if (field.computed) continue;
          expect(columns, `${m.name}.${key}`).toContain(field.column ?? key);
        }
      }
    }
  });

  it('flags: which fields are listed, searchable, editable, and read-only (data-model section 6)', () => {
    const editable = (name: string) => editableFields(model(name)).map((f) => f.key);
    expect(editable('user')).toEqual(['role', 'status', 'bonusSourceRuns', 'bonusPromptRuns']);
    expect(editable('admin-setting')).toEqual(['value']);
    expect(editable('access-code')).toEqual(['disabled']);
    expect(editable('concept')).toEqual(['name', 'description']);
    for (const name of ['source', 'puzzle', 'task', 'decision']) {
      expect(model(name).readOnly, name).toBe(true);
      expect(editable(name), name).toEqual([]);
    }
    expect(model('user').listDisplay).toEqual([
      'email',
      'displayName',
      'role',
      'status',
      'createdAt',
    ]);
    expect(model('user').searchFields).toEqual(['email', 'displayName']);
    expect(model('user').titleField).toBe('email');
    expect(model('concept').searchFields).toEqual(['slug', 'name', 'description']);
    expect(model('admin-setting').idField).toBe('key');
    expect(model('admin-setting').updatedAtField).toBe('updatedAt');
    expect(model('task').titleField).toBe('id');
    expect(model('decision').titleField).toBe('summary');
    expect(model('access-code').ordering).toEqual(['-createdAt']);
  });

  it('user declares the listed fields, names its providers, and has no username or identity table', () => {
    expect(keys('user')).toEqual([
      'id',
      'email',
      'displayName',
      'role',
      'status',
      'createdAt',
      'lastSeenAt',
      'bonusSourceRuns',
      'bonusPromptRuns',
      'limitsLiftedUntil',
      'uploadsThisMonth',
      'promptsThisMonth',
      'creationsLastHour',
      'tokensThisMonth',
    ]);
    expect(keys('user')).not.toContain('username');
    expect(model('user').computeProvider).toBe('user.creations');
    expect(model('user').updateProvider).toBe('user.account');
    expect(model('user').fields.bonusSourceRuns).toMatchObject({
      min: 0,
      max: 1000,
      required: true,
    });
    expect(model('user').fields.tokensThisMonth).toMatchObject({
      label: 'Tokens this month',
      computed: true,
    });
    expect(model('user').fields.status!.quickActions).toEqual([
      { value: 'blocked', label: 'Block' },
      { value: 'active', label: 'Unblock' },
    ]);
    for (const m of models.values()) {
      expect(['user_identities', 'code_redemptions']).not.toContain(m.entity);
    }
  });

  it('access-code declares ten metadata fields and only disabled is editable', () => {
    expect(keys('access-code')).toEqual([
      'id',
      'label',
      'sourceRuns',
      'promptRuns',
      'liftDays',
      'redeemedCount',
      'maxRedemptions',
      'expiresAt',
      'disabled',
      'createdAt',
    ]);
    expect(model('access-code').updateProvider).toBe('code.disable');
  });

  it('source and puzzle declare metadata only', () => {
    expect(keys('source')).toEqual(['id', 'title', 'kind', 'createdAt']);
    expect(model('source').fields.kind!.choices).toContain('prompt');
    expect(keys('puzzle')).toEqual(['id', 'name', 'origin', 'status', 'visibility', 'createdAt']);
  });

  it('task and decision declare usage as read-only integers, in tokens and calls only', () => {
    for (const name of ['task', 'decision']) {
      const m = model(name);
      for (const key of ['modelCalls', 'inputTokens', 'outputTokens', 'embeddingTokens']) {
        expect(m.fields[key], `${name}.${key}`).toMatchObject({ type: 'integer', readonly: true });
      }
      expect(m.listDisplay).toContain('inputTokens');
      expect(m.listDisplay).toContain('outputTokens');
      expect(m.listDisplay).not.toContain('embeddingTokens');
    }
    expect(model('task').fields.result!.choices).toContain('below_minimum');
    expect(model('task').fields.kind!.choices).toContain('generate');
    expect(model('decision').fields.flags).toMatchObject({ type: 'list', readonly: true });
  });

  it('no field key or label mentions cost or price', () => {
    for (const m of models.values()) {
      for (const key of m.fieldKeys) {
        const text = `${key} ${m.fields[key]!.label}`.toLowerCase();
        expect(text, `${m.name}.${key}`).not.toMatch(/cost|price|dollar|usd|eur|currency/);
      }
    }
  });

  it('declare no link over SHARED_WITH, CONTAINS, TESTS, GROUNDED_IN, or HAS_CHUNK, none to Question or Chunk records', () => {
    for (const m of models.values()) {
      for (const link of m.links) {
        if (link.kind === 'route') {
          expect(link.href).not.toMatch(/^\/(sources|tasks|review)/);
          continue;
        }
        expect([
          'SHARED_WITH',
          'CONTAINS',
          'TESTS',
          'GROUNDED_IN',
          'HAS_CHUNK',
          'HAS_STEP',
        ]).not.toContain(link.rel);
        if (link.kind === 'records') expect(['Question', 'Chunk']).not.toContain(link.targetLabel);
        else expect(link.targetLabel).not.toBe('Chunk');
      }
    }
    expect(model('task').links.find((l) => l.name === 'producedQuestions')?.kind).toBe('count');
  });
});

describe('what can never be declared (rule V5)', () => {
  function violates(decl: AdminDeclaration): string[] {
    const registry = createAdminRegistry();
    registry.register(decl);
    try {
      registry.validate();
      return [];
    } catch (error) {
      return (error as AdminDeclarationError).problems.map((p) => p.rule);
    }
  }

  const withField = (
    decl: AdminDeclaration,
    key: string,
    extra: object = {},
  ): AdminDeclaration => ({
    ...decl,
    links: [],
    fields: { ...decl.fields, [key]: extra },
  });

  it('accepts the unmodified declarations (sanity)', () => {
    for (const decl of [
      userAdmin,
      adminSettingAdmin,
      accessCodeAdmin,
      conceptAdmin,
      sourceAdmin,
      puzzleAdmin,
      taskAdmin,
      decisionAdmin,
    ]) {
      expect(violates({ ...decl, links: [] }), decl.name).toEqual([]);
    }
  });

  it('refuses cognito_sub on user, content/brief/outline on source, code_hash on access-code, distractors on puzzle', () => {
    expect(violates(withField(userAdmin, 'cognitoSub', { column: 'cognito_sub' }))).toContain('V5');
    expect(violates(withField(userAdmin, 'cognito_sub'))).toContain('V5');
    for (const key of ['content', 'brief', 'outline'])
      expect(violates(withField(sourceAdmin, key))).toContain('V5');
    expect(violates(withField(accessCodeAdmin, 'hash', { column: 'code_hash' }))).toContain('V5');
    expect(violates(withField(accessCodeAdmin, 'codeHash', { column: 'code_hash' }))).toContain(
      'V5',
    );
    expect(violates(withField(puzzleAdmin, 'distractors', { type: 'list' }))).toContain('V5');
  });

  it('refuses registering Question or Chunk and a records link to either', () => {
    expect(
      violates({ ...conceptAdmin, name: 'question', entity: 'Question', links: [] }),
    ).toContain('V5');
    expect(violates({ ...conceptAdmin, name: 'chunk', entity: 'Chunk', links: [] })).toContain(
      'V5',
    );
    for (const targetLabel of ['Question', 'Chunk']) {
      expect(
        violates({
          ...taskAdmin,
          links: [
            {
              kind: 'records',
              name: 'qs',
              label: 'Qs',
              rel: 'PRODUCED',
              direction: 'out',
              targetLabel,
              titleProperty: 'id',
            },
          ],
        }),
      ).toContain('V5');
    }
  });
});
