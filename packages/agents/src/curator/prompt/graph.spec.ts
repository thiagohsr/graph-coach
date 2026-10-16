import { describe, expect, it } from 'vitest';
import { RecordingUsageTracer } from '../../llm/recording-usage-tracer';
import { StubChatProvider, StubEmbeddingsProvider } from '../../llm/stub';
import { generatedQuestionId } from '../ids';
import { resolvePromptEntry, type PromptNode } from '../steps';
import { FakeCuratorGraph, makeDeps } from '../testing/fake-graph-port';
import { PROMPT_LABELS, scriptPrompt, type PromptVerdict } from '../testing/fixtures';
import { runPromptCreation } from './graph';

const OWNER = 'owner-1';
const SOURCE = 'prompt-source-1';
const TASK = 'task-1';
const BRIEF = {
  subject: 'Library cataloguing',
  focus: 'call numbers and accession',
  difficulty: 'easy',
  sentences: 4,
} as const;

const NODES = ['outline', 'draftQuestions', 'critique', 'refine', 'validate'];

function setup(
  options: {
    firstVerdicts?: Record<number, PromptVerdict>;
    secondVerdicts?: Record<number, PromptVerdict>;
    sentences?: number;
    minQuestions?: number;
    isActive?: (id: string) => Promise<boolean>;
  } = {},
) {
  const tracer = new RecordingUsageTracer();
  const graph = new FakeCuratorGraph();
  const chat = new StubChatProvider({ tracer });
  const embeddings = new StubEmbeddingsProvider(16, { tracer });
  graph.addPromptSource({
    id: SOURCE,
    ownerId: OWNER,
    brief: { ...BRIEF, sentences: options.sentences ?? BRIEF.sentences },
  });
  graph.addTask({ id: TASK, sourceId: SOURCE, requesterId: OWNER, kind: 'generate' });
  scriptPrompt(chat, {
    ...(options.firstVerdicts ? { firstVerdicts: options.firstVerdicts } : {}),
    ...(options.secondVerdicts ? { secondVerdicts: options.secondVerdicts } : {}),
  });
  const deps = makeDeps({
    graph,
    chat,
    embeddings,
    tracer,
    ...(options.isActive ? { isActive: options.isActive } : {}),
  });
  const run = (entry: PromptNode = 'outline', over: Partial<typeof deps> = {}) =>
    runPromptCreation(
      { ...deps, ...over },
      {
        taskId: TASK,
        sourceId: SOURCE,
        ownerId: OWNER,
        entry,
        minQuestions: options.minQuestions ?? 3,
      },
    );
  return { graph, chat, embeddings, tracer, deps, run };
}

const shape = (g: FakeCuratorGraph) => ({
  sources: g.count('Source'),
  concepts: g.count('Concept'),
  puzzles: g.count('Puzzle'),
  questions: g.count('Question'),
  steps: g.count('Step'),
  mentions: g.mentions.size,
  prerequisites: g.prerequisites.size,
  produced: g.produced.size,
});

