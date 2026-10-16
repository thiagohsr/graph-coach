// Admin kit queries against a real FalkorDB (spec 006 T023, T037, T044). The port is the same shape the API supplies:
// register = GraphKit.defineQuery, run = GraphKit.query.
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createAdminRegistry,
  createGraphAdapter,
  type AdminAdapter,
  type AdminDeclaration,
  type GraphPort,
  type ResolvedAdminModel,
} from '@coach/admin-kit';
import { buildGraphQueries, sampleGraphDeclaration } from '@coach/admin-kit/testing';
import type { QueryParams } from '../src/client';
import type { FixtureEdge, FixtureNode } from '../src/fixture';
import { useTestGraph } from '../src/testing';

const graph = useTestGraph();

const BASE = 1_760_000_000_000;
const HOSTILE = 'Quo\'te "dq" back\\slash\nnew`tick';
const concept = (n: number) => `c-${String(n).padStart(2, '0')}`;

function portOf(): GraphPort {
  const kit = graph().graph;
  return {
    register: (query) =>
      void kit.defineQuery({
        name: query.name,
        cypher: query.cypher,
        mode: query.mode,
        owner: '006',
      }),
    run: (name, params) => kit.query(name, params as QueryParams),
  };
}

// ─── Declarations used here (self-contained: graph-kit does not import the API's registrations) ──────────────

const taskDeclaration: AdminDeclaration = {
  name: 'task',
  label: 'Tasks',
  source: 'graph',
  entity: 'Task',
  readOnly: true,
  titleField: 'id',
  listDisplay: ['kind', 'status', 'createdAt'],
  searchFields: ['id'],
  ordering: ['-createdAt'],
  fields: {
    id: { readonly: true },
    kind: { type: 'enum', choices: ['ingest', 'generate', 'cover'], readonly: true },
    status: { type: 'string', readonly: true },
    inputTokens: { type: 'integer', readonly: true },
    createdAt: { type: 'datetime', readonly: true },
  },
  links: [
    {
      kind: 'records',
      name: 'producedConcepts',
      label: 'Produced concepts',
      rel: 'PRODUCED',
      direction: 'out',
      targetLabel: 'Concept',
      titleProperty: 'name',
      model: 'sample-concept',
    },
    {
      kind: 'count',
      name: 'producedQuestions',
      label: 'Produced questions',
      rel: 'PRODUCED',
      direction: 'out',
      targetLabel: 'Question',
    },
    {
      kind: 'records',
      name: 'requestedBy',
      label: 'Requested by',
      rel: 'REQUESTED',
      direction: 'in',
      targetLabel: 'Learner',
      titleProperty: 'displayName',
    },
    {
      kind: 'records',
      name: 'concerns',
      label: 'Concerns',
      rel: 'CONCERNS',
      direction: 'out',
      targetLabel: 'Source',
      titleProperty: 'title',
    },
  ],
};

const decisionDeclaration: AdminDeclaration = {
  name: 'decision',
  label: 'Decisions',
  source: 'graph',
  entity: 'Decision',
  readOnly: true,
  titleField: 'summary',
  listDisplay: ['kind', 'summary', 'createdAt'],
  searchFields: ['summary'],
  ordering: ['-createdAt'],
  fields: {
    id: { readonly: true },
    kind: { type: 'enum', choices: ['recommendation', 'coverage_request'], readonly: true },
    summary: { type: 'text', readonly: true },
    flags: { type: 'list', readonly: true },
    createdAt: { type: 'datetime', readonly: true },
  },
  links: [
    {
      kind: 'records',
      name: 'learner',
      label: 'Learner',
      rel: 'FOR',
      direction: 'out',
      targetLabel: 'Learner',
      titleProperty: 'displayName',
    },
    {
      kind: 'records',
      name: 'puzzle',
      label: 'Puzzle',
      rel: 'RECOMMENDED',
      direction: 'out',
      targetLabel: 'Puzzle',
      titleProperty: 'name',
    },
    {
      kind: 'records',
      name: 'evidenceConcepts',
      label: 'Evidence',
      rel: 'BECAUSE',
      direction: 'out',
      targetLabel: 'Concept',
      titleProperty: 'name',
      model: 'sample-concept',
    },
  ],
};

