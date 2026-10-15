import { describe, expect, it } from 'vitest';
import { createAdminRegistry } from '../registry';
import { sampleGraphDeclaration, sampleSqlDeclaration, createRecordingGraphPort } from '../testing';
import { createGraphAdapter } from './graph.adapter';
import { buildGraphQueries } from './graph.cypher';

const registry = createAdminRegistry();
registry.register(sampleGraphDeclaration);
registry.register(sampleSqlDeclaration);
registry.register({
  name: 'no-search',
  label: 'No search',
  source: 'graph',
  entity: 'Task',
  listDisplay: ['kind', 'createdAt'],
  titleField: 'id',
  fields: { id: { readonly: true }, kind: { type: 'enum', choices: ['a'] }, createdAt: { type: 'datetime', readonly: true } },
  ordering: ['-createdAt', 'id'],
  readOnly: true,
});
registry.freeze();

const model = registry.get('sample-concept')!;
const byName = (name: string) => buildGraphQueries(model).find((q) => q.name === name)!;

describe('buildGraphQueries', () => {
  it('names match the graph package pattern and carry the right mode', () => {
    const queries = buildGraphQueries(model);
    for (const q of queries) expect(q.name).toMatch(/^admin_[a-z0-9]+(_[a-z0-9]+)+$/);
    expect(queries.map((q) => q.name)).toEqual([
      'admin_sample_concept_list',
      'admin_sample_concept_count',
      'admin_sample_concept_list_search',
      'admin_sample_concept_count_search',
      'admin_sample_concept_detail',
      'admin_sample_concept_update',
      'admin_sample_concept_link_prerequisites',
      'admin_sample_concept_link_unlocks',
      'admin_sample_concept_link_question_count',
    ]);
    expect(queries.filter((q) => q.mode === 'write').map((q) => q.name)).toEqual(['admin_sample_concept_update']);
  });

  it('list and search match data-model section 7', () => {
    expect(byName('admin_sample_concept_list').cypher).toBe(
      [
        'MATCH (n:Concept)',
        'RETURN n.id AS id, n.name AS name, n.slug AS slug, n.createdAt AS createdAt',
        'ORDER BY n.name ASC, n.id ASC',
        'SKIP $skip LIMIT $limit',
      ].join('\n'),
    );
    expect(byName('admin_sample_concept_list_search').cypher).toBe(
      [
        'MATCH (n:Concept)',
        'WHERE toLower(n.slug) CONTAINS $search OR toLower(n.name) CONTAINS $search OR toLower(n.description) CONTAINS $search',
        'RETURN n.id AS id, n.name AS name, n.slug AS slug, n.createdAt AS createdAt',
        'ORDER BY n.name ASC, n.id ASC',
        'SKIP $skip LIMIT $limit',
      ].join('\n'),
    );
    expect(byName('admin_sample_concept_count').cypher).toBe('MATCH (n:Concept)\nRETURN count(n) AS total');
    expect(byName('admin_sample_concept_count_search').cypher).toContain('WHERE toLower(n.slug) CONTAINS $search');
  });

  it('detail and update match data-model section 7', () => {
    const fields = 'n.id AS id, n.slug AS slug, n.name AS name, n.description AS description, n.createdAt AS createdAt';
    expect(byName('admin_sample_concept_detail').cypher).toBe(`MATCH (n:Concept {id: $id})\nRETURN ${fields}\nLIMIT 1`);
    expect(byName('admin_sample_concept_update').cypher).toBe(`MATCH (n:Concept {id: $id})\nSET n += $props\nRETURN ${fields}`);
  });

  it('link texts match data-model section 7 and a count link reads no target property', () => {
    expect(byName('admin_sample_concept_link_prerequisites').cypher).toBe(
      [
        'MATCH (n:Concept {id: $id})<-[:PREREQUISITE_OF]-(m:Concept)',
        'RETURN m.id AS id, m.name AS title',
        'ORDER BY m.id ASC',
        'LIMIT $limit',
      ].join('\n'),
    );
    expect(byName('admin_sample_concept_link_unlocks').cypher).toContain('-[:PREREQUISITE_OF]->(m:Concept)');
    const count = byName('admin_sample_concept_link_question_count').cypher;
    expect(count).toBe('MATCH (n:Concept {id: $id})<-[:TESTS]-(m:Question)\nRETURN count(m) AS total');
    expect(count).not.toMatch(/m\./);
  });

  it('never returns a whole node', () => {
    for (const q of buildGraphQueries(model)) expect(q.cypher).not.toMatch(/RETURN n\b(?!\.)/);
  });

  it('honours the - prefix and appends the id field', () => {
    const none = registry.get('no-search')!;
    const list = buildGraphQueries(none).find((q) => q.name === 'admin_no_search_list')!;
    expect(list.cypher).toContain('ORDER BY n.createdAt DESC, n.id ASC\n');
    expect(list.cypher).toContain('RETURN n.id AS id, n.kind AS kind, n.createdAt AS createdAt');
  });

  it('a model without searchFields gets no _search queries, and a read-only one no update', () => {
    const names = buildGraphQueries(registry.get('no-search')!).map((q) => q.name);
    expect(names).toEqual(['admin_no_search_list', 'admin_no_search_count', 'admin_no_search_detail']);
  });

  it('refuses models that are not resolved, branded models, and sql models', () => {
    expect(() => buildGraphQueries({ ...model } as never)).toThrow();
    expect(() => buildGraphQueries(sampleGraphDeclaration as never)).toThrow();
    expect(() => buildGraphQueries(registry.get('sample-item')!)).toThrow();
  });
});

