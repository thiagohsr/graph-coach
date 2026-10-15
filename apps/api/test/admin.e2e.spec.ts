// Admin kit over HTTP (spec 006): models, list, detail, search, edit, links, usage. Fixtures are synthetic.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { GraphKit } from '@coach/graph-kit';
import type { FixtureEdge, FixtureNode } from '@coach/graph-kit';
import {
  AdminDetailResponse,
  AdminListResponse,
  AdminModelMeta,
  type AdminFieldMeta,
} from '@coach/types';
import { users } from '../src/apps/accounts/user.model';
import { CodesService } from '../src/apps/allowance/codes.service';
import { adminSettings } from '../src/common/settings/admin-setting.model';
import { SettingsService } from '../src/common/settings/settings.service';
import { describeRoleMatrix } from './support/role-matrix';
import { createTestApp, type TestApp, type TestUser } from './support/test-app';

let app: TestApp;
let admin: TestUser;

type Verb = 'get' | 'patch';
const call = (verb: Verb, path: string, user: TestUser, body?: unknown) => {
  const req = app.http[verb](path).set(user.auth);
  return body === undefined ? req : req.send(body as object);
};
const get = (path: string, user: TestUser = admin) => call('get', path, user);
const patch = (path: string, body: unknown, user: TestUser = admin) => call('patch', path, user, body);

const field = (meta: AdminModelMeta, name: string): AdminFieldMeta => {
  const found = meta.fields.find((f) => f.name === name);
  if (!found) throw new Error(`no field ${name} on ${meta.name}`);
  return found;
};

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SECRET_SOURCE_TEXT = 'SECRET SOURCE TEXT: the mitochondria is the powerhouse';
const SECRET_BRIEF = 'SECRET BRIEF subject Fermentation';
const SECRET_OUTLINE = 'SECRET OUTLINE one two';
const SECRET_QUESTION = 'SECRET QUESTION the capital of ___ is Paris';
const SHARED_NAME = 'Sharedwith Samantha';
const DISTRACTOR = 'SECRETDISTRACTOR';

let now = 0;
const recent = (offsetMs = 60_000) => now - offsetMs;

beforeAll(async () => {
  app = await createTestApp();
  admin = await app.createUser({ role: 'admin', name: 'Ada Admin' });
  now = app.clock.now().getTime();
});
afterAll(async () => {
  await app?.close();
});

describeRoleMatrix(() => app, [
  { method: 'GET', path: '/admin/models', allowed: ['admin'] },
  { method: 'GET', path: '/admin/concept', allowed: ['admin'] },
  { method: 'GET', path: '/admin/concept/ghost', allowed: ['admin'] },
  { method: 'PATCH', path: '/admin/concept/ghost', body: { values: { name: 'X' } }, allowed: ['admin'] },
]);

// ─── US1: models ─────────────────────────────────────────────────────────────

describe('GET /admin/models', () => {
  let models: AdminModelMeta[];
  let text: string;
  const by = (name: string) => models.find((m) => m.name === name)!;

  beforeAll(async () => {
    const res = await get('/admin/models');
    expect(res.status).toBe(200);
    text = JSON.stringify(res.body);
    models = (res.body as unknown[]).map((m) => AdminModelMeta.parse(m));
  });

  it('lists exactly the eight models, sorted by group then label, without question or chunk', () => {
    expect(models.map((m) => m.name).sort()).toEqual(
      ['access-code', 'admin-setting', 'concept', 'decision', 'puzzle', 'source', 'task', 'user'],
    );
    const keys = models.map((m) => `${m.group}|${m.label}`);
    expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b, 'en')));
    expect(models.map((m) => m.group)).toEqual(['Accounts', 'Accounts', 'Accounts', 'Agents', 'Agents', 'Knowledge', 'Knowledge', 'Puzzles']);
  });

  it('marks source, puzzle, task, and decision read-only, and concept and the account models editable', () => {
    for (const name of ['source', 'puzzle', 'task', 'decision']) expect(by(name).readOnly, name).toBe(true);
    for (const name of ['user', 'concept', 'admin-setting', 'access-code']) expect(by(name).readOnly, name).toBe(false);
    for (const name of ['source', 'puzzle', 'task', 'decision']) {
      expect(by(name).fields.every((f) => f.readonly), name).toBe(true);
    }
  });

  it('exposes none of the private names', () => {
    const lower = text.replace(/embeddingTokens|Embedding tokens/g, '').toLowerCase();
    for (const forbidden of ['password', 'embedding', 'answers', 'distractors', 'fingerprint', 'cognito', 'code_hash', 'codehash']) {
      expect(lower, forbidden).not.toContain(forbidden);
    }
    for (const m of models) {
      for (const f of m.fields) {
        expect(['content', 'brief', 'outline', 'embedding', 'answers', 'distractors', 'password']).not.toContain(f.name);
      }
    }
  });

  it('shows no money: no field name or label mentions cost, price, or a currency', () => {
    for (const m of models) {
      for (const f of m.fields) {
        expect(`${f.name} ${f.label}`, `${m.name}.${f.name}`).not.toMatch(/cost|price|dollar|\busd\b|\beur\b|[$€£]/i);
      }
    }
  });

  it('user: read-only e-mail and name, editable role, status, and bonus runs, computed counts', () => {
    const user = by('user');
    expect(field(user, 'email').readonly).toBe(true);
    expect(field(user, 'displayName').readonly).toBe(true);
    expect(field(user, 'role')).toMatchObject({ readonly: false, type: 'enum', choices: ['learner', 'reviewer', 'admin'] });
    expect(field(user, 'status').quickActions).toEqual([
      { value: 'blocked', label: 'Block' },
      { value: 'active', label: 'Unblock' },
    ]);
    for (const name of ['bonusSourceRuns', 'bonusPromptRuns']) {
      expect(field(user, name), name).toMatchObject({ type: 'integer', readonly: false, min: 0, max: 1000, required: true });
    }
    expect(field(user, 'limitsLiftedUntil').readonly).toBe(true);
    for (const name of ['uploadsThisMonth', 'promptsThisMonth', 'creationsLastHour', 'tokensThisMonth']) {
      expect(field(user, name), name).toMatchObject({ computed: true, readonly: true, type: 'integer' });
    }
    expect(field(user, 'tokensThisMonth').label).toBe('Tokens this month');
  });

  it('task and decision show usage as read-only integers', () => {
    for (const name of ['task', 'decision']) {
      for (const f of ['modelCalls', 'inputTokens', 'outputTokens', 'embeddingTokens']) {
        expect(field(by(name), f), `${name}.${f}`).toMatchObject({ type: 'integer', readonly: true });
      }
    }
  });

  it('access-code has only disabled editable; source and puzzle show their kind and origin', () => {
    const editable = by('access-code').fields.filter((f) => !f.readonly).map((f) => f.name);
    expect(editable).toEqual(['disabled']);
    expect(field(by('source'), 'kind').choices).toContain('prompt');
    expect(field(by('puzzle'), 'origin').choices).toEqual(['seed', 'upload', 'prompt']);
  });
});