const registry = createAdminRegistry();
registry.register(sampleGraphDeclaration);
registry.register(taskDeclaration);
registry.register(decisionDeclaration);
registry.freeze();

const conceptModel = registry.get('sample-concept')!;
const taskModel = registry.get('task')!;
const decisionModel = registry.get('decision')!;

let adapter: AdminAdapter;

beforeAll(async () => {
  adapter = createGraphAdapter(portOf(), registry.list());

  const nodes: FixtureNode[] = [];
  for (let n = 1; n <= 30; n += 1) {
    nodes.push({
      label: 'Concept',
      key: concept(n),
      props: {
        slug: `concept-${n}`,
        name: n === 30 ? HOSTILE : `Concept ${String(n).padStart(2, '0')}`,
        ...(n === 7 ? {} : { description: n % 2 === 0 ? 'About TREES and graphs' : 'Plain text' }),
        createdAt: BASE + n * 1000,
      },
    });
  }
  const edges: FixtureEdge[] = [];

  // A task that produced two concepts and three questions; a learner who requested it; a source it concerns.
  nodes.push(
    { label: 'Learner', key: 'u-1', props: { displayName: 'Lena Learner', createdAt: BASE } },
    {
      label: 'Source',
      key: 's-1',
      props: { title: 'Notes', kind: 'text', content: 'SECRET SOURCE TEXT', createdAt: BASE },
    },
    {
      label: 'Task',
      key: 't-1',
      props: { kind: 'ingest', status: 'done', inputTokens: 100, createdAt: BASE + 5 },
    },
    { label: 'Question', key: 'q-1', props: { sentence: 'A secret question', status: 'approved' } },
    { label: 'Question', key: 'q-2', props: { sentence: 'Another', status: 'approved' } },
    { label: 'Question', key: 'q-3', props: { sentence: 'A third', status: 'draft' } },
  );
  edges.push(
    {
      type: 'PRODUCED',
      from: { label: 'Task', key: 't-1' },
      to: { label: 'Concept', key: concept(1) },
    },
    {
      type: 'PRODUCED',
      from: { label: 'Task', key: 't-1' },
      to: { label: 'Concept', key: concept(2) },
    },
    ...['q-1', 'q-2', 'q-3'].map<FixtureEdge>((q) => ({
      type: 'PRODUCED',
      from: { label: 'Task', key: 't-1' },
      to: { label: 'Question', key: q },
    })),
    {
      type: 'REQUESTED',
      from: { label: 'Learner', key: 'u-1' },
      to: { label: 'Task', key: 't-1' },
    },
    { type: 'CONCERNS', from: { label: 'Task', key: 't-1' }, to: { label: 'Source', key: 's-1' } },
  );

  // A task with 51 produced concepts (truncation).
  nodes.push({
    label: 'Task',
    key: 't-big',
    props: { kind: 'generate', status: 'done', createdAt: BASE + 6 },
  });
  for (let n = 1; n <= 30; n += 1) {
    edges.push({
      type: 'PRODUCED',
      from: { label: 'Task', key: 't-big' },
      to: { label: 'Concept', key: concept(n) },
    });
  }
  for (let n = 1; n <= 21; n += 1) {
    nodes.push({
      label: 'Concept',
      key: `x-${n}`,
      props: { slug: `x-${n}`, name: `Extra ${n}`, createdAt: BASE },
    });
    edges.push({
      type: 'PRODUCED',
      from: { label: 'Task', key: 't-big' },
      to: { label: 'Concept', key: `x-${n}` },
    });
  }

  // A decision with FOR, RECOMMENDED, and BECAUSE edges, a flags list, and one evidence concept without a name.
  nodes.push(
    {
      label: 'Decision',
      key: 'd-1',
      props: {
        kind: 'recommendation',
        summary: 'Practise trees',
        flags: ['cold_start', 'gap'],
        createdAt: BASE + 9,
      },
    },
    {
      label: 'Puzzle',
      key: 'p-1',
      props: {
        name: 'Trees 101',
        origin: 'seed',
        status: 'published',
        visibility: 'public',
        createdAt: BASE,
      },
    },
    { label: 'Concept', key: 'nameless', props: { slug: 'nameless', createdAt: BASE } },
  );
  edges.push(
    { type: 'FOR', from: { label: 'Decision', key: 'd-1' }, to: { label: 'Learner', key: 'u-1' } },
    {
      type: 'RECOMMENDED',
      from: { label: 'Decision', key: 'd-1' },
      to: { label: 'Puzzle', key: 'p-1' },
    },
    {
      type: 'BECAUSE',
      from: { label: 'Decision', key: 'd-1' },
      to: { label: 'Concept', key: concept(3) },
      props: { weight: 1, role: 'target' },
    },
    {
      type: 'BECAUSE',
      from: { label: 'Decision', key: 'd-1' },
      to: { label: 'Concept', key: 'nameless' },
      props: { weight: 1, role: 'driver' },
    },
  );
  nodes.push({
    label: 'Decision',
    key: 'd-2',
    props: { kind: 'coverage_request', summary: 'No flags', createdAt: BASE + 10 },
  });

  await graph().load({ nodes, edges });
});