describe('runPromptCreation', () => {
  it('runs the five steps to awaiting_review with three separate agents', async () => {
    const s = setup();
    const result = await s.run();

    expect(result.outcome).toBe('awaiting_review');
    expect(s.graph.stepsOf(TASK).map((x) => x.node)).toEqual(NODES);
    expect(s.graph.stepsOf(TASK).every((x) => x.status === 'complete')).toBe(true);
    expect(s.graph.tasks.get(TASK)!.lastCompletedStep).toBe('validate');

    // SC-U09: planner, writer, and critic are three calls with three labels and three different system messages.
    expect(s.chat.calls.map((c) => c.label)).toEqual([
      PROMPT_LABELS.outline,
      PROMPT_LABELS.write,
      PROMPT_LABELS.critique,
    ]);
    const systems = s.chat.calls.map((c) => c.messages[0]!.content);
    expect(new Set(systems).size).toBe(3);
    expect(s.embeddings.calls).toHaveLength(0);

    // At most brief.sentences drafts, each with the brief as its source, tests, and a passing critique.
    expect(s.graph.count('Puzzle')).toBe(1);
    const puzzle = [...s.graph.puzzles.values()][0]!;
    expect(puzzle).toMatchObject({ origin: 'prompt', status: 'draft', sourceId: SOURCE });
    const questions = [...s.graph.questions.values()];
    // Six were planned (4 + 2): the two over the limit are counted, not stored.
    expect(s.graph.stepsOf(TASK).find((x) => x.node === 'validate')!.log).toBe(
      '4 drafts kept, 2 discarded (over_limit 2)',
    );
    expect(questions).toHaveLength(BRIEF.sentences);
    for (const q of questions) {
      expect(q.generatedFrom).toBe(SOURCE);
      expect(q.chunkId).toBe('');
      expect(q.concepts.length).toBeGreaterThan(0);
      expect(q.critique).toMatchObject({ verdict: 'pass', rewritten: false });
      expect(q.id).toBe(generatedQuestionId(SOURCE, q.sentence, q.answers));
    }
    expect(s.graph.chunks.size).toBe(0);
    expect(s.graph.mentions.size).toBe(0);
    // Concepts by slug, and the planner's one prerequisite pair was written.
    expect([...s.graph.concepts.keys()].sort()).toEqual(['accession-register', 'call-numbers']);
    expect([...s.graph.prerequisites.keys()]).toEqual(['call-numbers>accession-register']);
  });

  it('still records a refine step, completed with "Nothing to rewrite", when the critic passes everything (J16)', async () => {
    const s = setup();
    await s.run();
    const refine = s.graph.stepsOf(TASK).find((x) => x.node === 'refine')!;
    expect(refine).toMatchObject({ status: 'complete', log: 'Nothing to rewrite' });
    expect(refine.usage.modelCalls).toBe(0);
    expect(s.chat.callCount(PROMPT_LABELS.rewrite)).toBe(0);
    expect(s.chat.callCount(PROMPT_LABELS.recritique)).toBe(0);
  });

  it('rewrites once: a draft judged rewrite then pass is stored as rewritten, rewrite then not-pass is absent', async () => {
    const s = setup({
      firstVerdicts: { 1: 'rewrite', 2: 'rewrite' },
      secondVerdicts: { 2: 'reject' },
    });
    const result = await s.run();
    expect(result.outcome).toBe('awaiting_review');
    const questions = [...s.graph.questions.values()];
    const rewritten = questions.filter((q) => q.critique?.rewritten);
    expect(rewritten).toHaveLength(1);
    expect(questions).toHaveLength(BRIEF.sentences);
    expect(s.chat.callCount(PROMPT_LABELS.rewrite)).toBe(1);
    expect(s.chat.callCount(PROMPT_LABELS.recritique)).toBe(1);
    // Draft index 2 was dropped: nothing stored has its fact.
    const planned = s.graph.sources.get(SOURCE)!.outline!.sentences;
    const droppedFact = planned[2]!.fact;
    expect(
      questions.some(
        (q) =>
          q.sentence.replace('___', '') ===
          droppedFact.replace(/\bcall number\b|\baccession register\b/i, ''),
      ),
    ).toBe(false);
  });

  it('keeps the usage as the stubs return it: refine is zero without a rewrite and two calls with one; totals are sums', async () => {
    const plain = setup();
    await plain.run();
    const planSteps = (await plain.graph.loadTask(TASK))!;
    expect(planSteps.steps.find((x) => x.node === 'refine')!.usage.modelCalls).toBe(0);
    expect(planSteps.steps.find((x) => x.node === 'validate')!.usage.modelCalls).toBe(0);
    expect(planSteps.usage.modelCalls).toBe(3);
    expect(planSteps.usage).toEqual(plain.tracer.totalUsage(TASK));

    const rewriting = setup({ firstVerdicts: { 0: 'rewrite' } });
    await rewriting.run();
    const task = (await rewriting.graph.loadTask(TASK))!;
    expect(task.steps.find((x) => x.node === 'refine')!.usage.modelCalls).toBe(2);
    expect(task.usage.modelCalls).toBe(5);
    expect(task.usage.modelCalls).toBe(task.steps.reduce((n, x) => n + x.usage.modelCalls, 0));
    expect(task.usage).toEqual(rewriting.tracer.totalUsage(TASK));
    expect(rewriting.embeddings.calls).toHaveLength(0);
  });

  it('ends nothing_usable, with no puzzle and no question, when fewer drafts survive than minQuestions', async () => {
    const s = setup({
      firstVerdicts: { 0: 'reject', 1: 'reject', 2: 'reject', 3: 'reject', 4: 'reject' },
    });
    const result = await s.run();
    expect(result.outcome).toBe('nothing_usable');
    expect(s.graph.count('Puzzle')).toBe(0);
    expect(s.graph.count('Question')).toBe(0);
    expect(s.graph.stepsOf(TASK).map((x) => x.node)).toEqual(NODES);
    expect(s.graph.countWrites('createGeneratedQuestions')).toBe(0);
  });

  it('is idempotent: a second run of the whole graph changes nothing but model calls', async () => {
    const s = setup();
    await s.run();
    const before = shape(s.graph);
    const second = await s.run();
    expect(second.outcome).toBe('awaiting_review');
    expect(shape(s.graph)).toEqual(before);
  });

  it('re-entry at draftQuestions after validate wrote the drafts makes zero model calls and adds nothing', async () => {
    const s = setup();
    await s.run();
    const before = shape(s.graph);
    const calls = s.chat.callCount();
    const again = await s.run('draftQuestions');
    expect(again.outcome).toBe('awaiting_review');
    expect(s.chat.callCount()).toBe(calls);
    expect(shape(s.graph)).toEqual(before);
    expect(again.counts.kept).toBe(BRIEF.sentences);
  });

  describe.each(NODES)('interrupted after %s completed', (node) => {
    it('restarts at resolvePromptEntry and ends with the counts of an uninterrupted run, the planner called once', async () => {
      const reference = setup();
      await reference.run();

      // The "kill": the account check fails as soon as `node` is complete, so nothing after it starts.
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
      if (node !== 'validate') {
        expect(first).toMatchObject({ code: 'ACCOUNT_BLOCKED' });
      }

      // A fresh process: nothing in memory, the stored task and source say where to go on.
      alive = true;
      const task = (await s.graph.loadTask(TASK))!;
      const outline = s.graph.sources.get(SOURCE)!.outline;
      const entry = resolvePromptEntry(task.lastCompletedStep, outline !== null);
      if (entry !== 'finalise' && entry !== 'none') await s.run(entry);

      expect(shape(s.graph)).toEqual(shape(reference.graph));
      expect(s.chat.callCount(PROMPT_LABELS.outline)).toBe(1);
      expect(s.graph.stepsOf(TASK).map((x) => x.node)).toEqual(NODES);
      const ids = s.graph.stepsOf(TASK).map((x) => x.stepId);
      expect(new Set(ids).size).toBe(ids.length);
      expect(s.graph.tasks.get(TASK)!.lastCompletedStep).toBe('validate');
      expect(s.embeddings.calls).toHaveLength(0);
    });
  });

  it('stops before refine with ACCOUNT_BLOCKED when the requester is blocked after critique', async () => {
    let alive = true;
    const s = setup({ firstVerdicts: { 0: 'rewrite' }, isActive: async () => alive });
    const complete = s.graph.complete.bind(s.graph);
    s.graph.complete = async (handle, log, usage) => {
      await complete(handle, log, usage);
      if (handle.node === 'critique') alive = false;
    };
    const error = await s.run().catch((e: unknown) => e);
    expect(error).toMatchObject({
      name: 'CuratorStepError',
      code: 'ACCOUNT_BLOCKED',
      node: 'refine',
    });
    expect((error as { toTaskError(): string }).toTaskError()).toBe(
      'refine: ACCOUNT_BLOCKED: account blocked',
    );
    expect(s.graph.stepsOf(TASK).map((x) => x.node)).toEqual([
      'outline',
      'draftQuestions',
      'critique',
    ]);
    expect(s.chat.callCount(PROMPT_LABELS.rewrite)).toBe(0);
    expect(s.graph.count('Puzzle')).toBe(0);
  });

  it('fails the step with INVALID_MODEL_OUTPUT when the critic leaves a draft without a review', async () => {
    const s = setup();
    // The provider asks again with the issues appended (MAX_OUTPUT_RETRIES), then gives up.
    s.chat.enqueue(PROMPT_LABELS.critique, { reviews: [] }, { reviews: [] }, { reviews: [] });
    await expect(s.run()).rejects.toMatchObject({ code: 'INVALID_MODEL_OUTPUT', node: 'critique' });
    expect(s.graph.count('Puzzle')).toBe(0);
    expect(s.graph.stepsOf(TASK).at(-1)).toMatchObject({ node: 'critique', status: 'error' });
  });
});
