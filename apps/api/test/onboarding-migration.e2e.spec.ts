import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The 0002 migration (spec 009, reconciliation O4): existing accounts become onboarded, except Demo Learner.

const DRIZZLE_DIR = join(__dirname, '..', 'drizzle');
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://coach:coach@localhost:5432/coach';
const schema = `test_mig_${randomBytes(6).toString('hex')}`;
let admin: postgres.Sql;
let sql: postgres.Sql;

async function apply(tag: string): Promise<void> {
  const text = readFileSync(join(DRIZZLE_DIR, `${tag}.sql`), 'utf8').replaceAll(
    '"public".',
    `"${schema}".`,
  );
  for (const statement of text.split('--> statement-breakpoint')) {
    if (statement.trim() !== '') await sql.unsafe(statement);
  }
}

beforeAll(async () => {
  admin = postgres(DATABASE_URL, { max: 1, onnotice: () => undefined });
  await admin.unsafe(`CREATE SCHEMA "${schema}"`);
  sql = postgres(DATABASE_URL, {
    max: 1,
    onnotice: () => undefined,
    connection: { search_path: schema },
  });
});

afterAll(async () => {
  await sql?.end({ timeout: 1 }).catch(() => undefined);
  await admin?.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
  await admin?.end({ timeout: 1 }).catch(() => undefined);
});

describe('migration 0002_onboarding', () => {
  it('marks existing accounts completed, except the seeded Demo Learner, and leaves new accounts null', async () => {
    await apply('0000_even_terror');
    await apply('0001_fast_warhawk');
    const ids = {
      learner: '00000000-0000-4000-8000-000000000001',
      reviewer: '00000000-0000-4000-8000-000000000002',
      author: '00000000-0000-4000-8000-000000000003',
    };
    await sql.unsafe(
      `INSERT INTO users (id, email, display_name, role) VALUES
        ('${ids.learner}', 'learner@example.test', 'Demo Learner', 'learner'),
        ('${ids.reviewer}', 'reviewer@example.test', 'Demo Reviewer', 'reviewer'),
        ('${ids.author}', 'author@example.com', 'Author', 'admin')`,
    );

    await apply('0002_onboarding');

    const rows = await sql<
      Array<{ id: string; onboarded_at: Date | null; onboarding_outcome: string | null }>
    >`SELECT id, onboarded_at, onboarding_outcome FROM users`;
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(ids.learner)?.onboarded_at).toBeNull();
    expect(byId.get(ids.learner)?.onboarding_outcome).toBeNull();
    for (const id of [ids.reviewer, ids.author]) {
      expect(byId.get(id)?.onboarded_at).toBeInstanceOf(Date);
      expect(byId.get(id)?.onboarding_outcome).toBe('completed');
    }

    await sql.unsafe(
      `INSERT INTO users (id, email, display_name) VALUES ('00000000-0000-4000-8000-000000000004', 'new@example.com', 'New')`,
    );
    const [fresh] = await sql`SELECT onboarded_at FROM users WHERE email = 'new@example.com'`;
    expect(fresh?.onboarded_at).toBeNull();
  });

  it('rejects an outcome other than completed or skipped', async () => {
    await expect(
      sql.unsafe(`UPDATE users SET onboarding_outcome = 'maybe' WHERE email = 'new@example.com'`),
    ).rejects.toThrow();
  });
});