const namesSorted = () => {
  const names = Array.from({ length: 30 }, (_, i) =>
    i + 1 === 30 ? HOSTILE : `Concept ${String(i + 1).padStart(2, '0')}`,
  );
  return [...names, ...Array.from({ length: 21 }, (_, i) => `Extra ${i + 1}`)].sort();
};

describe('generated queries are valid Cypher', () => {
  it('every statement of the sample, task, and decision models runs on the real server', async () => {
    const kit = graph().graph;
    for (const model of registry.list()) {
      for (const query of buildGraphQueries(model)) {
        const info = kit.listQueries().find((q) => q.name === query.name)!;
        expect(info, query.name).toBeDefined();
        const params: QueryParams = {};
        for (const name of info.params) {
          params[name] = name === 'skip' ? 0 : name === 'limit' ? 5 : name === 'props' ? {} : 'x';
        }
        await expect(kit.query(query.name, params), query.name).resolves.toBeInstanceOf(Array);
      }
    }
  });
});

describe('list, count, detail (R-V2, R-V4)', () => {
  it('returns the declared columns, in order, for each page size (SKIP and LIMIT take parameters)', async () => {
    const all = namesSorted();
    const first = await adapter.list(conceptModel, { page: 1, pageSize: 10 });
    expect(first.total).toBe(52);
    expect(first.rows).toHaveLength(10);
    expect(first.rows.map((r) => r.name)).toEqual(all.slice(0, 10));
    expect(Object.keys(first.rows[0]!).sort()).toEqual(['createdAt', 'id', 'name', 'slug']);

    const second = await adapter.list(conceptModel, { page: 2, pageSize: 10 });
    expect(second.rows.map((r) => r.name)).toEqual(all.slice(10, 20));
    const last = await adapter.list(conceptModel, { page: 6, pageSize: 10 });
    // 52 concepts: the last page holds the final named one and the concept without a name (nulls sort last).
    expect(last.rows).toHaveLength(2);
    expect(last.rows[1]!.name).toBeNull();
    const past = await adapter.list(conceptModel, { page: 7, pageSize: 10 });
    expect(past.rows).toEqual([]);
    expect(past.total).toBe(52);
  });

  it('a hostile name (quotes, backslash, newline, backtick) round-trips unchanged', async () => {
    const row = await adapter.get(conceptModel, concept(30));
    expect(row!.name).toBe(HOSTILE);
    const listed = await adapter.list(conceptModel, { page: 1, pageSize: 100 });
    expect(listed.rows.map((r) => r.name)).toContain(HOSTILE);
  });

  it('detail returns null for a missing property and for a missing node', async () => {
    const row = await adapter.get(conceptModel, concept(7));
    expect(row).toMatchObject({ id: concept(7), slug: 'concept-7', description: null });
    expect(Object.keys(row!).sort()).toEqual(['createdAt', 'description', 'id', 'name', 'slug']);
    expect(await adapter.get(conceptModel, 'nope')).toBeNull();
  });
});

