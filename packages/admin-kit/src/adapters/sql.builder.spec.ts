import { describe, expect, it } from 'vitest';
import { createAdminRegistry } from '../registry';
import { createRecordingSqlPort, sampleGraphDeclaration, sampleSqlDeclaration } from '../testing';
import { createSqlAdapter } from './sql.adapter';
import {
  buildSqlCount,
  buildSqlDetail,
  buildSqlList,
  buildSqlUpdate,
  likePattern,
} from './sql.builder';

const registry = createAdminRegistry();
registry.register(sampleSqlDeclaration);
registry.register(sampleGraphDeclaration);
registry.freeze();
const model = registry.get('sample-item')!;

describe('sql builders', () => {
  it('list without search', () => {
    expect(buildSqlList(model, { page: 2, pageSize: 10 })).toEqual({
      text: [
        'SELECT "id", "item_title", "status", "created_at" FROM "sample_items"',
        'ORDER BY "created_at" DESC, "id" ASC',
        'LIMIT $1 OFFSET $2',
      ].join('\n'),
      params: [10, 10],
    });
  });

  it('list with search escapes the term and renumbers the placeholders', () => {
    const built = buildSqlList(model, { page: 1, pageSize: 25, search: '50%_off\\' });
    expect(built.text).toBe(
      [
        'SELECT "id", "item_title", "status", "created_at" FROM "sample_items"',
        `WHERE "item_title"::text ILIKE $1 ESCAPE '\\'`,
        'ORDER BY "created_at" DESC, "id" ASC',
        'LIMIT $2 OFFSET $3',
      ].join('\n'),
    );
    expect(built.params).toEqual(['%50\\%\\_off\\\\%', 25, 0]);
    expect(likePattern('a_b')).toBe('%a\\_b%');
  });

  it('count', () => {
    expect(buildSqlCount(model, {})).toEqual({
      text: 'SELECT count(*)::int AS total FROM "sample_items"',
      params: [],
    });
    const searched = buildSqlCount(model, { search: 'x' });
    expect(searched.text).toContain(`WHERE "item_title"::text ILIKE $1 ESCAPE '\\'`);
    expect(searched.params).toEqual(['%x%']);
  });

  it('detail compares the id as text and never selects computed fields', () => {
    const built = buildSqlDetail(model, 'abc');
    expect(built.text).toBe(
      'SELECT "id", "item_title", "status", "payload", "size", "created_at", "updated_at" FROM "sample_items"\nWHERE "id"::text = $1 LIMIT 1',
    );
    expect(built.text).not.toContain('total');
    expect(built.params).toEqual(['abc']);
  });

  it('update lists assignments in declaration order, casts json, and sets the updated-at column', () => {
    const built = buildSqlUpdate(model, 'abc', { size: 3, title: 'T', payload: { a: 1 } })!;
    expect(built.text).toBe(
      [
        'UPDATE "sample_items" SET "item_title" = $1, "payload" = $2::jsonb, "size" = $3, "updated_at" = now()',
        'WHERE "id"::text = $4',
        'RETURNING "id", "item_title", "status", "payload", "size", "created_at", "updated_at"',
      ].join('\n'),
    );
    expect(built.params).toEqual(['T', '{"a":1}', 3, 'abc']);
  });

  it('update ignores keys that are not editable and returns null for no assignment', () => {
    expect(buildSqlUpdate(model, 'abc', { id: 'x', createdAt: 1, total: 4 } as never)).toBeNull();
    const built = buildSqlUpdate(model, 'abc', { id: 'x', status: 'open' } as never)!;
    expect(built.params).toEqual(['open', 'abc']);
    expect(built.text).not.toContain('"id" = $');
  });

  it('refuses graph and unresolved models', () => {
    expect(() => buildSqlList(registry.get('sample-concept')!, { page: 1, pageSize: 5 })).toThrow();
    expect(() => buildSqlDetail({ ...model } as never, 'x')).toThrow();
  });
});

describe('createSqlAdapter', () => {
  it('maps columns back to field keys', async () => {
    const port = createRecordingSqlPort([
      [{ id: 'i1', item_title: 'T', status: 'open', created_at: new Date(0) }],
      [{ total: 12 }],
    ]);
    const result = await createSqlAdapter(port).list(model, { page: 1, pageSize: 25 });
    expect(result.total).toBe(12);
    expect(result.rows).toEqual([{ id: 'i1', title: 'T', status: 'open', createdAt: new Date(0) }]);
  });

  it('get returns null for no row, update returns null for an unknown id, links is empty', async () => {
    const adapter = createSqlAdapter(createRecordingSqlPort([[]]));
    expect(await adapter.get(model, 'x')).toBeNull();
    expect(await adapter.update(model, 'x', { title: 'T' })).toBeNull();
    expect(await adapter.links(model, 'x')).toEqual([]);
  });

  it('hostile values stay in parameters', async () => {
    const port = createRecordingSqlPort([[]]);
    const hostile = `"; DROP TABLE users; --`;
    const adapter = createSqlAdapter(port);
    await adapter.list(model, { page: 1, pageSize: 5, search: hostile });
    await adapter.get(model, hostile);
    await adapter.update(model, hostile, { title: hostile });
    for (const call of port.calls) expect(call.text).not.toContain('DROP');
  });
});
