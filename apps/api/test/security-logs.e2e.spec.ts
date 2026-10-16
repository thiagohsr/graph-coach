/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are untyped JSON in these tests */
// Security checklist row SEC-22 (and the log clauses of SEC-43 and SEC-47), the design documents:
// the demo path runs at debug level in one test application, and every Nest Logger line (all levels), every configuration
// error, and everything the CLI printed is searched for secrets and private text.
//
// Capture: Logger.prototype and the static Logger methods are spied before the application is built, so every level reaches the
// capture regardless of the configured LOG_LEVEL (the filter sits below this point) and regardless of `logger: false`.
// Out of scope for an API test: the web server's output (apps/web), and `console.*` calls in `main.ts` (not run in process);
// the configuration errors that `main.ts` prints are covered through the EnvError text it prints.
import { Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { testing as fixtures } from '@coach/agents/curator';
import { seedIds } from '@coach/graph-kit';
import { accessCodes } from '../src/apps/allowance/access-code.model';
import { normalizeCode } from '../src/apps/allowance/code-format';
import { CodesService } from '../src/apps/allowance/codes.service';
import { RunOrchestrator } from '../src/apps/curator/run-orchestrator.service';
import { SettingsService } from '../src/common/settings/settings.service';
import { EnvError, parseEnv } from '../src/config/env';
import { createCliHarness, type CliHarness } from './support/cli-harness';
import { publishDirectly, seedRun } from './support/review-fixture';
import { createTestApp, type TestApp, type TestUser } from './support/test-app';

const {
  CURATOR_LABELS,
  PROMPT_LABELS,
  LONG_TEXT,
  chainLinksFor,
  draftsFor,
  extractedConceptsFor,
  outlineFor,
  promptDraftsFor,
  critiquesFor,
} = fixtures;

// ─── Capture ─────────────────────────────────────────────────────────────────

interface Captured {
  where: string;
  text: string;
}
const captured: Captured[] = [];
let phase = 'start';
const record = (where: string, text: string) => captured.push({ where, text });

const LEVELS = ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const;
const spies: Array<{ mockRestore(): void }> = [];

function installLogCapture(): void {
  for (const level of LEVELS) {
    const sink = (...args: unknown[]) => {
      record(
        `logger.${level} [${phase}]`,
        args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '),
      );
    };
    spies.push(vi.spyOn(Logger.prototype as any, level).mockImplementation(sink as never));
    spies.push(vi.spyOn(Logger as any, level).mockImplementation(sink as never));
  }
  for (const level of ['log', 'warn', 'error', 'info', 'debug'] as const) {
    spies.push(
      vi
        .spyOn(console, level)
        .mockImplementation(((...args: unknown[]) =>
          record(`console.${level} [${phase}]`, args.map((a) => String(a)).join(' '))) as never),
    );
  }
}

// ─── Secrets and private text ────────────────────────────────────────────────

const JWT_SECRET = 'test-only-signing-secret-0123456789'; // createTestApp's fixed value
const LANGFUSE_PK = 'pk-lf-sec22-public-sentinel-aaaa';
const LANGFUSE_SK = 'sk-lf-sec22-secret-sentinel-bbbb';
const DB_PASSWORD = 'sec22-db-password-sentinel';
const SOURCE_SENTENCE =
  'The lighthouse keeper of Wrenhollow catalogues every migrating moth by the colour of its dust.';
const FAILED_SENTENCE =
  'Under the Quillmere viaduct the ferrymen trade riddles for salted plums every dusk.';
const BRIEF_SUBJECT = 'Tidal almanacs of the Skerrin archipelago';
const GOAL_TEXT = 'I want to understand the Skerrin tidal almanac ledgers thoroughly';
const LOGIN_PASSWORD = 'sec22-login-pw-sentinel';
const BOOT_EMAIL = 'boot.admin.sec22@bootstrap.example.test';

const UPLOAD_TEXT = `${LONG_TEXT}\n\n${SOURCE_SENTENCE}`;
const FAILED_TEXT = `${LONG_TEXT}\n\n${FAILED_SENTENCE}`;

let app: TestApp;
let cli: CliHarness;
let orchestrator: RunOrchestrator;
let alice: TestUser; // owner: uploads, prompts, shares
let bob: TestUser; // share recipient
let carol: TestUser; // redeems a code
let blocked: TestUser;
const tokens: string[] = [];
const emails: string[] = [BOOT_EMAIL];
const codesSeen: string[] = []; // plain code texts (and normalised forms)
let cliCode = '';
let cliCodeLines: string[] = [];

const userMessage = (call: { messages: Array<{ role: string; content: string }> }) =>
  call.messages.find((m) => m.role === 'user')?.content ?? '';

beforeAll(async () => {
  installLogCapture();
  phase = 'setup';
  app = await createTestApp({
    env: {
      LOG_LEVEL: 'debug',
      LANGFUSE_PUBLIC_KEY: LANGFUSE_PK,
      LANGFUSE_SECRET_KEY: LANGFUSE_SK,
      LANGFUSE_HOST: 'http://127.0.0.1:9',
      BOOTSTRAP_ADMIN_EMAILS: BOOT_EMAIL,
    },
  });
  cli = await createCliHarness();
  orchestrator = app.app.get(RunOrchestrator);
  const settings = app.app.get(SettingsService);
  await settings.set('monthlySourceAllowance', 20);
  await settings.set('monthlyPromptAllowance', 20);
  await settings.set('hourlyCreationLimit', 50);
  await settings.set('chunkSizeChars', 300);

  app.chat.on(CURATOR_LABELS.extract, (call) => {
    if (userMessage(call).includes('Quillmere')) return new Error('scripted provider failure');
    return extractedConceptsFor(call);
  });
  app.chat.on(CURATOR_LABELS.link, (call) => chainLinksFor(call));
  app.chat.on(CURATOR_LABELS.draft, (call) => draftsFor(call));
  app.chat.on(PROMPT_LABELS.outline, (call) => outlineFor(call));
  app.chat.on(PROMPT_LABELS.write, (call) => promptDraftsFor(call));
  app.chat.on(PROMPT_LABELS.critique, (call) => critiquesFor(call));

  alice = await app.createUser({
    name: 'Zephyrina Quillborne',
    email: 'zephyrina.quillborne@sec22-alpha.example.test',
  });
  bob = await app.createUser({
    name: 'Bartholomew Nightjar',
    email: 'bartholomew.nightjar@sec22-beta.example.test',
  });
  carol = await app.createUser({
    name: 'Cornelius Marrowby',
    email: 'cornelius.marrowby@sec22-gamma.example.test',
  });
  blocked = await app.createUser({
    name: 'Blocked Person',
    email: 'blocked.person@sec22-delta.example.test',
  });
  emails.push(
    alice.email,
    bob.email,
    carol.email,
    blocked.email,
    ...(['learner', 'learner2', 'reviewer', 'admin'] as const).map((k) => seedIds.email(k)),
  );
  tokens.push(alice.token, bob.token, carol.token, blocked.token);
  phase = 'demo';
}, 60_000);

afterAll(async () => {
  for (const spy of spies) spy.mockRestore();
  Logger.overrideLogger(false);
  await cli?.close();
  await app?.close();
});

// ─── The demo path ───────────────────────────────────────────────────────────

describe('SEC-22 the demo path at debug level', () => {
  it('refused tokens: expired, malformed, signed with another secret, missing, and a blocked user', async () => {
    phase = 'refused-token';
    const expired = await app.expiredToken(alice.id);
    const garbage = 'sec22.garbage.token-value';
    tokens.push(expired, garbage);
    const statuses = [
      (await app.http.get('/me/allowance').set({ Authorization: `Bearer ${expired}` })).status,
      (await app.http.get('/me/allowance').set({ Authorization: `Bearer ${garbage}` })).status,
      (await app.http.get('/me/allowance')).status,
    ];
    expect(statuses).toEqual([401, 401, 401]);
    await app.setStatus(blocked.id, 'blocked');
    const refused = await app.http.get('/me/allowance').set(blocked.auth);
    expect([401, 403]).toContain(refused.status);
  });

  it('configuration errors: the EnvError text names the variable and never holds the value', () => {
    phase = 'config-error';
    const base = {
      DATABASE_URL: 'postgres://coach:coach@localhost:5432/coach',
      JWT_SECRET,
      AUTH_MODE: 'dev',
      NODE_ENV: 'test',
      WEB_ORIGIN: 'http://localhost:3000',
      LLM_PROVIDER: 'stub',
      EMBEDDING_PROVIDER: 'stub',
    };
    const cases: Array<Record<string, string>> = [
      { ...base, DATABASE_URL: `mysql://coach:${DB_PASSWORD}@localhost:3306/coach` },
      { ...base, JWT_SECRET: 'short-sec22' },
      { ...base, NODE_ENV: 'production', WEB_ORIGIN: 'https://coach.example.test' }, // dev sign-in refused in production, secret present
      { ...base, LANGFUSE_HOST: `ftp://${LANGFUSE_PK}:${LANGFUSE_SK}@tracing.example.test` },
      {
        ...base,
        LLM_PROVIDER: 'openai',
        LLM_MODEL: 'm',
        LLM_BASE_URL: `ftp://x:${DB_PASSWORD}@h`,
        LLM_API_KEY: 'sk-sec22-llm-key-sentinel',
      },
      {
        ...base,
        LLM_PROVIDER: 'openai',
        LLM_MODEL: 'm',
        LLM_BASE_URL: 'https://models.example.test/v1',
      }, // key missing
    ];
    let thrown = 0;
    for (const source of cases) {
      try {
        parseEnv(source as NodeJS.ProcessEnv);
      } catch (error) {
        thrown += 1;
        expect(error).toBeInstanceOf(EnvError);
        // What main.ts prints: the problems joined by newlines.
        record('config-error problems', (error as EnvError).problems.join('\n'));
        record('config-error message', (error as Error).message);
      }
    }
    expect(thrown).toBe(cases.length);
    captureExtraSecrets.push(DB_PASSWORD, 'sk-sec22-llm-key-sentinel', 'short-sec22');
  });

  it('cli seed (debug logging) over its own schema', async () => {
    phase = 'cli-seed';
    for (const command of ['migrate', 'setup-graph']) {
      const prepared = await cli.run([command], { env: { LOG_LEVEL: 'debug' } });
      expect(prepared.exitCode, prepared.errors.join('\n')).toBe(0);
      [...prepared.lines, ...prepared.errors, ...prepared.logs].forEach((l) =>
        record(`cli ${command}`, l),
      );
    }
    const result = await cli.run(['seed'], {
      env: {
        LOG_LEVEL: 'debug',
        LANGFUSE_PUBLIC_KEY: LANGFUSE_PK,
        LANGFUSE_SECRET_KEY: LANGFUSE_SK,
      },
    });
    expect(result.exitCode, result.errors.join('\n')).toBe(0);
    result.lines.forEach((l) => record('cli seed stdout', l));
    result.errors.forEach((l) => record('cli seed stderr', l));
    result.logs.forEach((l) => record('cli seed logs', l));
    const again = await cli.run(['grant-role', seedIds.email('learner'), 'reviewer'], {
      env: { LOG_LEVEL: 'debug' },
    });
    again.lines.forEach((l) => record('cli grant-role stdout', l));
    again.errors.forEach((l) => record('cli grant-role stderr', l));
    again.logs.forEach((l) => record('cli grant-role logs', l));
    const unknown = await cli.run(['grant-role', 'nobody.sec22@example.test', 'admin']);
    unknown.errors.forEach((l) => record('cli unknown stderr', l));
    unknown.lines.forEach((l) => record('cli unknown stdout', l));
    unknown.logs.forEach((l) => record('cli unknown logs', l));
    emails.push('nobody.sec22@example.test');
  });

  it('ingestion with scripted stub responses: a source that succeeds and one whose provider call fails', async () => {
    phase = 'ingestion';
    const ok = await app.http
      .post('/sources')
      .set(alice.auth)
      .send({ title: 'Moth notes', kind: 'text', content: UPLOAD_TEXT });
    expect(ok.status).toBe(202);
    await orchestrator.whenIdle(ok.body.taskId);
    const done = await app.http.get(`/tasks/${ok.body.taskId}`).set(alice.auth);
    expect(done.body.status).toBe('awaiting_review');

    const bad = await app.http
      .post('/sources')
      .set(alice.auth)
      .send({ title: 'Ferry notes', kind: 'text', content: FAILED_TEXT });
    expect(bad.status).toBe(202);
    await orchestrator.whenIdle(bad.body.taskId);
    const failed = await app.http.get(`/tasks/${bad.body.taskId}`).set(alice.auth);
    expect(failed.body.status).toBe('failed');
    expect(app.chat.calls.length).toBeGreaterThan(5);
  });

  it('prompt creation (the planner, writer and critic calls)', async () => {
    phase = 'prompt-creation';
    const res = await app.http
      .post('/sources')
      .set(alice.auth)
      .send({
        title: 'Tides',
        kind: 'prompt',
        brief: { subject: BRIEF_SUBJECT, difficulty: 'easy', sentences: 4 },
      });
    expect(res.status).toBe(202);
    await orchestrator.whenIdle(res.body.taskId);
    const task = await app.http.get(`/tasks/${res.body.taskId}`).set(alice.auth);
    expect(task.body.status).toBe('awaiting_review');
  });

  it('dev-login with a password, then a share by e-mail and its revocation', async () => {
    phase = 'login-share';
    const login = await app.http
      .post('/auth/dev-login')
      .send({ email: bob.email, password: LOGIN_PASSWORD });
    expect(login.status).toBe(200);
    tokens.push(login.body.accessToken);
    const run = await seedRun(app, alice, { drafts: 3 });
    await publishDirectly(app, run.puzzleId);
    const shared = await app.http
      .put(`/puzzles/${run.puzzleId}/shares`)
      .set(alice.auth)
      .send({ email: bob.email, withSource: true });
    expect(shared.status).toBe(200);
    const missing = await app.http
      .put(`/puzzles/${run.puzzleId}/shares`)
      .set(alice.auth)
      .send({ email: 'nobody.share.sec22@example.test' });
    expect(missing.status).toBe(422);
    emails.push('nobody.share.sec22@example.test');
    expect(
      (await app.http.delete(`/puzzles/${run.puzzleId}/shares/${bob.id}`).set(alice.auth)).status,
    ).toBeLessThan(300);
  });

  it('a provider call from the Coach (a goal is embedded)', async () => {
    phase = 'provider-call';
    const before = app.embeddings.calls.length;
    const res = await app.http
      .post('/coach/recommendations')
      .set(alice.auth)
      .send({ goal: GOAL_TEXT });
    expect([201, 409]).toContain(res.status);
    expect(app.embeddings.calls.length).toBeGreaterThan(before);
  });

  it('code creation and redemption through the API, then cli create-code', async () => {
    phase = 'codes';
    const codes = app.app.get(CodesService);
    const { code, meta } = await codes.create({
      label: 'sec22',
      sourceRuns: 0,
      promptRuns: 2,
      liftDays: 0,
      maxRedemptions: 5,
    });
    codesSeen.push(code, normalizeCode(code)!);
    const redeemed = await app.http.post('/me/codes/redeem').set(carol.auth).send({ code });
    expect(redeemed.status).toBe(200);
    const refused = await app.http.post('/me/codes/redeem').set(carol.auth).send({ code });
    expect(refused.status).toBe(422);
    const wrong = await app.http
      .post('/me/codes/redeem')
      .set(carol.auth)
      .send({ code: 'GC-00000-00000-00000-00000' });
    expect(wrong.status).toBe(422);
    const [row] = await app.db.select().from(accessCodes).where(eq(accessCodes.id, meta.id));
    hashes.push(row!.codeHash);

    const created = await cli.run(
      ['create-code', '--label', 'sec22cli', '--prompt', '2', '--max', '5'],
      { env: { LOG_LEVEL: 'debug' } },
    );
    expect(created.exitCode).toBe(0);
    cliCodeLines = created.lines.filter((l) => /^GC-([0-9A-Z]{5}-){3}[0-9A-Z]{5}$/.test(l));
    expect(cliCodeLines).toHaveLength(1);
    cliCode = cliCodeLines[0]!;
    codesSeen.push(cliCode, normalizeCode(cliCode)!);
    // The code may appear once, in its own printed output; the other lines of that output are searched below.
    created.lines.filter((l) => l !== cliCode).forEach((l) => record('cli create-code stdout', l));
    created.errors.forEach((l) => record('cli create-code stderr', l));
    created.logs.forEach((l) => record('cli create-code logs', l));
    const [cliRow] = await cli.db
      .select()
      .from(accessCodes)
      .where(eq(accessCodes.label, 'sec22cli'));
    hashes.push(cliRow!.codeHash);
    // list-codes, as the operator would run it next
    const listed = await cli.run(['list-codes'], { env: { LOG_LEVEL: 'debug' } });
    listed.lines.forEach((l) => record('cli list-codes stdout', l));
    listed.logs.forEach((l) => record('cli list-codes logs', l));
  });
});

const hashes: string[] = [];
const captureExtraSecrets: string[] = [];

// ─── The search ──────────────────────────────────────────────────────────────

describe('SEC-22 / SEC-43 / SEC-47 search of everything captured', () => {
  const hitsFor = (needle: string, ignoreCase = false): string[] => {
    const n = ignoreCase ? needle.toLowerCase() : needle;
    return captured
      .filter((c) => (ignoreCase ? c.text.toLowerCase() : c.text).includes(n))
      .map((c) => `${c.where}: ${c.text.slice(0, 200)}`);
  };

  it('the capture is substantial, holds debug lines from several phases, and the premises hold', () => {
    const wheres = new Set(captured.map((c) => c.where));
    expect(captured.length).toBeGreaterThan(40);
    // Every level is captured; the levels the application actually emits are listed in the failure message if this changes.
    const levels = [
      ...new Set(
        captured.filter((c) => c.where.startsWith('logger.')).map((c) => c.where.split(' ')[0]),
      ),
    ].sort();
    expect(levels, `levels emitted: ${levels.join(', ')}`).toContain('logger.log');
    expect(levels).toContain('logger.warn');
    expect([...wheres].some((w) => w.startsWith('cli seed'))).toBe(true);
    expect([...wheres].some((w) => w.startsWith('config-error'))).toBe(true);
    expect([...wheres].some((w) => w.includes('[ingestion]'))).toBe(true);
    // the request log of a refused token is there (the search below is meaningful)
    expect(captured.some((c) => c.where.includes('[refused-token]') && /401/.test(c.text))).toBe(
      true,
    );
    // positive control: the search does find what is logged on purpose (user ids, task ids, request lines)
    expect(hitsFor(alice.id).length).toBeGreaterThan(0);
    expect(hitsFor('POST /api/sources 202').length).toBeGreaterThan(0);
    expect(tokens.length).toBeGreaterThanOrEqual(7);
    expect(hashes).toHaveLength(2);
    for (const h of hashes) expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(cliCode).toMatch(/^GC-/);
  });

  it('no token string appears in any line', () => {
    for (const token of tokens)
      expect(hitsFor(token), `token ${token.slice(0, 12)}...`).toEqual([]);
  });

  it('"Bearer " does not appear in any line', () => {
    expect(hitsFor('Bearer ', true)).toEqual([]);
  });

  it('"password" does not appear in any line', () => {
    expect(hitsFor('password', true)).toEqual([]);
    expect(hitsFor(LOGIN_PASSWORD)).toEqual([]);
  });

  it('no demo e-mail address appears in any line (case-insensitive)', () => {
    for (const email of emails) expect(hitsFor(email, true), email).toEqual([]);
  });

  it('no configured secret appears: JWT secret, Langfuse keys, database password, other values given to the configuration errors', () => {
    for (const secret of [
      JWT_SECRET,
      LANGFUSE_PK,
      LANGFUSE_SK,
      DB_PASSWORD,
      ...captureExtraSecrets,
    ]) {
      expect(hitsFor(secret), secret).toEqual([]);
    }
  });

  it('SEC-47: no code text (typed or normalised) and no code_hash appears in any line; the cli code was printed exactly once, in its own output', () => {
    for (const code of codesSeen) expect(hitsFor(code, true), code).toEqual([]);
    for (const hash of hashes) expect(hitsFor(hash, true), hash).toEqual([]);
    expect(cliCodeLines).toEqual([cliCode]);
  });

  it('no distinctive sentence of an ingested source, of a prompt brief, or of a goal appears in any line', () => {
    for (const text of [
      SOURCE_SENTENCE,
      FAILED_SENTENCE,
      BRIEF_SUBJECT,
      GOAL_TEXT,
      'Wrenhollow',
      'Quillmere',
      'Skerrin',
    ]) {
      expect(hitsFor(text, true), text).toEqual([]);
    }
  });
});
