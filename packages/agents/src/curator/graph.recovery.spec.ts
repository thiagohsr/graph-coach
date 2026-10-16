// Failure and recovery of the upload graph (spec 005 story US6, SC-U05): a provider failure names its step and writes
// nothing from it, bad output is retried then fails, and a run stopped after any step and started again at the entry
// the stored task gives ends with the node and edge counts of an uninterrupted run.
import { describe, expect, it } from 'vitest';
import { ProviderUnavailableError } from '../llm/errors';
import { RecordingUsageTracer } from '../llm/recording-usage-tracer';
import { StubChatProvider, StubEmbeddingsProvider } from '../llm/stub';
import { MAX_OUTPUT_RETRIES } from './constants';
import { runCurator } from './graph';
import { resolveEntry, type CuratorNode } from './steps';
import { CURATOR_LABELS, LONG_TEXT, scriptCurator } from './testing/fixtures';
import { FakeCuratorGraph, makeDeps } from './testing/fake-graph-port';

const OWNER = 'owner-1';
const SOURCE = 'source-1';
const TASK = 'task-1';

const NODES: CuratorNode[] = [
  'chunk',
  'embed',
  'extractConcepts',
  'linkPrerequisites',
  'draftQuestions',
  'validate',
];

function setup(
  options: {
    embeddings?: StubEmbeddingsProvider;
    isActive?: (id: string) => Promise<boolean>;
  } = {},
) {
  const tracer = new RecordingUsageTracer();
  const graph = new FakeCuratorGraph();
  const chat = new StubChatProvider({ tracer });
  const embeddings = options.embeddings ?? new StubEmbeddingsProvider(16, { tracer });
  graph.addSource({ id: SOURCE, ownerId: OWNER, content: LONG_TEXT, title: 'Library notes' });
  graph.addTask({ id: TASK, sourceId: SOURCE, requesterId: OWNER });
  scriptCurator(chat);
  const deps = makeDeps({
    graph,
    chat,
    embeddings,
    tracer,
    ...(options.isActive ? { isActive: options.isActive } : {}),
  });
  const run = (entry: CuratorNode = 'chunk', over: Partial<typeof deps> = {}) =>
    runCurator(
      { ...deps, ...over },
      { taskId: TASK, kind: 'ingest', sourceId: SOURCE, ownerId: OWNER, entry },
    );
  return { graph, chat, embeddings, tracer, deps, run };
}

const shape = (g: FakeCuratorGraph) => ({
  chunks: g.count('Chunk'),
  concepts: g.count('Concept'),
  puzzles: g.count('Puzzle'),
  questions: g.count('Question'),
  steps: g.count('Step'),
  mentions: g.mentions.size,
  prerequisites: g.prerequisites.size,
  produced: g.produced.size,
});

const failingEmbeddings = () =>
  ({
    name: 'stub',
    model: 'x',
    dimension: 16,
    embed: async () => {
      throw new ProviderUnavailableError('down', { provider: 'stub' });
    },
  }) as unknown as StubEmbeddingsProvider;

describe('a provider that fails', () => {
  it('in embed: PROVIDER_UNAVAILABLE naming embed, an error step, and no vector written', async () => {
    const s = setup({ embeddings: failingEmbeddings() });
    await expect(s.run()).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', node: 'embed' });
    expect(s.graph.stepsOf(TASK).at(-1)).toMatchObject({ node: 'embed', status: 'error' });
    expect([...s.graph.chunks.values()].every((c) => c.embedding === null)).toBe(true);
    expect(s.graph.count('Concept')).toBe(0);
    expect(s.graph.count('Question')).toBe(0);
  });

  it('in extractConcepts: PROVIDER_UNAVAILABLE naming extractConcepts, and no concept written', async () => {
    const s = setup();
    s.chat.reset();
    s.chat.on(CURATOR_LABELS.extract, new Error('provider down'));
    await expect(s.run()).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      node: 'extractConcepts',
    });
    expect(s.graph.stepsOf(TASK).at(-1)).toMatchObject({
      node: 'extractConcepts',
      status: 'error',
    });
    expect(s.graph.count('Concept')).toBe(0);
    expect(s.graph.countWrites('upsertConcepts')).toBe(0);
  });

  it('in draftQuestions: PROVIDER_UNAVAILABLE naming draftQuestions, and no puzzle or question written', async () => {
    const s = setup();
    s.chat.reset();
    scriptCurator(s.chat);
    s.chat.enqueue(CURATOR_LABELS.draft, new Error('provider down'));
    await expect(s.run()).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      node: 'draftQuestions',
    });
    expect(s.graph.stepsOf(TASK).at(-1)).toMatchObject({ node: 'draftQuestions', status: 'error' });
    expect(s.graph.count('Puzzle')).toBe(0);
    expect(s.graph.count('Question')).toBe(0);
    // The steps before it are complete and the task knows where to go on.
    expect((await s.graph.loadTask(TASK))!.lastCompletedStep).toBe('linkPrerequisites');
  });

  it('keeps what a failed attempt spent in its own step, and the total equals the sum of the steps', async () => {
    const s = setup();
    s.chat.reset();
    scriptCurator(s.chat);
    s.chat.enqueue(CURATOR_LABELS.draft, new Error('provider down'));
    await s.run().catch(() => undefined);
    const task = (await s.graph.loadTask(TASK))!;
    const failed = task.steps.find((x) => x.status === 'error')!;
    expect(failed.usage.modelCalls).toBeGreaterThan(0);
    expect(task.usage.modelCalls).toBe(task.steps.reduce((n, x) => n + x.usage.modelCalls, 0));
  });
});