describe('search (R-V1)', () => {
  it('is case-insensitive, matches a substring, and does not error on the null property', async () => {
    const trees = await adapter.list(conceptModel, { page: 1, pageSize: 100, search: 'trees' });
    // Even-numbered concepts have "About TREES" in the description (concept 7 has no description at all).
    expect(trees.total).toBe(15);
    expect(trees.rows.every((r) => Number(String(r.id).slice(2)) % 2 === 0)).toBe(true);

    const slug = await adapter.list(conceptModel, { page: 1, pageSize: 100, search: 'concept-1' });
    expect(slug.total).toBe(11); // concept-1 and concept-10..19
    const name = await adapter.list(conceptModel, { page: 1, pageSize: 100, search: 'concept 0' });
    expect(name.total).toBe(9);
  });

  it('a hostile term matches nothing and changes nothing', async () => {
    const before = await graph().count('Concept');
    for (const term of [
      "') RETURN 1 //",
      '" OR 1=1 //',
      'x} DETACH DELETE n //',
      '$search',
      '\\n',
    ]) {
      const result = await adapter.list(conceptModel, { page: 1, pageSize: 100, search: term });
      expect(result, term).toEqual({ rows: [], total: 0 });
    }
    expect(await graph().count('Concept')).toBe(before);
  });

  it('a backslash, a backtick, and a newline in the term are literal characters', async () => {
    for (const term of ['\\', '`', '\nnew']) {
      const result = await adapter.list(conceptModel, { page: 1, pageSize: 10, search: term });
      expect(result.total, JSON.stringify(term)).toBe(1);
    }
  });

  it('finds the hostile name by a fragment containing a quote', async () => {
    const result = await adapter.list(conceptModel, { page: 1, pageSize: 10, search: "quo'te" });
    expect(result.total).toBe(1);
  });
});

describe('update (R-V3)', () => {
  it('changes only the given properties; null removes one; the rest stay', async () => {
    const changed = await adapter.update(conceptModel, concept(5), { name: 'Renamed' });
    expect(changed).toMatchObject({
      id: concept(5),
      name: 'Renamed',
      slug: 'concept-5',
      description: 'Plain text',
    });

    const cleared = await adapter.update(conceptModel, concept(5), { description: null });
    expect(cleared!.description).toBeNull();
    const [raw] = await graph().cypher<{ props: Record<string, unknown> }>(
      'MATCH (n:Concept {id: $id}) RETURN properties(n) AS props',
      { id: concept(5) },
    );
    expect(raw!.props).not.toHaveProperty('description');
    expect(raw!.props).toMatchObject({
      name: 'Renamed',
      slug: 'concept-5',
      createdAt: BASE + 5000,
    });
  });

  it('writes only editable keys even when changes is forced to hold others', async () => {
    await adapter.update(conceptModel, concept(6), {
      name: 'Six',
      slug: 'hacked',
      evil: 'x',
      createdAt: 1,
    } as never);
    const row = await adapter.get(conceptModel, concept(6));
    expect(row).toMatchObject({ name: 'Six', slug: 'concept-6', createdAt: BASE + 6000 });
    const [raw] = await graph().cypher<{ props: Record<string, unknown> }>(
      'MATCH (n:Concept {id: $id}) RETURN properties(n) AS props',
      { id: concept(6) },
    );
    expect(raw!.props).not.toHaveProperty('evil');
  });

  it('a hostile value is stored as data', async () => {
    const value = "'}) DETACH DELETE n //";
    await adapter.update(conceptModel, concept(8), { name: value });
    expect((await adapter.get(conceptModel, concept(8)))!.name).toBe(value);
    expect(await graph().count('Concept')).toBe(52);
  });

  it('an unknown id returns null and creates nothing', async () => {
    const before = await graph().count('Concept');
    expect(await adapter.update(conceptModel, 'ghost', { name: 'Ghost' })).toBeNull();
    expect(await graph().count('Concept')).toBe(before);
  });
});

