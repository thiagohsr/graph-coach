import { describe, expect, it } from 'vitest';
import type { AdminDeclaration } from './declaration';
import { AdminDeclarationError, AdminRegistryFrozenError, createAdminRegistry } from './registry';

const base = (): AdminDeclaration => ({
  name: 'concept',
  label: 'Concepts',
  group: 'Knowledge',
  source: 'graph',
  entity: 'Concept',
  listDisplay: ['name', 'slug', 'createdAt'],
  searchFields: ['slug', 'name', 'description'],
  fields: {
    id: { readonly: true },
    slug: { readonly: true },
    name: { type: 'string', required: true },
    description: { type: 'text' },
    createdAt: { type: 'datetime', readonly: true },
  },
  ordering: ['name'],
});

const sqlBase = (): AdminDeclaration => ({
  name: 'thing',
  label: 'Things',
  source: 'sql',
  entity: 'things',
  listDisplay: ['title'],
  fields: { id: { readonly: true }, title: { type: 'string' } },
});

/** Validates the given declarations in a fresh registry and returns the problems. */
function problemsOf(...decls: AdminDeclaration[]) {
  const registry = createAdminRegistry();
  for (const decl of decls) registry.register(decl);
  try {
    registry.validate();
  } catch (error) {
    expect(error).toBeInstanceOf(AdminDeclarationError);
    return (error as AdminDeclarationError).problems;
  }
  return [];
}

function expectRule(rule: string, ...decls: AdminDeclaration[]) {
  const problems = problemsOf(...decls);
  expect(problems.map((p) => p.rule)).toContain(rule);
  expect(problems.find((p) => p.rule === rule)?.model).toBe(decls[0]!.name);
}

function withField(key: string, field: object, extra: Partial<AdminDeclaration> = {}): AdminDeclaration {
  const decl = base();
  decl.fields = { ...decl.fields, [key]: field };
  return { ...decl, ...extra };
}