describe('createGraphAdapter', () => {
  it('registers every statement once at creation and runs by name', async () => {
    const port = createRecordingGraphPort({
      admin_sample_concept_list: [{ id: 'c1', name: 'A' }],
      admin_sample_concept_count: [{ total: 7 }],
    });
    const adapter = createGraphAdapter(port, registry.list());
    expect(port.registered.map((q) => q.name)).toContain('admin_sample_concept_list');
    expect(port.registered.some((q) => q.name.startsWith('admin_sample_item'))).toBe(false);
    const registeredBefore = port.registered.length;

    const result = await adapter.list(model, { page: 3, pageSize: 10 });
    expect(result).toEqual({ rows: [{ id: 'c1', name: 'A' }], total: 7 });
    expect(port.calls.find((c) => c.name === 'admin_sample_concept_list')!.params).toEqual({ skip: 20, limit: 10 });
    expect(port.registered.length).toBe(registeredBefore);
  });

  it('search uses the _search statements with the term as a parameter', async () => {
    const port = createRecordingGraphPort();
    const adapter = createGraphAdapter(port, registry.list());
    await adapter.list(model, { page: 1, pageSize: 5, search: "x') RETURN 1 //" });
    expect(port.calls.map((c) => c.name).sort()).toEqual(['admin_sample_concept_count_search', 'admin_sample_concept_list_search']);
    expect(port.calls[0]!.params.search).toBe("x') RETURN 1 //");
  });

  it('update builds $props from the editable fields only, even when changes holds other keys', async () => {
    const port = createRecordingGraphPort({ admin_sample_concept_update: [{ id: 'c1' }] });
    const adapter = createGraphAdapter(port, registry.list());
    await adapter.update(model, 'c1', { name: 'N', slug: 'forced', nope: 'x', createdAt: 5 } as never);
    expect(port.calls[0]).toEqual({ name: 'admin_sample_concept_update', params: { id: 'c1', props: { name: 'N' } } });
  });

  it('links: items, truncation, title fallback, counts, and routes', async () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ id: `c${i}`, title: i === 0 ? null : `T${i}` }));
    const port = createRecordingGraphPort({
      admin_sample_concept_link_prerequisites: many,
      admin_sample_concept_link_unlocks: [{ id: 'c9', title: 'Nine' }],
      admin_sample_concept_link_question_count: [{ total: 3 }],
    });
    const adapter = createGraphAdapter(port, registry.list());
    const links = await adapter.links(model, 'a/b');
    expect(links).toHaveLength(4);
    const first = links[0]!;
    expect(first.kind === 'records' && first.items).toHaveLength(50);
    expect(first.kind === 'records' && first.truncated).toBe(true);
    expect(first.kind === 'records' && first.items[0]).toEqual({ id: 'c0', title: 'c0' });
    expect(first.kind === 'records' && first.model).toBe('sample-concept');
    expect(links[1]).toMatchObject({ kind: 'records', truncated: false, items: [{ id: 'c9', title: 'Nine' }] });
    expect(links[1]).not.toHaveProperty('model');
    expect(links[2]).toEqual({ kind: 'count', name: 'questionCount', label: 'Questions', count: 3 });
    expect(links[3]).toEqual({ kind: 'route', name: 'open', label: 'Open', href: '/concepts/a%2Fb' });
    expect(port.calls.find((c) => c.name.endsWith('prerequisites'))!.params).toEqual({ id: 'a/b', limit: 51 });
  });
});
