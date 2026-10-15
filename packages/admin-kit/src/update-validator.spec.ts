import { describe, expect, it } from 'vitest';
import { createAdminRegistry } from './registry';
import { validateUpdate } from './update-validator';

const registry = createAdminRegistry();
registry.register({
  name: 'thing',
  label: 'Things',
  source: 'graph',
  entity: 'Concept',
  listDisplay: ['name'],
  fields: {
    id: { readonly: true },
    slug: { readonly: true },
    name: { type: 'string', required: true, maxLength: 10 },
    note: { type: 'text', maxLength: 20 },
    kind: { type: 'enum', choices: ['a', 'b'] },
    runs: { type: 'integer', min: 0, max: 1000, required: true },
    ratio: { type: 'number' },
    on: { type: 'boolean' },
    tags: { type: 'list' },
    createdAt: { type: 'datetime', readonly: true },
    total: { type: 'integer', computed: true },
  },
  computeProvider: 'p',
});
registry.register({
  name: 'jsonthing',
  label: 'J',
  source: 'sql',
  entity: 'js',
  listDisplay: ['key'],
  idField: 'key',
  fields: { key: { readonly: true }, value: { type: 'json', required: true } },
});
registry.freeze();
const model = registry.get('thing')!;

function issues(values: Record<string, unknown>) {
  const result = validateUpdate(model, values);
  if (result.ok) throw new Error('expected a failure');
  return result.details.issues;
}

describe('validateUpdate', () => {
  it('flags unknown, read-only, computed, and id keys', () => {
    expect(issues({ colour: 1 })).toEqual([{ path: 'values.colour', message: expect.any(String), code: 'unknown_field' }]);
    for (const key of ['slug', 'total', 'id', 'createdAt']) {
      expect(issues({ [key]: 'x' })).toEqual([{ path: `values.${key}`, message: expect.any(String), code: 'read_only' }]);
    }
  });

  it('flags wrong types', () => {
    expect(issues({ runs: '5' })[0]!.code).toBe('invalid_type');
    expect(issues({ runs: 1.5 })[0]!.code).toBe('invalid_type');
    expect(issues({ tags: 'a' })[0]!.code).toBe('invalid_type');
    expect(issues({ tags: ['a', 1] })[0]!.code).toBe('invalid_type');
    expect(issues({ on: 'true' })[0]!.code).toBe('invalid_type');
    expect(issues({ on: 1 })[0]!.code).toBe('invalid_type');
    expect(issues({ ratio: 'x' })[0]!.code).toBe('invalid_type');
    expect(issues({ name: 5 })[0]!.code).toBe('invalid_type');
  });

  it('required rejects null, empty string, and empty list but allows the key to be absent', () => {
    expect(issues({ name: null })[0]!.code).toBe('required');
    expect(issues({ name: '' })[0]!.code).toBe('required');
    expect(validateUpdate(model, { note: 'x' }).ok).toBe(true);
    const json = registry.get('jsonthing')!;
    expect((validateUpdate(json, { value: null }) as { ok: false }).ok).toBe(false);
  });

  it('checks choices, lengths, and ranges', () => {
    expect(issues({ kind: 'z' })[0]!.code).toBe('invalid_choice');
    expect(issues({ name: 'x'.repeat(11) })[0]!.code).toBe('too_long');
    expect(issues({ note: 'x'.repeat(21) })[0]!.code).toBe('too_long');
    expect(issues({ tags: Array.from({ length: 51 }, () => 'a') })[0]!.code).toBe('too_long');
    expect(issues({ tags: ['x'.repeat(101)] })[0]!.code).toBe('too_long');
    expect(issues({ runs: -1 })[0]!.code).toBe('out_of_range');
    expect(issues({ runs: 1001 })[0]!.code).toBe('out_of_range');
    expect(validateUpdate(model, { runs: 0 }).ok).toBe(true);
    expect(validateUpdate(model, { runs: 1000 }).ok).toBe(true);
  });

  it('json length and shape', () => {
    const json = registry.get('jsonthing')!;
    const long = validateUpdate(json, { value: 'x'.repeat(2001) });
    expect(!long.ok && long.details.issues[0]!.code).toBe('too_long');
    expect(validateUpdate(json, { value: { a: [1, 'b', false, null] } }).ok).toBe(true);
    expect(validateUpdate(json, { value: false }).ok).toBe(true);
  });

  it('returns all errors together', () => {
    const found = issues({ runs: -1, kind: 'z', colour: 1, slug: 'x' });
    expect(found.map((i) => i.code).sort()).toEqual(['invalid_choice', 'out_of_range', 'read_only', 'unknown_field']);
    expect(found.every((i) => i.path.startsWith('values.'))).toBe(true);
  });

  it('changes holds only declared editable keys in declaration order', () => {
    const result = validateUpdate(model, { runs: 5, name: 'ok', note: null });
    expect(result).toEqual({ ok: true, changes: { name: 'ok', note: null, runs: 5 } });
    expect(Object.keys((result as { changes: object }).changes)).toEqual(['name', 'note', 'runs']);
  });

  it('accepts null for a non-required field', () => {
    expect(validateUpdate(model, { kind: null, tags: null })).toEqual({ ok: true, changes: { kind: null, tags: null } });
  });

  it('survives hostile keys', () => {
    const hostile = JSON.parse('{"__proto__": 1, "constructor": 2}') as Record<string, unknown>;
    const found = issues({ ...hostile, ['k'.repeat(10_000)]: 1 });
    expect(found.every((i) => i.code === 'unknown_field')).toBe(true);
    expect(found.every((i) => i.path.length < 100)).toBe(true);
  });
});