describe('links (R-V5, R-V6)', () => {
  async function linksOf(model: ResolvedAdminModel, id: string) {
    return Object.fromEntries((await adapter.links(model, id)).map((link) => [link.name, link]));
  }

  it('returns records, counts, and no questions', async () => {
    const links = await linksOf(taskModel, 't-1');
    expect(links.producedConcepts).toMatchObject({
      kind: 'records',
      model: 'sample-concept',
      truncated: false,
    });
    const produced = links.producedConcepts as { items: { id: string; title: string }[] };
    expect(produced.items).toEqual([
      { id: concept(1), title: 'Concept 01' },
      { id: concept(2), title: 'Concept 02' },
    ]);
    expect(links.producedQuestions).toEqual({
      kind: 'count',
      name: 'producedQuestions',
      label: 'Produced questions',
      count: 3,
    });
    expect(links.requestedBy).toMatchObject({ items: [{ id: 'u-1', title: 'Lena Learner' }] });
    expect(links.concerns).toMatchObject({ items: [{ id: 's-1', title: 'Notes' }] });
    expect(JSON.stringify(links)).not.toContain('secret');
    expect(JSON.stringify(links)).not.toContain('SECRET');
  });

  it('a record link holds 50 items and sets truncated for 51 targets', async () => {
    const link = (await linksOf(taskModel, 't-big')).producedConcepts as {
      items: unknown[];
      truncated: boolean;
    };
    expect(link.items).toHaveLength(50);
    expect(link.truncated).toBe(true);
  });

  it('a task with no relationships has empty links and a zero count', async () => {
    const links = await linksOf(taskModel, 'nope');
    expect(links.producedQuestions).toMatchObject({ count: 0 });
    expect(links.producedConcepts).toMatchObject({ items: [], truncated: false });
  });

  it('decision: FOR, RECOMMENDED, BECAUSE; a target without the title property uses its id; flags is a list', async () => {
    const links = await linksOf(decisionModel, 'd-1');
    expect(links.learner).toMatchObject({ items: [{ id: 'u-1', title: 'Lena Learner' }] });
    expect(links.puzzle).toMatchObject({ items: [{ id: 'p-1', title: 'Trees 101' }] });
    const evidence = (links.evidenceConcepts as { items: { id: string; title: string }[] }).items;
    expect(evidence).toEqual([
      { id: concept(3), title: 'Concept 03' },
      { id: 'nameless', title: 'nameless' },
    ]);
    const row = await adapter.get(decisionModel, 'd-1');
    expect(row!.flags).toEqual(['cold_start', 'gap']);
    expect((await adapter.get(decisionModel, 'd-2'))!.flags).toBeNull();
    const none = await linksOf(decisionModel, 'd-2');
    expect(none.puzzle).toMatchObject({ items: [] });
  });

  it('the count text reads no property of the target', () => {
    const count = buildGraphQueries(taskModel).find(
      (q) => q.name === 'admin_task_link_produced_questions',
    )!;
    expect(count.cypher).toBe(
      'MATCH (n:Task {id: $id})-[:PRODUCED]->(m:Question)\nRETURN count(m) AS total',
    );
  });

  it('a decision with no puzzle lists no puzzle', async () => {
    const list = await adapter.list(decisionModel, { page: 1, pageSize: 10 });
    expect(list.total).toBe(2);
    expect(list.rows.map((r) => r.id)).toEqual(['d-2', 'd-1']); // -createdAt
  });
});