describe('registry', () => {
  it('accepts the spec example and applies defaults', () => {
    const registry = createAdminRegistry();
    registry.register({
      name: 'minimal',
      label: 'Minimal',
      source: 'graph',
      entity: 'Concept',
      listDisplay: ['name'],
      fields: { id: {}, name: {} },
    });
    registry.validate();
    const model = registry.get('minimal')!;
    expect(model.idField).toBe('id');
    expect(model.titleField).toBe('name');
    expect(model.group).toBe('Other');
    expect(model.pageSize).toBe(25);
    expect(model.ordering).toEqual(['id']);
    expect(model.fields.name!.type).toBe('string');
    expect(model.fields.id!.readonly).toBe(true);
    expect(model.fields.name!.label).toBe('Name');
    expect(model.readOnly).toBe(false);
  });

  it('accepts a well-formed declaration', () => {
    expect(problemsOf(base(), sqlBase())).toEqual([]);
  });

  it('V1 slug, reserved, unique', () => {
    expectRule('V1', { ...base(), name: 'Bad Slug' });
    expectRule('V1', { ...base(), name: 'models' });
    const twice = problemsOf(base(), { ...base(), entity: 'Other' });
    expect(twice.some((p) => p.rule === 'V1')).toBe(true);
  });

  it('V2 source, entity pattern, one model per entity', () => {
    expectRule('V2', { ...base(), source: 'neo4j' as never });
    expectRule('V2', { ...base(), entity: 'concept' });
    expectRule('V2', { ...sqlBase(), entity: 'Bad-Table' });
    const dup = problemsOf(base(), { ...base(), name: 'concept2' });
    expect(dup.some((p) => p.rule === 'V2')).toBe(true);
  });

  it('V3 fields', () => {
    expectRule('V3', { ...base(), fields: {} });
    expectRule('V3', withField('bad_key', {}));
  });

  it('V4 columns', () => {
    expectRule('V4', withField('title', { column: 'title' }));
    const sql = sqlBase();
    sql.fields = { ...sql.fields, displayName: {} };
    expectRule('V4', sql);
    const ok = sqlBase();
    ok.fields = { ...ok.fields, displayName: { column: 'display_name' } };
    expect(problemsOf(ok)).toEqual([]);
  });

  describe('V5 private data', () => {
    it.each(['Chunk', 'Question'])('refuses entity %s', (entity) => {
      expectRule('V5', { ...base(), entity });
    });

    it.each(['Chunk', 'Question'])('refuses a records link to %s', (targetLabel) => {
      expectRule('V5', {
        ...base(),
        links: [{ kind: 'records', name: 'l', label: 'L', rel: 'TESTS', direction: 'in', targetLabel, titleProperty: 'name' }],
      });
    });

    it('refuses a count link to Chunk but allows Question', () => {
      const link = (targetLabel: string) =>
        ({ ...base(), links: [{ kind: 'count', name: 'l', label: 'L', rel: 'TESTS', direction: 'in', targetLabel }] }) as AdminDeclaration;
      expectRule('V5', link('Chunk'));
      expect(problemsOf(link('Question'))).toEqual([]);
    });

    it.each(['content', 'embedding', 'cognito_sub', 'answers', 'distractors', 'brief', 'outline', 'code_hash'])(
      'refuses a field named %s',
      (key) => {
        expectRule('V5', withField(key, {}));
        expectRule('V5', sqlWith(key));
      },
    );

    function sqlWith(column: string): AdminDeclaration {
      const sql = sqlBase();
      sql.fields = { ...sql.fields, safe: { column } };
      return sql;
    }

    it('refuses a sensitive title property', () => {
      expectRule('V5', {
        ...base(),
        links: [{ kind: 'records', name: 'l', label: 'L', rel: 'X', direction: 'out', targetLabel: 'Concept', titleProperty: 'content' }],
      });
    });
  });

  it('V6 id field', () => {
    expectRule('V6', { ...base(), idField: 'nope' });
    expectRule('V6', withField('id', { readonly: false }));
  });

  it('V7 list display and title', () => {
    expectRule('V7', { ...base(), listDisplay: [] });
    expectRule('V7', { ...base(), listDisplay: ['nope'] });
    expectRule('V7', { ...base(), titleField: 'nope' });
  });

  it('V8 search fields', () => {
    expectRule('V8', { ...base(), searchFields: ['nope'] });
    expectRule('V8', withField('count', { type: 'integer' }, { searchFields: ['count'] }));
  });

  it('V9 ordering', () => {
    expectRule('V9', { ...base(), ordering: ['nope'] });
    expectRule('V9', withField('tags', { type: 'list' }, { ordering: ['-tags'] }));
  });

  it('V10 page size', () => {
    expectRule('V10', { ...base(), pageSize: 0 });
    expectRule('V10', { ...base(), pageSize: 101 });
    expectRule('V10', { ...base(), pageSize: 2.5 });
  });

  it('V11 choices', () => {
    expectRule('V11', withField('kind', { type: 'enum' }));
    expectRule('V11', withField('kind', { type: 'enum', choices: [] }));
    expectRule('V11', withField('kind', { type: 'string', choices: ['a'] }));
  });

  it('V12 datetime read-only', () => {
    expectRule('V12', withField('when', { type: 'datetime' }));
  });

  it('V13 list and json placement', () => {
    expectRule('V13', { ...sqlBase(), fields: { id: {}, tags: { type: 'list' } } });
    expectRule('V13', withField('data', { type: 'json' }));
  });

  it('V14 links', () => {
    const records = { kind: 'records', name: 'l', label: 'L', rel: 'X', direction: 'out', targetLabel: 'Concept', titleProperty: 'name' };
    expectRule('V14', { ...sqlBase(), links: [records as never] });
    expectRule('V14', { ...base(), links: [{ ...records, rel: 'bad rel' } as never] });
    expectRule('V14', { ...base(), links: [{ ...records, titleProperty: 'bad-prop' } as never] });
    expectRule('V14', { ...base(), links: [records as never, records as never] });
    expectRule('V14', { ...base(), links: [{ kind: 'route', name: 'r', label: 'R', href: '/a' }] });
    expectRule('V14', {
      ...base(),
      links: [{ kind: 'count', name: 'c', label: 'C', rel: 'X', direction: 'out', targetLabel: 'Task', model: 'concept' } as never],
    });
  });

  it('V15 link model must be registered', () => {
    expectRule('V15', {
      ...base(),
      links: [{ kind: 'records', name: 'l', label: 'L', rel: 'X', direction: 'out', targetLabel: 'Concept', titleProperty: 'name', model: 'ghost' }],
    });
  });

  it('V16 updatedAtField', () => {
    expectRule('V16', { ...base(), updatedAtField: 'createdAt' });
    const sql = sqlBase();
    expectRule('V16', { ...sql, updatedAtField: 'nope' });
    expectRule('V16', { ...sql, updatedAtField: 'title' });
  });

  it('V17 length and range options', () => {
    expectRule('V17', withField('s', { type: 'string', min: 1 }));
    expectRule('V17', withField('s', { type: 'integer', min: 5, max: 1 }));
    expectRule('V17', withField('s', { type: 'string', maxLength: 0 }));
    expectRule('V17', withField('s', { type: 'string', maxLength: 5000 }));
    expectRule('V17', withField('s', { type: 'boolean', maxLength: 5 }));
    expect(problemsOf(withField('n', { type: 'integer', min: 0, max: 1000 }))).toEqual([]);
  });

  it('V18 computed fields', () => {
    const sql = (field: object, extra: Partial<AdminDeclaration> = {}): AdminDeclaration => ({
      ...sqlBase(),
      fields: { id: { readonly: true }, title: {}, total: { type: 'integer', computed: true, ...field } },
      computeProvider: 'p',
      ...extra,
    });
    expect(problemsOf(sql({}))).toEqual([]);
    expectRule('V18', sql({ column: 'total' }));
    expectRule('V18', sql({}, { listDisplay: ['title', 'total'] }));
    expectRule('V18', sql({}, { searchFields: ['total'] }));
    expectRule('V18', sql({}, { ordering: ['-total'] }));
    expectRule('V18', sql({ required: true }));
    expectRule('V18', sql({}, { computeProvider: undefined }));
    expectRule('V18', { ...sqlBase(), computeProvider: 'p' });
  });

  it('V19 quick actions', () => {
    const quick = [{ value: 'b', label: 'Block' }];
    const enumField = { type: 'enum', choices: ['a', 'b'], quickActions: quick };
    expect(problemsOf(withField('s', enumField))).toEqual([]);
    expectRule('V19', withField('s', { ...enumField, readonly: true }));
    expectRule('V19', withField('s', { type: 'string', quickActions: quick }));
    expectRule('V19', withField('s', { ...enumField, quickActions: [{ value: 'zzz', label: 'Z' }] }));
    expectRule('V19', withField('s', enumField, { readOnly: true }));
    expectRule('V19', withField('s', { ...enumField, quickActions: [{ value: 'b', label: '' }] }));
  });

  it('V20 update provider', () => {
    const sql = (extra: Partial<AdminDeclaration>): AdminDeclaration => ({ ...sqlBase(), updateProvider: 'p', ...extra });
    expect(problemsOf(sql({}))).toEqual([]);
    expectRule('V20', sql({ readOnly: true }));
    expectRule('V20', sql({ validate: () => undefined }));
    expectRule('V20', {
      ...sql({ updatedAtField: 'updatedAt' }),
      fields: { id: {}, title: {}, updatedAt: { type: 'datetime', readonly: true } },
    });
  });

  it('reports several violations in one error', () => {
    const problems = problemsOf({ ...base(), name: 'BAD', entity: 'Chunk', pageSize: 0 });
    expect(new Set(problems.map((p) => p.rule))).toEqual(new Set(['V1', 'V5', 'V10']));
  });

  it('get is an exact, case-sensitive match', () => {
    const registry = createAdminRegistry();
    registry.register(base());
    registry.freeze();
    expect(registry.get('concept')?.name).toBe('concept');
    expect(registry.get('Concept')).toBeUndefined();
    expect(registry.get('concept ')).toBeUndefined();
    expect(registry.get('__proto__')).toBeUndefined();
  });

  it('refuses register after freeze, and freeze is idempotent', () => {
    const registry = createAdminRegistry();
    registry.register(base());
    registry.freeze();
    registry.freeze();
    expect(() => registry.register(sqlBase())).toThrow(AdminRegistryFrozenError);
  });

  it('freeze refuses an invalid registry', () => {
    const registry = createAdminRegistry();
    registry.register({ ...base(), entity: 'Chunk' });
    expect(() => registry.freeze()).toThrow(AdminDeclarationError);
  });

  it('list is sorted by group then label, and a resolved model is frozen', () => {
    const registry = createAdminRegistry();
    registry.register({ ...sqlBase(), name: 'zeta', group: 'B', label: 'Alpha' });
    registry.register({ ...base(), name: 'a', group: 'A', label: 'Zed' });
    registry.register({ ...base(), name: 'b', group: 'A', label: 'Abe', entity: 'Source' });
    registry.freeze();
    expect(registry.list().map((m) => m.name)).toEqual(['b', 'a', 'zeta']);
    const model = registry.get('a')!;
    expect(Object.isFrozen(model)).toBe(true);
    expect(Object.isFrozen(model.fields)).toBe(true);
    expect(Object.isFrozen(model.fields.name)).toBe(true);
    expect(() => {
      (model as { label: string }).label = 'x';
    }).toThrow();
  });
});
