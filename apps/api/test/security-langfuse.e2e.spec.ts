/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are untyped JSON in these tests */
// Security checklist row SEC-53 (the design documents): a run completes when Langfuse is
// unreachable, and with only some of the three Langfuse variables set the tracer is the no-op one and nothing is sent.
//
// How the real tracer gets in: `createTestApp` replaces the three LlmModule providers with stubs on a recording tracer. Here the
// USAGE_TRACER is replaced again with the same factory LlmModule uses (`createUsageTracer(env.tracer, { logger: new Logger('UsageTracer') })`,
// from the app's parsed environment), and the stub chat and embeddings providers are built on whatever tracer the container
// then holds. `LlmLifecycle` (the partial-configuration warning) is the application's own, unchanged.
// "Unreachable" is 127.0.0.1:9 (discard port, nothing listens): connections are refused locally. No real host is contacted.
import net from 'node:net';
import { Logger } from '@nestjs/common';
import type { TestingModuleBuilder } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testing as fixtures } from '@coach/agents/curator';
import {
  LangfuseUsageTracer,
  NoopUsageTracer,
  StubChatProvider,
  StubEmbeddingsProvider,
  createUsageTracer,
  type UsageTracer,
} from '@coach/agents/llm';
import { RunOrchestrator } from '../src/apps/curator/run-orchestrator.service';
import { SettingsService } from '../src/common/settings/settings.service';
import { ENV } from '../src/config/config.module';
import type { Env } from '../src/config/env';
import { addAgents, addConcepts, addMastery, addPuzzle } from './support/coach-fixture';
import { CHAT_PROVIDER, EMBEDDINGS_PROVIDER, USAGE_TRACER } from './support/providers';
import { createTestApp, type TestApp } from './support/test-app';

const { CURATOR_LABELS, PROMPT_LABELS, LONG_TEXT, chainLinksFor, draftsFor, extractedConceptsFor, outlineFor, promptDraftsFor, critiquesFor } =
  fixtures;

const PK = 'pk-lf-sec53-public-sentinel-1111';
const SK = 'sk-lf-sec53-secret-sentinel-2222';
const DEAD_HOST = 'http://127.0.0.1:9';
const KEYS = [PK, SK];

// ─── Capture of log lines, console output, and connection attempts ───────────

let lines: Array<{ level: string; text: string }> = [];
let connects: number[] = [];
let fetches: string[] = [];
const spies: Array<{ mockRestore(): void }> = [];

