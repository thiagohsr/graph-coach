import { count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedIds } from '@coach/graph-kit';
import { userIdentities, users } from '../src/apps/accounts/user.model';
import { accessCodes } from '../src/apps/allowance/access-code.model';
import { generateCode, hashCode, normalizeCode } from '../src/apps/allowance/code-format';
import { adminSettings } from '../src/common/settings/admin-setting.model';
import { SETTING_KEYS } from '../src/common/settings/settings.schema';
import { createCliHarness, type CliHarness } from './support/cli-harness';

let cli: CliHarness;

beforeAll(async () => {
  cli = await createCliHarness();
});

afterAll(async () => {
  await cli.close();
});

const DEMO = ['learner', 'learner2', 'reviewer', 'admin'] as const;

async function settingsRows(): Promise<number> {
  const [row] = await cli.db.select({ n: count() }).from(adminSettings);
  return row!.n;
}

async function graphNodes(): Promise<number> {
  const rows = await cli.testGraph.cypher<{ c: number }>('MATCH (n) RETURN count(n) AS c');
  return rows[0]?.c ?? 0;
}

describe('migrate and setup-graph', () => {
  it('migrate twice succeeds and leaves one settings row per key; setup-graph adds embeddingDim', async () => {
    const first = await cli.run(['migrate']);
    expect(first.exitCode).toBe(0);
    const second = await cli.run(['migrate']);
    expect(second.exitCode).toBe(0);
    expect(await settingsRows()).toBe(SETTING_KEYS.length - 1); // 14

    const setup = await cli.run(['setup-graph']);
    expect(setup.exitCode).toBe(0);
    expect(setup.lines).toContain('created: 20');
    expect(await settingsRows()).toBe(SETTING_KEYS.length); // 15
    const [stored] = await cli.db
      .select()
      .from(adminSettings)
      .where(eq(adminSettings.key, 'embeddingDim'));
    expect(stored?.value).toBe(64);
  });

  it('a second setup-graph reports nothing created', async () => {
    const again = await cli.run(['setup-graph']);
    expect(again.exitCode).toBe(0);
    expect(again.lines).toContain('created: 0');
  });

  it('a changed EMBEDDING_DIM exits 1 naming --rebuild-vector, and succeeds with the flag', async () => {
    const refused = await cli.run(['setup-graph'], { env: { EMBEDDING_DIM: '32' } });
    expect(refused.exitCode).toBe(1);
    expect(refused.errors.join('\n')).toContain('--rebuild-vector');
    expect(refused.errors.join('\n')).toContain('32');

    const rebuilt = await cli.run(['setup-graph', '--rebuild-vector'], {
      env: { EMBEDDING_DIM: '32' },
    });
    expect(rebuilt.exitCode).toBe(0);
    expect(rebuilt.lines.join('\n')).toContain('(rebuilt)');
    const [stored] = await cli.db
      .select()
      .from(adminSettings)
      .where(eq(adminSettings.key, 'embeddingDim'));
    expect(stored?.value).toBe(32);

    // Back to the default dimension for the rest of the file.
    expect((await cli.run(['setup-graph', '--rebuild-vector'])).exitCode).toBe(0);
  });

  it('migrate then setup-graph twice in sequence, as a container entry command would, changes nothing the second time', async () => {
    for (let round = 0; round < 2; round += 1) {
      expect((await cli.run(['migrate'])).exitCode).toBe(0);
      const setup = await cli.run(['setup-graph']);
      expect(setup.exitCode).toBe(0);
      expect(setup.lines).toContain('created: 0');
    }
    expect(await settingsRows()).toBe(SETTING_KEYS.length);
  });
});

