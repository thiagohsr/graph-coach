// SC-A04: hostile input never reaches query text (spec 006 T049). The service runs with recording ports.
import { describe, expect, it, vi } from 'vitest';
import { adminRegistry } from '@coach/admin-kit';
import { createRecordingGraphPort, type RecordingSqlPort } from '@coach/admin-kit/testing';
import { AppError } from '../../common/errors/app-error';
import { AdminProviders } from './admin.providers';
import { AdminService } from './admin.service';

const ADMIN = { id: '22222222-2222-4222-8222-222222222222', role: 'admin' as const };

const HOSTILE = [
  'n) DETACH DELETE n //',
  '"; DROP TABLE users; --',
  '`backtick`',
  "' OR '1'='1",
  '__proto__',
  '}) RETURN 1 //',
  'x'.repeat(10_000),
  '\\',
  '%_',
];

/** Rows rich enough for every model; the adapters pick the declared columns only. */
const ROW = {
  id: 'id-1',
  key: 'minQuestions',
  value: 3,
  email: 'e@example.test',
  display_name: 'D',
  role: 'learner',
  status: 'active',
  created_at: new Date(0),
  last_seen_at: null,
  bonus_source_runs: 0,
  bonus_prompt_runs: 0,
  limits_lifted_until: null,
  label: 'L',
  source_runs: 1,
  prompt_runs: 1,
  lift_days: 0,
  redeemed_count: 0,
  max_redemptions: 5,
  expires_at: null,
  disabled: false,
  updated_at: new Date(0),
  total: 1,
  slug: 's',
  name: 'N',
  description: 'd',
  createdAt: 0,
};

function setup() {
  const graph = createRecordingGraphPort({
    admin_concept_list: [ROW],
    admin_concept_list_search: [ROW],
    admin_concept_count: [{ total: 1 }],
    admin_concept_count_search: [{ total: 1 }],
    admin_concept_detail: [ROW],
    admin_concept_update: [ROW],
  });
  const sql: RecordingSqlPort = {
    calls: [],
    async execute(text, params) {
      this.calls.push({ text, params });
      return [ROW];
    },
  };
  const providers = new AdminProviders(
    { creationCountsFor: vi.fn(async () => new Map()) } as never,
    { usageTotalsFor: vi.fn(async () => new Map()) } as never,
    {
      assertCanChangeStatus: vi.fn(),
      assertCanChangeRole: vi.fn(),
      setStatus: vi.fn(),
      setRole: vi.fn(),
      setBonusRuns: vi.fn(),
    } as never,
    { disable: vi.fn() } as never,
  );
  const admin = new AdminService({ graph, sql }, providers, { invalidate: vi.fn() } as never);
  admin.onModuleInit();
  return { admin, graph, sql };
}

/** Every `"identifier"` in a statement. */
function quotedIdentifiers(text: string): string[] {
  return [...text.matchAll(/"([^"]*)"/g)].map((m) => m[1]!);
}

async function swallow(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch (error) {
    // Refusals (404, 405, 422) are expected for hostile input; anything else is a bug.
    if (!(error instanceof AppError)) throw error;
  }
}

describe('SC-A04: hostile input stays in parameters', () => {
  const sqlModels = adminRegistry.list().filter((m) => m.source === 'sql');
  const allowedIdentifiers = new Set(
    sqlModels.flatMap((m) => [
      m.entity,
      ...m.fieldKeys.filter((k) => !m.fields[k]!.computed).map((k) => m.fields[k]!.column ?? k),
    ]),
  );
  const slugs = adminRegistry.list().map((m) => m.name);

  async function driveEverything() {
    const { admin, graph, sql } = setup();
    for (const hostile of HOSTILE) {
      // Model slug
      await swallow(admin.list(hostile, {}));
      await swallow(admin.get(hostile, 'x'));
      await swallow(admin.update(hostile, 'x', { values: { name: 'x' } }, ADMIN));
      for (const slug of slugs) {
        // Id
        await swallow(admin.get(slug, hostile));
        await swallow(
          admin.update(slug, hostile, { values: { name: 'x', value: 1, disabled: true } }, ADMIN),
        );
        // Search and paging
        await swallow(admin.list(slug, { search: hostile }));
        await swallow(admin.list(slug, { page: hostile, pageSize: hostile }));
        await swallow(
          admin.list(slug, { page: '1', pageSize: '9999', search: hostile.slice(0, 50) }),
        );
      }
      // PATCH keys and values
      for (const slug of ['concept', 'user', 'admin-setting', 'access-code']) {
        await swallow(admin.update(slug, 'x', { values: { [hostile]: 'v' } }, ADMIN));
        await swallow(
          admin.update(
            slug,
            'x',
            { values: { name: hostile, description: hostile, value: hostile, label: hostile } },
            ADMIN,
          ),
        );
        await swallow(
          admin.update(
            slug,
            'x',
            {
              values: JSON.parse(`{"__proto__": "${hostile.slice(0, 20).replace(/["\\]/g, '')}"}`),
            },
            ADMIN,
          ),
        );
      }
    }
    return { graph, sql };
  }

  it('every graph call uses a name registered at start-up, and no hostile text is in a name', async () => {
    const { graph } = await driveEverything();
    const registered = new Set(graph.registered.map((q) => q.name));
    expect(graph.calls.length).toBeGreaterThan(20);
    for (const call of graph.calls) expect(registered.has(call.name), call.name).toBe(true);
    for (const query of graph.registered) {
      for (const hostile of HOSTILE.slice(0, 6)) expect(query.cypher).not.toContain(hostile);
    }
  });

  it('every executed SQL text contains only identifiers from the declarations', async () => {
    const { sql } = await driveEverything();
    expect(sql.calls.length).toBeGreaterThan(20);
    for (const call of sql.calls) {
      for (const identifier of quotedIdentifiers(call.text)) {
        expect(allowedIdentifiers.has(identifier), `${identifier} in ${call.text}`).toBe(true);
      }
      for (const hostile of HOSTILE.slice(0, 6)) expect(call.text).not.toContain(hostile);
      expect(call.text).not.toMatch(/DROP|DELETE|--|;/);
    }
  });

  it('hostile strings appear only inside parameter values', async () => {
    const { graph, sql } = await driveEverything();
    const seen = [
      ...graph.calls.map((c) => JSON.stringify(c.params)),
      ...sql.calls.map((c) => JSON.stringify(c.params)),
    ].join('\n');
    expect(seen).toContain('DETACH DELETE');
  });

  it('a request for a slug that is not registered runs no query at all', async () => {
    const { admin, graph, sql } = setup();
    const before = graph.calls.length + sql.calls.length;
    for (const slug of [
      'question',
      'chunk',
      'Concept',
      'user ',
      'user-identities',
      'code-redemptions',
      'models',
      ...HOSTILE,
    ]) {
      await expect(admin.list(slug, {})).rejects.toMatchObject({ status: 404 });
    }
    expect(graph.calls.length + sql.calls.length).toBe(before);
  });
});