function installCapture(): void {
  for (const level of ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const) {
    const sink = (...args: unknown[]) =>
      void lines.push({ level, text: args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') });
    spies.push(vi.spyOn(Logger.prototype as any, level).mockImplementation(sink as never));
    spies.push(vi.spyOn(Logger as any, level).mockImplementation(sink as never));
  }
  for (const level of ['log', 'warn', 'error', 'info', 'debug'] as const) {
    spies.push(
      vi.spyOn(console, level).mockImplementation(((...args: unknown[]) =>
        void lines.push({ level: `console.${level}`, text: args.map((a) => String(a)).join(' ') })) as never),
    );
  }
  // Connection attempts (call through): which ports were dialled.
  const connect = net.Socket.prototype.connect as (...args: any[]) => net.Socket;
  spies.push(
    vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(function (this: net.Socket, ...args: any[]) {
      const first = args[0];
      const port = typeof first === 'object' && first !== null ? Number(first.port) : Number(first);
      connects.push(port);
      return connect.apply(this, args);
    } as never),
  );
  const realFetch = globalThis.fetch;
  spies.push(
    vi.spyOn(globalThis, 'fetch').mockImplementation(((input: any, init?: any) => {
      fetches.push(String(input?.url ?? input));
      return realFetch(input, init);
    }) as never),
  );
}

beforeEach(() => {
  lines = [];
  connects = [];
  fetches = [];
  installCapture();
});
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

// ─── Application with the real tracer ────────────────────────────────────────

interface Built {
  t: TestApp;
  chat: StubChatProvider;
  embeddings: StubEmbeddingsProvider;
  tracer: UsageTracer;
}

async function build(env: Record<string, string>): Promise<Built> {
  const built: Partial<Built> = {};
  const configure = (builder: TestingModuleBuilder) =>
    builder
      .overrideProvider(USAGE_TRACER)
      .useFactory({
        inject: [ENV],
        factory: (e: Env): UsageTracer => (built.tracer = createUsageTracer(e.tracer, { logger: new Logger('UsageTracer') })),
      })
      .overrideProvider(CHAT_PROVIDER)
      .useFactory({ inject: [USAGE_TRACER], factory: (tracer: UsageTracer) => (built.chat = new StubChatProvider({ tracer })) })
      .overrideProvider(EMBEDDINGS_PROVIDER)
      .useFactory({
        inject: [USAGE_TRACER],
        factory: (tracer: UsageTracer) => (built.embeddings = new StubEmbeddingsProvider(64, { tracer })),
      });
  const t = await createTestApp({ env: { LOG_LEVEL: 'debug', ...env }, configure });
  const settings = t.app.get(SettingsService);
  await settings.set('monthlySourceAllowance', 20);
  await settings.set('monthlyPromptAllowance', 20);
  await settings.set('hourlyCreationLimit', 50);
  await settings.set('chunkSizeChars', 300);
  built.chat!.on(CURATOR_LABELS.extract, (call) => extractedConceptsFor(call));
  built.chat!.on(CURATOR_LABELS.link, (call) => chainLinksFor(call));
  built.chat!.on(CURATOR_LABELS.draft, (call) => draftsFor(call));
  built.chat!.on(PROMPT_LABELS.outline, (call) => outlineFor(call));
  built.chat!.on(PROMPT_LABELS.write, (call) => promptDraftsFor(call));
  built.chat!.on(PROMPT_LABELS.critique, (call) => critiquesFor(call));
  return { t, chat: built.chat!, embeddings: built.embeddings!, tracer: built.tracer! };
}

const noKeyIn = (text: string) => KEYS.every((k) => !text.includes(k));

/** upload creation, prompt creation, recommendation; returns the elapsed milliseconds of each. */
async function runThree(b: Built) {
  const { t } = b;
  const orchestrator = t.app.get(RunOrchestrator);
  const owner = await t.createUser({ name: 'Trace Owner' });
  const admin = await t.createUser({ role: 'admin', name: 'Trace Publisher' });
  const elapsed: Record<string, number> = {};

  let started = Date.now();
  const upload = await t.http.post('/sources').set(owner.auth).send({ title: 'Notes', kind: 'text', content: LONG_TEXT });
  expect(upload.status).toBe(202);
  await orchestrator.whenIdle(upload.body.taskId);
  elapsed.upload = Date.now() - started;
  const uploadTask = await t.http.get(`/tasks/${upload.body.taskId}`).set(owner.auth);

  started = Date.now();
  const prompt = await t.http
    .post('/sources')
    .set(owner.auth)
    .send({ title: 'Tides', kind: 'prompt', brief: { subject: 'Indexes in databases', difficulty: 'easy', sentences: 4 } });
  expect(prompt.status).toBe(202);
  await orchestrator.whenIdle(prompt.body.taskId);
  elapsed.prompt = Date.now() - started;
  const promptTask = await t.http.get(`/tasks/${prompt.body.taskId}`).set(owner.auth);

  await addAgents(t);
  await addConcepts(t, [{ slug: 'alpha' }]);
  await addMastery(t, owner.id, [{ slug: 'alpha', score: 0.2, attempts: 3, daysAgo: 3 }]);
  await addPuzzle(t, { id: 'p-alpha', name: 'Alpha basics', ownerId: admin.id, visibility: 'public', tests: ['alpha', 'alpha'] });
  started = Date.now();
  const rec = await t.http.post('/coach/recommendations').set(owner.auth).send({ goal: 'I want to learn ALPHA basics' });
  elapsed.recommendation = Date.now() - started;

  return { owner, upload, uploadTask, prompt, promptTask, rec, elapsed };
}

// Declared first, registered last: the Langfuse client of an unreachable-host app keeps retrying in the background after the
// app closes, and those retries must not land in the capture of a later test (they would look like a send with no host).
function unreachableHostTests(): void {
describe('SEC-53 all three Langfuse variables point at a host that does not answer', () => {
  it('upload creation, prompt creation, and a recommendation complete normally; usage is stored on Step, Task and Decision; at most a warning, with no key', async () => {
    const b = await build({ LANGFUSE_PUBLIC_KEY: PK, LANGFUSE_SECRET_KEY: SK, LANGFUSE_HOST: DEAD_HOST });
    try {
      // premise: this is the Langfuse tracer, not the no-op, and the application's own start-up logged nothing about partial configuration
      expect(b.tracer).toBeInstanceOf(LangfuseUsageTracer);
      expect(b.tracer.enabled).toBe(true);
      expect(b.t.app.get(USAGE_TRACER)).toBe(b.tracer);
      expect(lines.filter((l) => /Usage tracing is off/.test(l.text))).toEqual([]);

      const r = await runThree(b);

      // 1. all three complete normally
      expect(r.uploadTask.body).toMatchObject({ status: 'awaiting_review', lastCompletedStep: 'validate' });
      expect(r.promptTask.body).toMatchObject({ status: 'awaiting_review', lastCompletedStep: 'validate' });
      expect(r.rec.status).toBe(201);
      expect(r.rec.body.decisionId).toBeTruthy();

      // 2. the tracer never blocked a run: each finished well inside the 5 s flush limit of the tracer
      for (const [name, ms] of Object.entries(r.elapsed)) expect(ms, `${name} took ${ms} ms`).toBeLessThan(5000);

      // 3. usage on Task, Step (API) and in the graph (Step, Task, Decision nodes)
      for (const task of [r.uploadTask.body, r.promptTask.body]) {
        expect(task.usage.modelCalls).toBeGreaterThan(0);
        expect(task.steps.length).toBeGreaterThan(3);
        for (const step of task.steps) expect(step.usage).toBeDefined();
        expect(task.steps.some((s: any) => s.usage.modelCalls > 0)).toBe(true);
      }
      const nodeUsage = async (label: string) =>
        b.t.testGraph.cypher<Record<string, number>>(
          `MATCH (n:${label}) RETURN n.modelCalls AS modelCalls, n.inputTokens AS inputTokens, n.outputTokens AS outputTokens, n.embeddingTokens AS embeddingTokens`,
        );
      for (const label of ['Step', 'Task', 'Decision']) {
        const rows = await nodeUsage(label);
        expect(rows.length, label).toBeGreaterThan(0);
        for (const row of rows) {
          for (const key of ['modelCalls', 'inputTokens', 'outputTokens', 'embeddingTokens'] as const) {
            expect(typeof row[key], `${label}.${key}`).toBe('number');
          }
        }
      }
      expect((await nodeUsage('Step')).some((row) => row.modelCalls! > 0 && row.inputTokens! > 0)).toBe(true);
      expect((await nodeUsage('Task')).some((row) => row.modelCalls! > 0)).toBe(true);
      const decision = (
        await b.t.testGraph.cypher<Record<string, number>>(`MATCH (d:Decision {id: $id}) RETURN d.embeddingTokens AS embeddingTokens`, {
          id: r.rec.body.decisionId,
        })
      )[0];
      expect(decision!.embeddingTokens).toBeGreaterThan(0); // the goal was embedded

      // 4. the premise that Langfuse was actually tried: flush, and a connection to port 9 was attempted
      const flushStarted = Date.now();
      await b.tracer.flush();
      expect(Date.now() - flushStarted).toBeLessThan(6000);
      expect(connects.includes(9) || fetches.some((u) => u.startsWith(DEAD_HOST))).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 200));

      // 5. at most a warning, and no key anywhere in what was logged or printed
      const everything = lines.map((l) => l.text).join('\n');
      expect(noKeyIn(everything), 'a Langfuse key appears in a log or console line').toBe(true);
      const loud = lines.filter((l) => l.level === 'error' || l.level === 'fatal' || l.level === 'console.error');
      expect(loud.map((l) => `${l.level}: ${l.text.slice(0, 160)}`)).toEqual([]);
      const tracerWarnings = lines.filter((l) => l.level === 'warn' || l.level === 'console.warn');
      expect(tracerWarnings.length).toBeLessThanOrEqual(3);
      // The one other warning the test application always logs (the test graph has no stored dimension) is unrelated to tracing.
      for (const w of tracerWarnings) {
        expect(w.text).toMatch(/Usage tracing|Langfuse|fetch|ECONNREFUSED|stored embedding dimension could not be read/i);
      }
    } finally {
      const closeStarted = Date.now();
      await b.t.close();
      // shutdown flushes the tracer with a 5 s limit
      expect(Date.now() - closeStarted).toBeLessThan(9000);
    }
  }, 60_000);
});
}