describe('seed', () => {
  it('needs no password, creates four demo users without identities, and prints counts', async () => {
    const result = await cli.run(['seed']);
    expect(result.exitCode).toBe(0);
    expect(result.lines.join('\n')).toContain('Concept: 25');
    expect(result.lines.join('\n')).toContain('users: 4 created');

    const rows = await cli.db.select().from(users);
    const demo = rows.filter(
      (row) =>
        row.id === seedIds.user('learner') || DEMO.some((key) => row.id === seedIds.user(key)),
    );
    expect(demo).toHaveLength(4);
    expect(demo.map((row) => row.email).sort()).toEqual(
      DEMO.map((key) => seedIds.email(key)).sort(),
    );
    expect(await cli.db.select().from(userIdentities)).toHaveLength(0);
    // seed creates no code and no bonus run
    expect(await cli.db.select().from(accessCodes)).toHaveLength(0);
    for (const row of demo) {
      expect(row.bonusSourceRuns).toBe(0);
      expect(row.bonusPromptRuns).toBe(0);
    }
  });

  it('lets each demo user sign in through POST /auth/dev-login', async () => {
    const http = await cli.http();
    try {
      for (const key of DEMO) {
        const res = await http.post('/auth/dev-login').send({ email: seedIds.email(key) });
        expect(res.status).toBe(200);
        expect(typeof res.body.accessToken).toBe('string');
      }
    } finally {
      await http.close();
    }
  });

  it('a second seed creates nothing and keeps a re-roled, blocked, or linked demo row as it was', async () => {
    await cli.db
      .update(users)
      .set({ role: 'reviewer' })
      .where(eq(users.id, seedIds.user('learner')));
    await cli.db
      .update(users)
      .set({ status: 'blocked' })
      .where(eq(users.id, seedIds.user('learner2')));
    await cli.db
      .insert(userIdentities)
      .values({ cognitoSub: 'sub-admin', userId: seedIds.user('admin'), provider: 'google' });

    const before = await graphNodes();
    const again = await cli.run(['seed']);
    expect(again.exitCode).toBe(0);
    expect(again.lines.join('\n')).toContain('users: 0 created');
    expect(again.lines.join('\n')).toContain('graph: 0 nodes and 0 relationships created');
    expect(await graphNodes()).toBe(before);

    const [learner] = await cli.db
      .select()
      .from(users)
      .where(eq(users.id, seedIds.user('learner')));
    const [learner2] = await cli.db
      .select()
      .from(users)
      .where(eq(users.id, seedIds.user('learner2')));
    expect(learner?.role).toBe('reviewer');
    expect(learner2?.status).toBe('blocked');
    expect(await cli.db.select().from(userIdentities)).toHaveLength(1);

    await cli.db
      .update(users)
      .set({ role: 'learner' })
      .where(eq(users.id, seedIds.user('learner')));
    await cli.db
      .update(users)
      .set({ status: 'active' })
      .where(eq(users.id, seedIds.user('learner2')));
    await cli.db.delete(userIdentities);
  });

  it('refuses a seed directory with problems and loads nothing', async () => {
    const result = await cli.run(['seed', '--dir', '/nonexistent-seed-directory']);
    expect(result.exitCode).toBe(1);
  });
});

describe('user commands', () => {
  const learnerEmail = seedIds.email('learner');

  it('grant-role changes the role and names the user id, not the address', async () => {
    const result = await cli.run(['grant-role', learnerEmail, 'reviewer']);
    expect(result.exitCode).toBe(0);
    const output = result.lines.join('\n');
    expect(output).toContain(seedIds.user('learner'));
    expect(output).not.toContain(learnerEmail);
    const [row] = await cli.db
      .select()
      .from(users)
      .where(eq(users.id, seedIds.user('learner')));
    expect(row?.role).toBe('reviewer');
    await cli.run(['grant-role', learnerEmail, 'learner']);
  });

  it('exits 1 for an unknown address or role', async () => {
    const unknown = await cli.run(['grant-role', 'nobody@example.test', 'admin']);
    expect(unknown.exitCode).toBe(1);
    expect(unknown.errors).toContain('No account with that e-mail address');
    const badRole = await cli.run(['grant-role', learnerEmail, 'emperor']);
    expect(badRole.exitCode).toBe(1);
  });

  it('block-user then unblock-user toggle status', async () => {
    expect((await cli.run(['block-user', learnerEmail])).exitCode).toBe(0);
    let [row] = await cli.db
      .select()
      .from(users)
      .where(eq(users.id, seedIds.user('learner')));
    expect(row?.status).toBe('blocked');
    expect((await cli.run(['unblock-user', learnerEmail])).exitCode).toBe(0);
    [row] = await cli.db
      .select()
      .from(users)
      .where(eq(users.id, seedIds.user('learner')));
    expect(row?.status).toBe('active');
  });

  it('block-user on the only active admin exits 1', async () => {
    const result = await cli.run(['block-user', seedIds.email('admin')]);
    expect(result.exitCode).toBe(1);
    expect(result.errors.join('\n')).toContain('At least one active admin must remain');
  });
});

