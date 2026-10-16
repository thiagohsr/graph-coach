import { describe, expect, it } from 'vitest';
import { AdminModelMeta } from '@coach/types';
import type { AdminDeclaration } from './declaration';
import { buildActions, buildModelMeta, computedFieldKeys } from './metadata';
import { createAdminRegistry } from './registry';
import { sampleGraphDeclaration, sampleSqlDeclaration } from './testing';

const user: AdminDeclaration = {
  name: 'user',
  label: 'Users',
  group: 'Accounts',
  source: 'sql',
  entity: 'users',
  listDisplay: ['email', 'status'],
  fields: {
    id: { readonly: true },
    email: { readonly: true },
    status: {
      type: 'enum',
      choices: ['active', 'blocked'],
      quickActions: [
        { value: 'blocked', label: 'Block' },
        { value: 'active', label: 'Unblock' },
      ],
    },
    bonusRuns: { type: 'integer', column: 'bonus_runs', min: 0, max: 1000, required: true },
    uploads: { type: 'integer', computed: true },
  },
  computeProvider: 'user.counts',
};

function resolve(...decls: AdminDeclaration[]) {
  const registry = createAdminRegistry();
  for (const decl of decls) registry.register(decl);
  registry.freeze();
  return registry;
}

describe('buildModelMeta', () => {
  const registry = resolve(sampleGraphDeclaration, sampleSqlDeclaration, user);

  it('parses with AdminModelMeta and keeps the field order', () => {
    for (const model of registry.list()) {
      const meta = buildModelMeta(model);
      expect(AdminModelMeta.parse(meta)).toEqual(meta);
      expect(meta.fields.map((f) => f.name)).toEqual(Object.keys(model.fields));
    }
  });

  it('leaves out entity, columns, relationships, providers, and hooks', () => {
    const text = JSON.stringify(registry.list().map(buildModelMeta));
    for (const hidden of [
      'entity',
      'column',
      '"rel"',
      'targetLabel',
      'computeProvider',
      'updateProvider',
      'validate',
      'titleProperty',
      'href',
    ]) {
      expect(text).not.toContain(hidden);
    }
  });

  it('reports computed, readonly, quick actions, and bounds', () => {
    const meta = buildModelMeta(registry.get('user')!);
    const uploads = meta.fields.find((f) => f.name === 'uploads')!;
    expect(uploads).toMatchObject({ computed: true, readonly: true });
    expect(meta.fields.find((f) => f.name === 'status')!.quickActions).toEqual([
      { value: 'blocked', label: 'Block' },
      { value: 'active', label: 'Unblock' },
    ]);
    expect(meta.fields.find((f) => f.name === 'bonusRuns')).toMatchObject({
      min: 0,
      max: 1000,
      required: true,
      readonly: false,
    });
    expect(meta.fields.find((f) => f.name === 'id')!.readonly).toBe(true);
    expect(meta.maxPageSize).toBe(100);
    expect(meta.maxSearchLength).toBe(100);
  });

  it('shows the effective length of editable text fields only', () => {
    const meta = buildModelMeta(registry.get('sample-concept')!);
    expect(meta.fields.find((f) => f.name === 'name')!.maxLength).toBe(200);
    expect(meta.fields.find((f) => f.name === 'description')!.maxLength).toBe(5000);
    expect(meta.fields.find((f) => f.name === 'slug')!.maxLength).toBeUndefined();
  });

  it('marks every field read-only for a read-only model', () => {
    const readOnly = resolve({
      ...sampleGraphDeclaration,
      name: 'ro',
      readOnly: true,
      links: [],
    }).get('ro')!;
    const meta = buildModelMeta(readOnly);
    expect(meta.readOnly).toBe(true);
    expect(meta.fields.every((f) => f.readonly)).toBe(true);
  });

  it('lists links without their definitions', () => {
    const meta = buildModelMeta(registry.get('sample-concept')!);
    expect(meta.links).toEqual([
      { name: 'prerequisites', label: 'Prerequisites', kind: 'records', model: 'sample-concept' },
      { name: 'unlocks', label: 'Unlocks', kind: 'records' },
      { name: 'questionCount', label: 'Questions', kind: 'count' },
      { name: 'open', label: 'Open', kind: 'route' },
    ]);
  });
});

describe('computedFieldKeys and buildActions', () => {
  const registry = resolve(user, { ...sampleGraphDeclaration, readOnly: true });

  it('names the computed keys', () => {
    expect(computedFieldKeys(registry.get('user')!)).toEqual(['uploads']);
    expect(computedFieldKeys(registry.get('sample-concept')!)).toEqual([]);
  });

  it('returns only the actions whose value differs from the current one', () => {
    const model = registry.get('user')!;
    const record = (status: string) => ({ id: 'u1', title: 'u1', values: { status } });
    expect(buildActions(model, record('active'))).toEqual([
      { field: 'status', value: 'blocked', label: 'Block' },
    ]);
    expect(buildActions(model, record('blocked'))).toEqual([
      { field: 'status', value: 'active', label: 'Unblock' },
    ]);
  });

  it('returns [] for a read-only model', () => {
    expect(
      buildActions(registry.get('sample-concept')!, { id: 'x', title: 'x', values: {} }),
    ).toEqual([]);
  });
});