describe('SEC-53 only some of the three Langfuse variables are set', () => {
  const cases: Array<{ name: string; env: Record<string, string>; missing: string[] }> = [
    { name: 'public key only', env: { LANGFUSE_PUBLIC_KEY: PK }, missing: ['LANGFUSE_SECRET_KEY', 'LANGFUSE_HOST'] },
    { name: 'public and secret key, no host', env: { LANGFUSE_PUBLIC_KEY: PK, LANGFUSE_SECRET_KEY: SK }, missing: ['LANGFUSE_HOST'] },
    { name: 'secret key and host, no public key', env: { LANGFUSE_SECRET_KEY: SK, LANGFUSE_HOST: DEAD_HOST }, missing: ['LANGFUSE_PUBLIC_KEY'] },
    { name: 'host only', env: { LANGFUSE_HOST: DEAD_HOST }, missing: ['LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY'] },
  ];

  it.each(cases)('$name: the app starts, logs the partial-configuration warning, uses the no-op tracer and sends nothing', async ({ env, missing }) => {
    const b = await build(env);
    try {
      expect(b.tracer).toBeInstanceOf(NoopUsageTracer);
      expect(b.tracer.enabled).toBe(false);
      const warning = lines.filter((l) => l.level === 'warn' && /Usage tracing is off/.test(l.text));
      expect(warning).toHaveLength(1);
      expect(warning[0]!.text).toBe(`Usage tracing is off: ${missing.join(', ')} not set`);

      // the app works: a run completes, and nothing was sent anywhere
      const orchestrator = b.t.app.get(RunOrchestrator);
      const owner = await b.t.createUser();
      const upload = await b.t.http.post('/sources').set(owner.auth).send({ title: 'Notes', kind: 'text', content: LONG_TEXT });
      expect(upload.status).toBe(202);
      await orchestrator.whenIdle(upload.body.taskId);
      const task = await b.t.http.get(`/tasks/${upload.body.taskId}`).set(owner.auth);
      expect(task.body.status).toBe('awaiting_review');
      await b.tracer.flush();
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(connects).not.toContain(9);
      expect(fetches.filter((u) => u.includes('127.0.0.1:9') || /langfuse/i.test(u))).toEqual([]);
      const everything = lines.map((l) => l.text).join('\n');
      expect(noKeyIn(everything)).toBe(true);
    } finally {
      await b.t.close();
    }
  }, 60_000);
});

unreachableHostTests();