describe('access code commands', () => {
  it('create-code prints one code in the documented format once and stores only its hash', async () => {
    const result = await cli.run(['create-code', '--label', 'demo', '--prompt', '2', '--max', '5']);
    expect(result.exitCode).toBe(0);
    const codes = result.lines.filter((line) => /^GC-([0-9A-Z]{5}-){3}[0-9A-Z]{5}$/.test(line));
    expect(codes).toHaveLength(1);
    const code = codes[0]!;
    const rows = await cli.db.select().from(accessCodes).where(eq(accessCodes.label, 'demo'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.codeHash).toBe(hashCode(normalizeCode(code)!));
    expect(rows[0]).toMatchObject({ promptRuns: 2, sourceRuns: 0, maxRedemptions: 5 });
    expect(JSON.stringify(rows[0])).not.toContain(code);
    expect(result.logs.join('\n')).not.toContain(code);
  });

  it('refuses a code with no grant', async () => {
    const result = await cli.run([
      'create-code',
      '--label',
      'empty',
      '--source',
      '0',
      '--prompt',
      '0',
      '--lift-days',
      '0',
    ]);
    expect(result.exitCode).toBe(1);
    expect(
      await cli.db.select().from(accessCodes).where(eq(accessCodes.label, 'empty')),
    ).toHaveLength(0);
  });

  it('--generate-only prints a code and writes no row', async () => {
    const before = (await cli.db.select().from(accessCodes)).length;
    const result = await cli.run(['create-code', '--generate-only']);
    expect(result.exitCode).toBe(0);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatch(/^GC-([0-9A-Z]{5}-){3}[0-9A-Z]{5}$/);
    expect((await cli.db.select().from(accessCodes)).length).toBe(before);
  });

  it('--from-env stores the hash, prints id and label only, and never the value', async () => {
    const code = generateCode();
    process.env.INVITE_CODE = code;
    try {
      const result = await cli.run([
        'create-code',
        '--label',
        'live',
        '--prompt',
        '1',
        '--from-env',
        'INVITE_CODE',
      ]);
      expect(result.exitCode).toBe(0);
      const everything = [...result.lines, ...result.errors, ...result.logs].join('\n');
      expect(everything).not.toContain(code);
      expect(everything).not.toContain(normalizeCode(code)!);
      expect(everything).toContain('live');
      const [row] = await cli.db.select().from(accessCodes).where(eq(accessCodes.label, 'live'));
      expect(row?.codeHash).toBe(hashCode(normalizeCode(code)!));
      expect(everything).toContain(row!.id);

      // A value whose hash already exists is refused.
      const duplicate = await cli.run([
        'create-code',
        '--label',
        'again',
        '--prompt',
        '1',
        '--from-env',
        'INVITE_CODE',
      ]);
      expect(duplicate.exitCode).toBe(1);
      expect(duplicate.errors.join('\n')).toContain('This code already exists');
      expect(duplicate.errors.join('\n')).not.toContain(code);
    } finally {
      delete process.env.INVITE_CODE;
    }

    // The stored code can be redeemed by a signed-in user.
    const http = await cli.http();
    try {
      const login = await http.post('/auth/dev-login').send({ email: seedIds.email('learner') });
      const redeemed = await http
        .post('/me/codes/redeem')
        .set({ Authorization: `Bearer ${login.body.accessToken}` })
        .send({ code });
      expect(redeemed.status).toBe(200);
      expect(redeemed.body).toEqual({ sourceRuns: 0, promptRuns: 1 });
    } finally {
      await http.close();
    }
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['19 symbols', '0123456789ABCDEFGHJ'],
    ['21 symbols', '0123456789ABCDEFGHJKM'],
    ['a symbol outside the alphabet', '0123456789ABCDEFGHJU'],
  ])('--from-env with a value that is %s exits 1 and stores nothing', async (_name, value) => {
    const before = (await cli.db.select().from(accessCodes)).length;
    if (value === undefined) delete process.env.BAD_CODE;
    else process.env.BAD_CODE = value;
    try {
      const result = await cli.run([
        'create-code',
        '--label',
        'bad',
        '--prompt',
        '1',
        '--from-env',
        'BAD_CODE',
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.errors).toContain('ENV BAD_CODE: not a valid access code');
      if (value) expect(result.errors.join('\n') + result.logs.join('\n')).not.toContain(value);
    } finally {
      delete process.env.BAD_CODE;
    }
    expect((await cli.db.select().from(accessCodes)).length).toBe(before);
  });

  it('list-codes shows metadata without code or hash; disable-code blocks later redemptions', async () => {
    const list = await cli.run(['list-codes']);
    expect(list.exitCode).toBe(0);
    const text = list.lines.join('\n');
    expect(text).toContain('demo');
    expect(text).toContain('redeemed=0/5');
    const [row] = await cli.db.select().from(accessCodes).where(eq(accessCodes.label, 'demo'));
    expect(text).not.toContain(row!.codeHash);

    const disabled = await cli.run(['disable-code', row!.id]);
    expect(disabled.exitCode).toBe(0);
    const [after] = await cli.db.select().from(accessCodes).where(eq(accessCodes.id, row!.id));
    expect(after?.disabled).toBe(true);

    expect((await cli.run(['disable-code', '00000000-0000-4000-8000-000000000000'])).exitCode).toBe(
      1,
    );
  });

  it('grant-runs adds to the bonus columns; an unknown address exits 1', async () => {
    const result = await cli.run([
      'grant-runs',
      seedIds.email('learner'),
      '--source',
      '1',
      '--prompt',
      '2',
    ]);
    expect(result.exitCode).toBe(0);
    const [row] = await cli.db
      .select()
      .from(users)
      .where(eq(users.id, seedIds.user('learner')));
    expect(row).toMatchObject({ bonusSourceRuns: 1, bonusPromptRuns: 3 }); // 1 prompt from the redeemed code
    expect((await cli.run(['grant-runs', 'nobody@example.test', '--source', '1'])).exitCode).toBe(
      1,
    );
    expect((await cli.run(['grant-runs', seedIds.email('learner')])).exitCode).toBe(1);
  });
});

describe('reset', () => {
  it('refuses in production', async () => {
    const result = await cli.run(['reset', '--yes'], { envObject: { NODE_ENV: 'production' } });
    expect(result.exitCode).toBe(1);
    expect(await graphNodes()).toBeGreaterThan(0);
  });

  it('without confirmation exits 2 and changes nothing', async () => {
    const nodes = await graphNodes();
    const rows = (await cli.db.select().from(users)).length;
    const result = await cli.run(['reset'], { answer: 'something else' });
    expect(result.exitCode).toBe(2);
    expect(await graphNodes()).toBe(nodes);
    expect((await cli.db.select().from(users)).length).toBe(rows);
  });

  it('--yes empties the graph and the tables', async () => {
    const result = await cli.run(['reset', '--yes']);
    expect(result.exitCode).toBe(0);
    expect(await graphNodes()).toBe(0);
    expect(await cli.db.select().from(users)).toHaveLength(0);
    expect(await cli.db.select().from(adminSettings)).toHaveLength(0);
    expect(result.lines.join('\n')).toContain('seed');
  });
});
