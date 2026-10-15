import { describe, expect, it } from 'vitest';
import { createAdminRegistry } from './registry';
import { sampleGraphDeclaration, sampleSqlDeclaration } from './testing';
import { toAdminValue, toRecordDto } from './values';

const registry = createAdminRegistry();
registry.register(sampleGraphDeclaration);
registry.register(sampleSqlDeclaration);
registry.register({
  name: 'tagged',
  label: 'Tagged',
  source: 'graph',
  entity: 'Decision',
  listDisplay: ['summary'],
  fields: { id: {}, summary: { type: 'text' }, flags: { type: 'list', readonly: true }, calls: { type: 'integer' }, ok: { type: 'boolean' } },
});
registry.freeze();

const concept = registry.get('sample-concept')!;
const tagged = registry.get('tagged')!;
const item = registry.get('sample-item')!;

describe('date conversion', () => {
  const field = concept.fields.createdAt!;
  const iso = '2026-10-11T09:00:00.000Z';

  it('maps epoch milliseconds, Date, and ISO strings to the same ISO string', () => {
    expect(toAdminValue(field, Date.parse(iso))).toBe(iso);
    expect(toAdminValue(field, new Date(iso))).toBe(iso);
    expect(toAdminValue(field, iso)).toBe(iso);
    expect(toAdminValue(field, 'not a date')).toBeNull();
    expect(toAdminValue(field, {})).toBeNull();
  });
});

describe('value conversion', () => {
  it('maps missing values to null and lists to string[]', () => {
    expect(toAdminValue(concept.fields.description!, undefined)).toBeNull();
    expect(toAdminValue(concept.fields.description!, null)).toBeNull();
    expect(toAdminValue(tagged.fields.flags!, ['a', 'b'])).toEqual(['a', 'b']);
    expect(toAdminValue(tagged.fields.flags!, undefined)).toBeNull();
  });

  it('converts numbers, booleans, and json', () => {
    expect(toAdminValue(tagged.fields.calls!, 5)).toBe(5);
    expect(toAdminValue(tagged.fields.calls!, '7')).toBe(7);
    expect(toAdminValue(tagged.fields.ok!, true)).toBe(true);
    expect(toAdminValue(item.fields.payload!, { a: [1] })).toEqual({ a: [1] });
  });
});

describe('toRecordDto', () => {
  const row = { id: 'c1', slug: 's', name: 'B-trees', description: 'd', createdAt: 1_700_000_000_000 };

  it('list returns only the listDisplay keys with id and title as strings', () => {
    const dto = toRecordDto(concept, row, 'list');
    expect(dto.id).toBe('c1');
    expect(dto.title).toBe('B-trees');
    expect(Object.keys(dto.values)).toEqual(['name', 'slug', 'createdAt']);
    expect(dto.values.createdAt).toBe('2023-11-14T22:13:20.000Z');
  });

  it('all returns every stored field and leaves computed keys out', () => {
    const dto = toRecordDto(item, { id: 'i1', title: 'T', status: 'open', payload: {}, size: 2, createdAt: new Date(0) }, 'all');
    expect(Object.keys(dto.values)).toEqual(['id', 'title', 'status', 'payload', 'size', 'createdAt', 'updatedAt']);
    expect(dto.values.updatedAt).toBeNull();
    expect('total' in dto.values).toBe(false);
  });

  it('uses the id as title when the title is missing', () => {
    expect(toRecordDto(concept, { id: 'c9' }, 'list').title).toBe('c9');
  });
});