// ─── US2: list, detail, search ───────────────────────────────────────────────

describe('browse', () => {
  let target: TestUser;
  let uploaderId: string;

  beforeAll(async () => {
    const nodes: FixtureNode[] = [];
    for (let n = 1; n <= 30; n += 1) {
      nodes.push({
        label: 'Concept',
        key: `concept-${String(n).padStart(2, '0')}`,
        props: {
          slug: `concept-${n}`,
          name: `Concept ${String(n).padStart(2, '0')}`,
          description: n === 5 ? 'Contains a TREE inside' : 'Plain',
          createdAt: now - n * 1000,
        },
      });
    }
    nodes.push(
      { label: 'Concept', key: 'concept-bin', props: { slug: 'binary-tree', name: 'Binary tree', createdAt: now } },
      { label: 'Concept', key: 'concept-red', props: { slug: 'red-black', name: 'Red-black Tree', description: 'Balanced', createdAt: now } },
    );
    target = await app.createUser({ name: 'Quirky Person', email: 'searchable-xyz@example.test' });
    uploaderId = (await app.createUser({ name: 'Uploader' })).id;
    app.clock.advance(0);
    nodes.push(
      { label: 'Source', key: 'src-upload', props: { title: 'Upload notes', kind: 'text', fingerprint: 'fp-1', content: SECRET_SOURCE_TEXT, createdAt: recent() } },
      { label: 'Source', key: 'src-prompt', props: { title: 'Prompt brief', kind: 'prompt', brief: SECRET_BRIEF, outline: SECRET_OUTLINE, createdAt: recent(30_000) } },
      {
        label: 'Puzzle',
        key: 'pz-1',
        props: { name: 'Fixture puzzle', origin: 'upload', status: 'published', visibility: 'private', distractors: [DISTRACTOR], createdAt: now },
      },
    );
    const edges: FixtureEdge[] = [
      { type: 'OWNS', from: { label: 'Learner', key: uploaderId }, to: { label: 'Source', key: 'src-upload' } },
      { type: 'OWNS', from: { label: 'Learner', key: uploaderId }, to: { label: 'Source', key: 'src-prompt' } },
    ];
    await app.testGraph.load({ nodes, edges });
  });

  describe('concept list', () => {
    it('returns declared columns only, sorted by name, with paging fields and ISO dates', async () => {
      const res = await get('/admin/concept');
      expect(res.status).toBe(200);
      const list = AdminListResponse.parse(res.body);
      expect(list).toMatchObject({ total: 32, page: 1, pageSize: 25 });
      expect(list.items).toHaveLength(25);
      expect(list.items[0]).toMatchObject({ id: 'concept-bin', title: 'Binary tree' });
      expect(Object.keys(list.items[0]!.values).sort()).toEqual(['createdAt', 'name', 'slug']);
      expect(list.items[0]!.values.createdAt).toMatch(ISO);
      const names = list.items.map((i) => i.title);
      expect(names).toEqual([...names].sort());
    });

    it('pages: page=2&pageSize=10 holds the right slice', async () => {
      const all = (AdminListResponse.parse((await get('/admin/concept?pageSize=100')).body)).items.map((i) => i.id);
      expect(all).toHaveLength(32);
      const page2 = AdminListResponse.parse((await get('/admin/concept?page=2&pageSize=10')).body);
      expect(page2.items.map((i) => i.id)).toEqual(all.slice(10, 20));
      expect(page2).toMatchObject({ page: 2, pageSize: 10, total: 32 });
      const past = AdminListResponse.parse((await get('/admin/concept?page=9&pageSize=10')).body);
      expect(past).toMatchObject({ items: [], total: 32 });
    });

    it('clamps pageSize to 100 and reports the value used', async () => {
      const res = await get('/admin/concept?pageSize=5000');
      expect(res.status).toBe(200);
      expect(res.body.pageSize).toBe(100);
    });

    it.each([
      ['page=0', 'page'],
      ['page=abc', 'page'],
      ['pageSize=abc', 'pageSize'],
      ['pageSize=0', 'pageSize'],
      ['page=1000&pageSize=100', 'page'],
      [`search=${'x'.repeat(101)}`, 'search'],
    ])('%s is 422 VALIDATION_FAILED with the parameter name in the issue path', async (query, path) => {
      const res = await get(`/admin/concept?${query}`);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details.issues.map((i: { path: string }) => i.path)).toContain(path);
    });

    it('search finds a case-insensitive substring in name, slug, and description', async () => {
      const list = AdminListResponse.parse((await get('/admin/concept?search=tree')).body);
      expect(list.items.map((i) => i.id).sort()).toEqual(['concept-05', 'concept-bin', 'concept-red']);
      expect(list.total).toBe(3);
      expect(AdminListResponse.parse((await get('/admin/concept?search=%20%20BINARY%20')).body).total).toBe(1);
      expect(AdminListResponse.parse((await get('/admin/concept?search=%20%20')).body).total).toBe(32);
      expect(AdminListResponse.parse((await get('/admin/concept?search=nothing-matches-this')).body)).toMatchObject({ items: [], total: 0 });
    });

    it('a hostile search term matches nothing and breaks nothing', async () => {
      for (const term of ["') RETURN 1 //", 'x}) DETACH DELETE n //']) {
        const res = await get(`/admin/concept?search=${encodeURIComponent(term)}`);
        expect(res.status).toBe(200);
        expect(res.body.total).toBe(0);
      }
      expect(AdminListResponse.parse((await get('/admin/concept')).body).total).toBe(32);
    });
  });

  describe('user list and detail', () => {
    it('lists e-mail, name, role, status, created, and no counts or cognito data', async () => {
      const res = await get('/admin/user?pageSize=100');
      expect(res.status).toBe(200);
      const list = AdminListResponse.parse(res.body);
      const item = list.items.find((i) => i.id === target.id)!;
      expect(Object.keys(item.values).sort()).toEqual(['createdAt', 'displayName', 'email', 'role', 'status']);
      expect(item.title).toBe(target.email);
      expect(item.values.createdAt).toMatch(ISO);
      expect(JSON.stringify(res.body).toLowerCase()).not.toContain('cognito');
      const emails = list.items.map((i) => i.title);
      expect(emails).toEqual([...emails].sort());
    });

    it('searches by part of the e-mail address and by part of the display name', async () => {
      const byEmail = AdminListResponse.parse((await get('/admin/user?search=SEARCHABLE-xyz')).body);
      expect(byEmail.items.map((i) => i.id)).toEqual([target.id]);
      const byName = AdminListResponse.parse((await get('/admin/user?search=quirky')).body);
      expect(byName.items.map((i) => i.id)).toEqual([target.id]);
      expect(AdminListResponse.parse((await get('/admin/user?search=%25')).body).total).toBe(0);
      expect(AdminListResponse.parse((await get('/admin/user?search=_')).body).total).toBe(0);
    });

    it('detail adds last seen, bonus runs, the lift date, and counts of 0 for a new user', async () => {
      const res = await get(`/admin/user/${target.id}`);
      expect(res.status).toBe(200);
      const detail = AdminDetailResponse.parse(res.body);
      expect(detail.record.values).toMatchObject({
        email: target.email,
        displayName: 'Quirky Person',
        role: 'learner',
        status: 'active',
        bonusSourceRuns: 0,
        bonusPromptRuns: 0,
        limitsLiftedUntil: null,
        uploadsThisMonth: 0,
        promptsThisMonth: 0,
        creationsLastHour: 0,
        tokensThisMonth: 0,
      });
      expect(detail.record.values.lastSeenAt).toMatch(ISO);
      expect(detail.actions).toEqual([{ field: 'status', value: 'blocked', label: 'Block' }]);
      expect(detail.links).toEqual([]);
    });

    it('counts one upload, one prompt creation, and both in the last hour', async () => {
      const detail = AdminDetailResponse.parse((await get(`/admin/user/${uploaderId}`)).body);
      expect(detail.record.values).toMatchObject({ uploadsThisMonth: 1, promptsThisMonth: 1, creationsLastHour: 2 });
    });
  });

  describe('detail of the other models', () => {
    it('concept returns every declared field', async () => {
      const detail = AdminDetailResponse.parse((await get('/admin/concept/concept-05')).body);
      expect(detail.record).toMatchObject({ id: 'concept-05', title: 'Concept 05' });
      expect(Object.keys(detail.record.values).sort()).toEqual(['createdAt', 'description', 'id', 'name', 'slug']);
      expect(detail.record.values.description).toBe('Contains a TREE inside');
      expect(detail.actions).toEqual([]);
    });

    it('source returns exactly id, title, kind, createdAt, for an upload and for a prompt source', async () => {
      for (const id of ['src-upload', 'src-prompt']) {
        const res = await get(`/admin/source/${id}`);
        expect(res.status).toBe(200);
        expect(Object.keys(res.body.record.values).sort()).toEqual(['createdAt', 'id', 'kind', 'title']);
        const text = JSON.stringify(res.body);
        for (const secret of [SECRET_SOURCE_TEXT, SECRET_BRIEF, SECRET_OUTLINE, 'fp-1']) expect(text).not.toContain(secret);
      }
      expect((await get('/admin/source/src-prompt')).body.record.values.kind).toBe('prompt');
    });

    it('puzzle returns exactly id, name, origin, status, visibility, createdAt', async () => {
      const res = await get('/admin/puzzle/pz-1');
      expect(res.status).toBe(200);
      expect(Object.keys(res.body.record.values).sort()).toEqual(['createdAt', 'id', 'name', 'origin', 'status', 'visibility']);
      expect(JSON.stringify(res.body)).not.toContain(DISTRACTOR);
    });

    it('access-code lists its ten declared fields and nothing derived from the hash', async () => {
      const { code, meta } = await app.app.get(CodesService).create({
        label: 'Spring promo',
        sourceRuns: 2,
        promptRuns: 1,
        liftDays: 3,
        maxRedemptions: 10,
      });
      const res = await get('/admin/access-code');
      expect(res.status).toBe(200);
      const item = AdminListResponse.parse(res.body).items.find((i) => i.id === meta.id)!;
      expect(Object.keys(item.values).sort()).toEqual(
        ['createdAt', 'disabled', 'expiresAt', 'liftDays', 'maxRedemptions', 'promptRuns', 'redeemedCount', 'sourceRuns', 'label'].sort(),
      );
      expect(item.values).toMatchObject({ label: 'Spring promo', sourceRuns: 2, promptRuns: 1, liftDays: 3, maxRedemptions: 10, redeemedCount: 0, disabled: false, expiresAt: null });
      const detail = await get(`/admin/access-code/${meta.id}`);
      expect(Object.keys(detail.body.record.values)).toHaveLength(10);
      const text = JSON.stringify([res.body, detail.body]).toLowerCase();
      expect(text).not.toContain('hash');
      expect(text).not.toContain(code.toLowerCase());
    });

    it('admin-setting lists the setting rows and shows a boolean as a JSON value', async () => {
      const list = AdminListResponse.parse((await get('/admin/admin-setting?pageSize=100')).body);
      const keys = list.items.map((i) => i.id);
      expect(keys).toEqual([...keys].sort());
      expect(keys).toContain('creationEnabled');
      expect(keys).not.toContain('embeddingDim');
      const detail = AdminDetailResponse.parse((await get('/admin/admin-setting/creationEnabled')).body);
      expect(detail.record.values).toMatchObject({ key: 'creationEnabled', value: true });
      expect(detail.record.values.updatedAt).toMatch(ISO);
    });
  });

  describe('not found', () => {
    it.each([
      '/admin/code-redemptions',
      '/admin/user-identities',
      '/admin/question',
      '/admin/chunk',
      '/admin/question/x',
      '/admin/chunk/x',
      '/admin/User/x',
      '/admin/Concept',
      '/admin/nothing',
      '/admin/concept/ghost',
      `/admin/concept/${'i'.repeat(129)}`,
      '/admin/models/extra',
    ])('GET %s is 404 NOT_FOUND', async (path) => {
      const res = await get(path);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });
});

// ─── US3: edit ───────────────────────────────────────────────────────────────

describe('PATCH', () => {
  const issuesOf = (res: { body: { error: { details: { issues: { path: string; code: string; message: string }[] } } } }) =>
    res.body.error.details.issues;

  beforeAll(async () => {
    await app.testGraph.load({
      nodes: [
        { label: 'Concept', key: 'edit-1', props: { slug: 'edit-one', name: 'Edit one', description: 'Original', createdAt: now } },
        {
          label: 'Source', key: 'ro-source', props: { title: 'Read only', kind: 'text', content: 'x', fingerprint: 'fp-ro', createdAt: now },
        },
        { label: 'Puzzle', key: 'ro-puzzle', props: { name: 'Read only puzzle', origin: 'seed', status: 'published', visibility: 'public', createdAt: now } },
        { label: 'Task', key: 'ro-task', props: { kind: 'ingest', status: 'done', createdAt: now } },
        { label: 'Decision', key: 'ro-decision', props: { kind: 'recommendation', summary: 'Read only', flags: [], createdAt: now } },
      ],
      edges: [],
    });
  });

  describe('concept', () => {
    it('updates the name and a following GET shows it', async () => {
      const res = await patch('/admin/concept/edit-1', { values: { name: 'Edit one, renamed' } });
      expect(res.status).toBe(200);
      expect(res.body.record.values).toMatchObject({ name: 'Edit one, renamed', slug: 'edit-one', description: 'Original' });
      expect((await get('/admin/concept/edit-1')).body.record.values.name).toBe('Edit one, renamed');
    });

    it('clears the description with null', async () => {
      const res = await patch('/admin/concept/edit-1', { values: { description: null } });
      expect(res.status).toBe(200);
      expect(res.body.record.values.description).toBeNull();
    });

    it('slug is read_only: 422 with the issue, and the record is unchanged', async () => {
      const res = await patch('/admin/concept/edit-1', { values: { slug: 'hacked' } });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(issuesOf(res)).toEqual([{ path: 'values.slug', message: expect.any(String), code: 'read_only' }]);
      expect((await get('/admin/concept/edit-1')).body.record.values.slug).toBe('edit-one');
    });

    it('an undeclared key is unknown_field; a mixed body writes nothing', async () => {
      const unknown = await patch('/admin/concept/edit-1', { values: { colour: 'red' } });
      expect(issuesOf(unknown)).toMatchObject([{ path: 'values.colour', code: 'unknown_field' }]);
      const mixed = await patch('/admin/concept/edit-1', { values: { name: 'Should not be written', id: 'x', colour: 1, name2: 2 } });
      expect(mixed.status).toBe(422);
      expect(issuesOf(mixed).map((i) => i.code).sort()).toEqual(['read_only', 'unknown_field', 'unknown_field']);
      expect((await get('/admin/concept/edit-1')).body.record.values.name).toBe('Edit one, renamed');
    });

    it('rejects an empty name (required), a name that is too long, and a wrong type', async () => {
      expect(issuesOf(await patch('/admin/concept/edit-1', { values: { name: '' } }))[0]!.code).toBe('required');
      expect(issuesOf(await patch('/admin/concept/edit-1', { values: { name: null } }))[0]!.code).toBe('required');
      expect(issuesOf(await patch('/admin/concept/edit-1', { values: { name: 'n'.repeat(201) } }))[0]!.code).toBe('too_long');
      expect(issuesOf(await patch('/admin/concept/edit-1', { values: { name: 5 } }))[0]!.code).toBe('invalid_type');
    });

    it.each([{}, { values: {} }, { values: [] }, { values: 'x' }, { values: null }])('body %j is 422 at path values', async (body) => {
      const res = await patch('/admin/concept/edit-1', body);
      expect(res.status).toBe(422);
      expect(issuesOf(res)[0]!.path).toBe('values');
    });

    it('a hostile value is stored as data', async () => {
      const value = "'}) DETACH DELETE n //";
      const res = await patch('/admin/concept/edit-1', { values: { name: value } });
      expect(res.status).toBe(200);
      expect(res.body.record.values.name).toBe(value);
      await patch('/admin/concept/edit-1', { values: { name: 'Edit one, renamed' } });
    });

    it('unknown id and unknown model are 404; question is 404', async () => {
      expect((await patch('/admin/concept/ghost', { values: { name: 'X' } })).status).toBe(404);
      const question = await patch('/admin/question/x', { values: { sentence: 'x' } });
      expect(question.status).toBe(404);
      expect(question.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('read-only models', () => {
    it.each([
      ['source', 'ro-source', { title: 'Changed' }],
      ['puzzle', 'ro-puzzle', { name: 'Changed' }],
      ['task', 'ro-task', { status: 'failed' }],
      ['decision', 'ro-decision', { summary: 'Changed' }],
    ])('%s answers 405 ADMIN_MODEL_READ_ONLY and changes nothing', async (model, id, values) => {
      const before = (await get(`/admin/${model}/${id}`)).body.record;
      const res = await patch(`/admin/${model}/${id}`, { values });
      expect(res.status).toBe(405);
      expect(res.body.error.code).toBe('ADMIN_MODEL_READ_ONLY');
      expect((await get(`/admin/${model}/${id}`)).body.record).toEqual(before);
    });
  });

  describe('user', () => {
    let target: TestUser;
    beforeAll(async () => {
      target = await app.createUser({ name: 'Target Tina' });
    });

    it('changes the role, and refuses an invalid role', async () => {
      const ok = await patch(`/admin/user/${target.id}`, { values: { role: 'reviewer' } });
      expect(ok.status).toBe(200);
      expect(ok.body.record.values.role).toBe('reviewer');
      const bad = await patch(`/admin/user/${target.id}`, { values: { role: 'boss' } });
      expect(bad.status).toBe(422);
      expect(issuesOf(bad)[0]).toMatchObject({ path: 'values.role', code: 'invalid_choice' });
      await patch(`/admin/user/${target.id}`, { values: { role: 'learner' } });
    });

    it('blocks and unblocks: the next request answers ACCOUNT_BLOCKED, then works again', async () => {
      expect((await get('/auth/me', target)).status).toBe(200);
      const blocked = await patch(`/admin/user/${target.id}`, { values: { status: 'blocked' } });
      expect(blocked.status).toBe(200);
      expect(blocked.body.record.values.status).toBe('blocked');

      const after = await get('/auth/me', target);
      expect(after.status).toBe(403);
      expect(after.body.error.code).toBe('ACCOUNT_BLOCKED');

      const detail = AdminDetailResponse.parse((await get(`/admin/user/${target.id}`)).body);
      expect(detail.actions).toEqual([{ field: 'status', value: 'active', label: 'Unblock' }]);

      expect((await patch(`/admin/user/${target.id}`, { values: { status: 'active' } })).status).toBe(200);
      expect((await get('/auth/me', target)).status).toBe(200);
    });

    it('an admin cannot block themselves or remove their own admin role', async () => {
      const block = await patch(`/admin/user/${admin.id}`, { values: { status: 'blocked' } });
      expect(block.status).toBe(422);
      expect(issuesOf(block)[0]).toMatchObject({ path: 'values.status', code: 'rejected', message: 'You cannot block your own account' });
      const demote = await patch(`/admin/user/${admin.id}`, { values: { role: 'learner' } });
      expect(demote.status).toBe(422);
      expect(issuesOf(demote)[0]).toMatchObject({ path: 'values.role', code: 'rejected', message: 'You cannot remove your own admin role' });
      expect((await get(`/admin/user/${admin.id}`)).body.record.values).toMatchObject({ role: 'admin', status: 'active' });
    });

    it('a refused status change writes none of the other fields', async () => {
      const res = await patch(`/admin/user/${admin.id}`, { values: { status: 'blocked', bonusSourceRuns: 9 } });
      expect(res.status).toBe(422);
      expect((await get(`/admin/user/${admin.id}`)).body.record.values.bonusSourceRuns).toBe(0);
    });

    it('sets bonus runs, and bounds them 0 to 1000 as integers', async () => {
      const res = await patch(`/admin/user/${target.id}`, { values: { bonusSourceRuns: 5, bonusPromptRuns: 2 } });
      expect(res.status).toBe(200);
      expect(res.body.record.values).toMatchObject({ bonusSourceRuns: 5, bonusPromptRuns: 2 });
      expect((await get(`/admin/user/${target.id}`)).body.record.values).toMatchObject({ bonusSourceRuns: 5, bonusPromptRuns: 2 });
      expect(issuesOf(await patch(`/admin/user/${target.id}`, { values: { bonusSourceRuns: -1 } }))[0]).toMatchObject({ path: 'values.bonusSourceRuns', code: 'out_of_range' });
      expect(issuesOf(await patch(`/admin/user/${target.id}`, { values: { bonusPromptRuns: 1001 } }))[0]!.code).toBe('out_of_range');
      expect(issuesOf(await patch(`/admin/user/${target.id}`, { values: { bonusSourceRuns: '5' } }))[0]!.code).toBe('invalid_type');
      expect(issuesOf(await patch(`/admin/user/${target.id}`, { values: { bonusSourceRuns: 1.5 } }))[0]!.code).toBe('invalid_type');
      const only = await patch(`/admin/user/${target.id}`, { values: { bonusPromptRuns: 0 } });
      expect(only.body.record.values).toMatchObject({ bonusSourceRuns: 5, bonusPromptRuns: 0 });
    });

    it.each(['uploadsThisMonth', 'tokensThisMonth', 'limitsLiftedUntil', 'email', 'displayName', 'lastSeenAt', 'createdAt', 'id'])(
      '%s is read_only',
      async (key) => {
        const res = await patch(`/admin/user/${target.id}`, { values: { [key]: 'x' } });
        expect(res.status).toBe(422);
        expect(issuesOf(res)[0]).toMatchObject({ path: `values.${key}`, code: 'read_only' });
      },
    );

    it('unknown user id is 404', async () => {
      expect((await patch('/admin/user/00000000-0000-4000-8000-000000000000', { values: { role: 'learner' } })).status).toBe(404);
      expect((await patch('/admin/user/not-a-uuid', { values: { role: 'learner' } })).status).toBe(404);
    });
  });

  describe('access-code', () => {
    it('disables a code (one-way), and refuses anything else', async () => {
      const { meta } = await app.app.get(CodesService).create({ label: 'Disable me', sourceRuns: 1, promptRuns: 0, liftDays: 0, maxRedemptions: 3 });
      const path = `/admin/access-code/${meta.id}`;
      const disabled = await patch(path, { values: { disabled: true } });
      expect(disabled.status).toBe(200);
      expect(disabled.body.record.values.disabled).toBe(true);
      expect((await get(path)).body.record.values.disabled).toBe(true);

      const again = await patch(path, { values: { disabled: false } });
      expect(again.status).toBe(422);
      expect(issuesOf(again)[0]).toMatchObject({ path: 'values.disabled', code: 'rejected' });
      expect((await get(path)).body.record.values.disabled).toBe(true);

      for (const key of ['label', 'maxRedemptions', 'redeemedCount', 'sourceRuns', 'expiresAt']) {
        const res = await patch(path, { values: { [key]: 1 } });
        expect(issuesOf(res)[0], key).toMatchObject({ path: `values.${key}`, code: 'read_only' });
      }
      expect(issuesOf(await patch(path, { values: { disabled: 'yes' } }))[0]!.code).toBe('invalid_type');
      expect((await patch('/admin/access-code/00000000-0000-4000-8000-000000000000', { values: { disabled: true } })).status).toBe(404);
    });

    it('false on a code that is not disabled changes nothing and is accepted', async () => {
      const { meta } = await app.app.get(CodesService).create({ label: 'Leave me', sourceRuns: 1, promptRuns: 0, liftDays: 0, maxRedemptions: 3 });
      const res = await patch(`/admin/access-code/${meta.id}`, { values: { disabled: false } });
      expect(res.status).toBe(200);
      expect(res.body.record.values.disabled).toBe(false);
    });
  });

  describe('admin-setting', () => {
    const settings = () => app.app.get(SettingsService);

    it('stores minQuestions, moves updatedAt, and applies it at once', async () => {
      const before = (await get('/admin/admin-setting/minQuestions')).body.record.values;
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(await settings().get('minQuestions')).toBe(3);
      const res = await patch('/admin/admin-setting/minQuestions', { values: { value: 4 } });
      expect(res.status).toBe(200);
      expect(res.body.record.values.value).toBe(4);
      expect(Date.parse(res.body.record.values.updatedAt)).toBeGreaterThan(Date.parse(before.updatedAt));
      expect(await settings().get('minQuestions')).toBe(4);
    });

    it('refuses a value the platform schema rejects', async () => {
      const bad = await patch('/admin/admin-setting/minQuestions', { values: { value: 'many' } });
      expect(bad.status).toBe(422);
      expect(issuesOf(bad)[0]).toMatchObject({ path: 'values.value', code: 'rejected' });
      expect(issuesOf(await patch('/admin/admin-setting/masteryAlpha', { values: { value: 1.5 } }))[0]!.code).toBe('rejected');
      expect(await settings().get('minQuestions')).toBe(4);
    });

    it('turns creation off and back on, effective straight away', async () => {
      expect(await settings().get('creationEnabled')).toBe(true);
      expect((await patch('/admin/admin-setting/creationEnabled', { values: { value: false } })).status).toBe(200);
      expect(await settings().get('creationEnabled')).toBe(false);
      expect(issuesOf(await patch('/admin/admin-setting/creationEnabled', { values: { value: 'no' } }))[0]!.code).toBe('rejected');
      expect((await patch('/admin/admin-setting/creationEnabled', { values: { value: true } })).status).toBe(200);
      expect(await settings().get('creationEnabled')).toBe(true);
    });

    it.each(['monthlySourceAllowance', 'monthlyPromptAllowance', 'hourlyCreationLimit'])('%s takes an in-range integer and refuses others', async (key) => {
      expect((await patch(`/admin/admin-setting/${key}`, { values: { value: 7 } })).status).toBe(200);
      expect(await settings().get(key as 'hourlyCreationLimit')).toBe(7);
      expect(issuesOf(await patch(`/admin/admin-setting/${key}`, { values: { value: 1001 } }))[0]!.code).toBe('rejected');
      expect(issuesOf(await patch(`/admin/admin-setting/${key}`, { values: { value: -1 } }))[0]!.code).toBe('rejected');
      expect(issuesOf(await patch(`/admin/admin-setting/${key}`, { values: { value: 1.5 } }))[0]!.code).toBe('rejected');
      expect(await settings().get(key as 'hourlyCreationLimit')).toBe(7);
    });

    it('embeddingDim cannot be edited, and the other fields of a setting are read-only', async () => {
      await app.db.insert(adminSettings).values({ key: 'embeddingDim', value: 64 }).onConflictDoNothing();
      const res = await patch('/admin/admin-setting/embeddingDim', { values: { value: 128 } });
      expect(res.status).toBe(422);
      expect(issuesOf(res)[0]).toMatchObject({ path: 'values.value', code: 'rejected' });
      expect((await get('/admin/admin-setting/embeddingDim')).body.record.values.value).toBe(64);
      expect(issuesOf(await patch('/admin/admin-setting/minQuestions', { values: { key: 'other' } }))[0]!.code).toBe('read_only');
      expect(issuesOf(await patch('/admin/admin-setting/minQuestions', { values: { updatedAt: 'now' } }))[0]!.code).toBe('read_only');
    });

    it('a key that is not a setting has no row: 404', async () => {
      expect((await patch('/admin/admin-setting/notASetting', { values: { value: 1 } })).status).toBe(404);
    });
  });
});

describe('PATCH when the only active admin is the target', () => {
  let solo: TestApp;
  afterAll(async () => {
    await solo?.close();
  });

  it('refuses to block or demote the last active admin, even for another actor', async () => {
    solo = await createTestApp();
    const last = await solo.createUser({ role: 'admin', name: 'Last Admin' });
    const actor = await solo.createUser({ role: 'admin', name: 'Acting Admin' });
    // The actor's account is cached by the guard; then the database says the actor is no longer an admin.
    const warm = await solo.http.get('/admin/models').set(actor.auth);
    expect(warm.status).toBe(200);
    await solo.db.update(users).set({ role: 'learner' }).where(eq(users.id, actor.id));

    const block = await solo.http.patch(`/admin/user/${last.id}`).set(actor.auth).send({ values: { status: 'blocked' } });
    expect(block.status).toBe(422);
    expect(block.body.error.details.issues[0]).toMatchObject({
      path: 'values.status',
      code: 'rejected',
      message: 'At least one active admin must remain',
    });
    const demote = await solo.http.patch(`/admin/user/${last.id}`).set(actor.auth).send({ values: { role: 'learner' } });
    expect(demote.status).toBe(422);
    expect(demote.body.error.details.issues[0]).toMatchObject({
      path: 'values.role',
      message: 'At least one active admin must remain',
    });
    const [row] = await solo.db.select().from(users).where(eq(users.id, last.id));
    expect(row).toMatchObject({ role: 'admin', status: 'active' });
  });
});

// ─── US4: links and usage ────────────────────────────────────────────────────

describe('links, usage, and what must stay hidden', () => {
  let owner: TestUser;
  let shared: TestUser;

  beforeAll(async () => {
    owner = await app.createUser({ name: 'Olive Owner' });
    shared = await app.createUser({ name: SHARED_NAME });
    const month = recent(3_600_000);
    await app.testGraph.load({
      nodes: [
        { label: 'Source', key: 'l-src', props: { title: 'Linked source', kind: 'text', fingerprint: 'fp-l', content: SECRET_SOURCE_TEXT, createdAt: month } },
        {
          label: 'Task',
          key: 'l-task',
          props: { kind: 'ingest', status: 'awaiting_review', result: 'ok', lastCompletedStep: 'validate', error: 'Something odd', modelCalls: 9, inputTokens: 18_400, outputTokens: 3_100, embeddingTokens: 5_200, createdAt: month, updatedAt: month + 1000 },
        },
        { label: 'Concept', key: 'l-c1', props: { slug: 'l-one', name: 'Linked one', createdAt: month } },
        { label: 'Concept', key: 'l-c2', props: { slug: 'l-two', name: 'Linked two', createdAt: month } },
        { label: 'Concept', key: 'l-pre', props: { slug: 'l-pre', name: 'Prerequisite concept', createdAt: month } },
        { label: 'Question', key: 'l-q1', props: { sentence: SECRET_QUESTION, status: 'approved' } },
        { label: 'Question', key: 'l-q2', props: { sentence: SECRET_QUESTION, status: 'draft' } },
        { label: 'Step', key: 'l-step', props: { name: 'validate', log: 'STEP LOG TEXT' } },
        { label: 'Puzzle', key: 'l-pz', props: { name: 'Linked puzzle', origin: 'upload', status: 'published', visibility: 'private', distractors: [DISTRACTOR], createdAt: month } },
        {
          label: 'Decision',
          key: 'l-dec',
          props: { kind: 'recommendation', summary: 'Practise linked concepts', flags: ['cold_start', 'coverage_gap'], modelCalls: 2, inputTokens: 1_000, outputTokens: 200, embeddingTokens: 30, createdAt: month },
        },
      ],
      edges: [
        { type: 'OWNS', from: { label: 'Learner', key: owner.id }, to: { label: 'Source', key: 'l-src' } },
        { type: 'OWNS', from: { label: 'Learner', key: owner.id }, to: { label: 'Puzzle', key: 'l-pz' } },
        { type: 'YIELDED', from: { label: 'Source', key: 'l-src' }, to: { label: 'Puzzle', key: 'l-pz' } },
        { type: 'REQUESTED', from: { label: 'Learner', key: owner.id }, to: { label: 'Task', key: 'l-task' } },
        { type: 'CONCERNS', from: { label: 'Task', key: 'l-task' }, to: { label: 'Source', key: 'l-src' } },
        { type: 'PRODUCED', from: { label: 'Task', key: 'l-task' }, to: { label: 'Concept', key: 'l-c1' } },
        { type: 'PRODUCED', from: { label: 'Task', key: 'l-task' }, to: { label: 'Concept', key: 'l-c2' } },
        { type: 'PRODUCED', from: { label: 'Task', key: 'l-task' }, to: { label: 'Question', key: 'l-q1' } },
        { type: 'PRODUCED', from: { label: 'Task', key: 'l-task' }, to: { label: 'Question', key: 'l-q2' } },
        { type: 'PRODUCED', from: { label: 'Task', key: 'l-task' }, to: { label: 'Puzzle', key: 'l-pz' } },
        { type: 'HAS_STEP', from: { label: 'Task', key: 'l-task' }, to: { label: 'Step', key: 'l-step' }, props: { order: 1 } },
        { type: 'PREREQUISITE_OF', from: { label: 'Concept', key: 'l-pre' }, to: { label: 'Concept', key: 'l-c1' }, props: { confidence: 1 } },
        { type: 'SHARED_WITH', from: { label: 'Puzzle', key: 'l-pz' }, to: { label: 'Learner', key: shared.id }, props: { withSource: true, at: month } },
        { type: 'FOR', from: { label: 'Decision', key: 'l-dec' }, to: { label: 'Learner', key: owner.id } },
        { type: 'RECOMMENDED', from: { label: 'Decision', key: 'l-dec' }, to: { label: 'Puzzle', key: 'l-pz' } },
        { type: 'BECAUSE', from: { label: 'Decision', key: 'l-dec' }, to: { label: 'Concept', key: 'l-c1' }, props: { weight: 1, role: 'target' } },
        { type: 'BECAUSE', from: { label: 'Decision', key: 'l-dec' }, to: { label: 'Question', key: 'l-q1' }, props: { weight: 1, role: 'answer' } },
      ],
    });
  });

  it('task shows its fields, linked concepts, and a count of questions with no items', async () => {
    const res = await get('/admin/task/l-task');
    expect(res.status).toBe(200);
    const detail = AdminDetailResponse.parse(res.body);
    expect(detail.record.values).toMatchObject({
      status: 'awaiting_review',
      result: 'ok',
      lastCompletedStep: 'validate',
      error: 'Something odd',
    });
    expect(detail.record.values.createdAt).toMatch(ISO);
    expect(detail.record.values.updatedAt).toMatch(ISO);
    const byName = Object.fromEntries(detail.links.map((l) => [l.name, l]));
    expect(detail.links.map((l) => l.name)).toEqual(['producedConcepts', 'producedQuestions', 'producedPuzzles', 'concerns', 'requestedBy']);

    const concepts = byName.producedConcepts as { kind: 'records'; model: string; items: { id: string; title: string }[]; truncated: boolean };
    expect(concepts).toMatchObject({ kind: 'records', model: 'concept', truncated: false });
    expect(concepts.items).toEqual([
      { id: 'l-c1', title: 'Linked one' },
      { id: 'l-c2', title: 'Linked two' },
    ]);
    for (const item of concepts.items) expect((await get(`/admin/concept/${item.id}`)).status).toBe(200);

    expect(byName.producedQuestions).toEqual({ kind: 'count', name: 'producedQuestions', label: 'Produced questions', count: 2 });
    expect(byName.producedPuzzles).toMatchObject({ items: [{ id: 'l-pz', title: 'Linked puzzle' }], model: 'puzzle' });
    expect(byName.concerns).toMatchObject({ items: [{ id: 'l-src', title: 'Linked source' }], model: 'source' });
    expect(byName.requestedBy).toMatchObject({ items: [{ id: owner.id, title: 'Olive Owner' }], model: 'user' });
    expect(detail.actions).toEqual([]);
  });

  it('concept shows its prerequisites as a link', async () => {
    const detail = AdminDetailResponse.parse((await get('/admin/concept/l-c1')).body);
    expect(detail.links).toEqual([
      { kind: 'records', name: 'prerequisites', label: 'Prerequisites', model: 'concept', items: [{ id: 'l-pre', title: 'Prerequisite concept' }], truncated: false },
    ]);
  });

  it('task and decision show the usage numbers stored on their nodes', async () => {
    const task = (await get('/admin/task/l-task')).body.record.values;
    expect(task).toMatchObject({ modelCalls: 9, inputTokens: 18_400, outputTokens: 3_100, embeddingTokens: 5_200 });
    const decision = (await get('/admin/decision/l-dec')).body.record.values;
    expect(decision).toMatchObject({ modelCalls: 2, inputTokens: 1_000, outputTokens: 200, embeddingTokens: 30 });
  });

  it("user detail shows tokensThisMonth as the sum of that user's task and decision tokens", async () => {
    const detail = AdminDetailResponse.parse((await get(`/admin/user/${owner.id}`)).body);
    expect(detail.record.values.tokensThisMonth).toBe(18_400 + 3_100 + 5_200 + 1_000 + 200 + 30);
    expect(detail.record.values).toMatchObject({ uploadsThisMonth: 1, promptsThisMonth: 0 });
    expect(detail.links).toEqual([]);
  });

  it('decision shows its summary, flags as an array, links, and the "Why this?" route', async () => {
    const detail = AdminDetailResponse.parse((await get('/admin/decision/l-dec')).body);
    expect(detail.record.values).toMatchObject({ summary: 'Practise linked concepts', flags: ['cold_start', 'coverage_gap'] });
    expect(detail.record.title).toBe('Practise linked concepts');
    const byName = Object.fromEntries(detail.links.map((l) => [l.name, l]));
    expect(byName.why).toEqual({ kind: 'route', name: 'why', label: 'Why this?', href: '/decisions/l-dec' });
    expect(byName.learner).toMatchObject({ items: [{ id: owner.id, title: 'Olive Owner' }] });
    expect(byName.puzzle).toMatchObject({ items: [{ id: 'l-pz', title: 'Linked puzzle' }] });
    expect(byName.evidenceConcepts).toMatchObject({ items: [{ id: 'l-c1', title: 'Linked one' }] });
  });

  it('source and puzzle link to their owner and each other, never to questions, chunks, or shares', async () => {
    const source = AdminDetailResponse.parse((await get('/admin/source/l-src')).body);
    expect(source.links.map((l) => l.name)).toEqual(['owner', 'puzzle']);
    expect(source.links[0]).toMatchObject({ items: [{ id: owner.id, title: 'Olive Owner' }], model: 'user' });
    expect(source.links[1]).toMatchObject({ items: [{ id: 'l-pz' }], model: 'puzzle' });
    const puzzle = AdminDetailResponse.parse((await get('/admin/puzzle/l-pz')).body);
    expect(puzzle.links.map((l) => l.name)).toEqual(['owner', 'source']);
  });

  it('no response of any model reveals questions, source text, step logs, distractors, or shares', async () => {
    const models = (await get('/admin/models')).body as { name: string }[];
    const bodies: string[] = [];
    // The user model legitimately lists every display name; no other model may carry the shared user's name.
    const bodiesWithoutUsers: string[] = [];
    for (const { name } of models) {
      const list = await get(`/admin/${name}?pageSize=100`);
      expect(list.status, name).toBe(200);
      bodies.push(JSON.stringify(list.body));
      if (name !== 'user') bodiesWithoutUsers.push(JSON.stringify(list.body));
      for (const item of list.body.items as { id: string }[]) {
        const res = await get(`/admin/${name}/${encodeURIComponent(item.id)}`);
        expect(res.status, `${name}/${item.id}`).toBe(200);
        bodies.push(JSON.stringify(res.body));
        if (name !== 'user') bodiesWithoutUsers.push(JSON.stringify(res.body));
        for (const link of res.body.links as { kind: string; model?: string; href?: string; name: string }[]) {
          expect(link.model).not.toBe('question');
          expect(link.model).not.toBe('chunk');
          expect(link.name).not.toMatch(/step/i);
          if (link.kind === 'route') expect(link.href).not.toMatch(/^\/(sources|tasks|review)/);
        }
      }
    }
    expect(bodies.length).toBeGreaterThan(30);
    const all = bodies.join('\n');
    for (const hidden of [SECRET_SOURCE_TEXT, SECRET_BRIEF, SECRET_OUTLINE, SECRET_QUESTION, 'STEP LOG TEXT', DISTRACTOR, 'HAS_STEP', 'SHARED_WITH']) {
      expect(all, hidden).not.toContain(hidden);
    }
    expect(bodiesWithoutUsers.join('\n')).not.toContain(SHARED_NAME);
  });

  it('the page of a puzzle shared with a user never names that user', async () => {
    const res = await get('/admin/puzzle/l-pz');
    expect(JSON.stringify(res.body)).not.toContain(SHARED_NAME);
    expect(JSON.stringify(res.body)).not.toContain(shared.id);
  });
});

// ─── Generated queries ───────────────────────────────────────────────────────

describe('generated queries', () => {
  it('every registered admin_* statement is valid Cypher on the server (R-V1 to R-V6)', async () => {
    const graph = app.app.get(GraphKit);
    const queries = graph.listQueries().filter((q) => q.name.startsWith('admin_'));
    expect(queries.length).toBe(39);
    expect(queries.every((q) => q.owner === '006' && q.source === 'generated')).toBe(true);
    // No statement for a model that is not registered; Question appears only in the count of a task's produced questions.
    expect(queries.some((q) => /^admin_(question|chunk)_/.test(q.name))).toBe(false);
    const registered = queries.map((q) => q.name);
    expect(registered).toContain('admin_task_link_produced_questions');
    const text = (name: string) => (graph as unknown as { queries: Map<string, { text: string }> }).queries.get(name)?.text ?? '';
    for (const name of registered) {
      expect(text(name), name).not.toContain(':Chunk');
      if (text(name).includes(':Question')) {
        expect(name).toBe('admin_task_link_produced_questions');
        expect(text(name)).toMatch(/RETURN count\(m\) AS total\s*$/);
      }
    }
    for (const query of queries) {
      const params: Record<string, string | number | Record<string, never>> = {};
      for (const name of query.params) {
        params[name] = name === 'skip' ? 0 : name === 'limit' ? 5 : name === 'props' ? {} : 'x';
      }
      await expect(graph.query(query.name, params), query.name).resolves.toBeInstanceOf(Array);
    }
  });
});