describe('output that does not match the schema', () => {
  it('is asked for again MAX_OUTPUT_RETRIES times, then fails INVALID_MODEL_OUTPUT and stores nothing from the step', async () => {
    const s = setup();
    s.chat.reset();
    scriptCurator(s.chat, { drafts: 'schema-invalid' });
    // One chunk is enough to count the attempts of one structured call.
    const result = await s.run().catch((e: unknown) => e);
    expect(result).toMatchObject({ code: 'INVALID_MODEL_OUTPUT', node: 'draftQuestions' });
    const attemptsPerChunk = 1 + MAX_OUTPUT_RETRIES;
    expect(s.chat.callCount(CURATOR_LABELS.draft) % attemptsPerChunk).toBe(0);
    expect(s.chat.callCount(CURATOR_LABELS.draft)).toBeGreaterThanOrEqual(attemptsPerChunk);
    expect(s.graph.count('Question')).toBe(0);
    expect(s.graph.count('Puzzle')).toBe(0);
    expect(s.graph.stepsOf(TASK).at(-1)).toMatchObject({ node: 'draftQuestions', status: 'error' });
  });
});

describe('every step can be the last one before a restart (SC-U05)', () => {
  describe.each(NODES)('stopped after %s completed', (node) => {
    it('starts again at resolveEntry and ends with the counts of an uninterrupted run', async () => {
      const reference = setup();
      await reference.run();

      // The "kill": the requester check fails as soon as `node` is complete, so no later step starts.
      let alive = true;
      let armed = true;
      const s = setup({ isActive: async () => alive });
      const complete = s.graph.complete.bind(s.graph);
      s.graph.complete = async (handle, log, usage) => {
        await complete(handle, log, usage);
        if (armed && handle.node === node) {
          armed = false;
          alive = false;
        }
      };
      const first = await s.run().catch((e: unknown) => e);
      if (node !== 'validate') expect(first).toMatchObject({ code: 'ACCOUNT_BLOCKED' });

      // A fresh process: nothing in memory; the stored task says where to go on.
      alive = true;
      const task = (await s.graph.loadTask(TASK))!;
      expect(task.lastCompletedStep).toBe(node);
      const entry = resolveEntry(task.lastCompletedStep);
      if (entry !== 'finalise' && entry !== 'none') await s.run(entry);

      expect(shape(s.graph)).toEqual(shape(reference.graph));
      expect(s.graph.tasks.get(TASK)!.lastCompletedStep).toBe('validate');
      expect(s.graph.stepsOf(TASK).map((x) => x.node)).toEqual(NODES);
      const ids = s.graph.stepsOf(TASK).map((x) => x.stepId);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});

describe('re-entry after validate wrote the drafts', () => {
  it('at draftQuestions makes zero model calls and adds nothing', async () => {
    const s = setup();
    await s.run();
    const before = shape(s.graph);
    const calls = s.chat.callCount();
    const embedCalls = s.embeddings.calls.length;
    const again = await s.run('draftQuestions');
    expect(again.outcome).toBe('awaiting_review');
    expect(s.chat.callCount()).toBe(calls);
    expect(s.embeddings.calls.length).toBe(embedCalls);
    expect(shape(s.graph)).toEqual(before);
  });
});
