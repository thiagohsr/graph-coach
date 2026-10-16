// FR-U38: the usage a step records is what its model calls returned (the stubs' deterministic usage), task totals are sums
// of step usage, a resume or retry never counts a step twice, and tracing never changes usage or delays a run.
import { describe, expect, it } from 'vitest';
import { RecordingUsageTracer } from '../llm/recording-usage-tracer';
import { StubChatProvider, StubEmbeddingsProvider, stubTokens, type StubCall } from '../llm/stub';
import { ZERO_USAGE, sumUsage, type Usage } from '../llm/usage';
import type { UsageTracer } from '../llm/usage-tracer';
import { runCurator } from './graph';
import { runPromptCreation } from './prompt/graph';
import {
  resolveEntry,
  resolvePromptEntry,
  type CuratorNode,
  type PromptNode,
  type StepName,
} from './steps';
import {
  CURATOR_LABELS,
  LONG_TEXT,
  PROMPT_LABELS,
  chainLinksFor,
  critiquesFor,
  draftsFor,
  extractedConceptsFor,
  outlineFor,
  promptDraftsFor,
  scriptCurator,
  scriptPrompt,
  type PromptVerdict,
} from './testing/fixtures';
import { FakeCuratorGraph, makeDeps } from './testing/fake-graph-port';

const OWNER = 'owner-1';
const SOURCE = 'source-1';
const TASK = 'task-1';
const BRIEF = {
  subject: 'Library cataloguing',
  focus: 'call numbers and accession',
  difficulty: 'easy',
  sentences: 4,
} as const;

const UPLOAD_NODES: StepName[] = [
  'chunk',
  'embed',
  'extractConcepts',
  'linkPrerequisites',
  'draftQuestions',
  'validate',
];
const PROMPT_NODES: StepName[] = ['outline', 'draftQuestions', 'critique', 'refine', 'validate'];

function build(
  kind: 'upload' | 'prompt',
  options: {
    tracer?: UsageTracer;
    verdicts?: Record<number, PromptVerdict>;
    isActive?: (id: string) => Promise<boolean>;
  } = {},
) {
  const recorder = new RecordingUsageTracer();
  const tracer = options.tracer ?? recorder;
  const graph = new FakeCuratorGraph();
  const chat = new StubChatProvider({ tracer });
  const embeddings = new StubEmbeddingsProvider(16, { tracer });
  if (kind === 'upload') {
    graph.addSource({ id: SOURCE, ownerId: OWNER, content: LONG_TEXT, title: 'Library notes' });
    graph.addTask({ id: TASK, sourceId: SOURCE, requesterId: OWNER });
    scriptCurator(chat);
  } else {
    graph.addPromptSource({ id: SOURCE, ownerId: OWNER, brief: BRIEF });
    graph.addTask({ id: TASK, sourceId: SOURCE, requesterId: OWNER, kind: 'generate' });
    scriptPrompt(chat, options.verdicts ? { firstVerdicts: options.verdicts } : {});
  }
  const deps = makeDeps({
    graph,
    chat,
    embeddings,
    tracer: tracer as RecordingUsageTracer,
    ...(options.isActive ? { isActive: options.isActive } : {}),
  });
  const runUpload = (entry: CuratorNode = 'chunk', over: Partial<typeof deps> = {}) =>
    runCurator(
      { ...deps, ...over },
      { taskId: TASK, kind: 'ingest', sourceId: SOURCE, ownerId: OWNER, entry },
    );
  const runPrompt = (entry: PromptNode = 'outline') =>
    runPromptCreation(deps, {
      taskId: TASK,
      sourceId: SOURCE,
      ownerId: OWNER,
      entry,
      minQuestions: 3,
    });
  const run = (entry?: CuratorNode | PromptNode) =>
    kind === 'upload'
      ? runUpload(entry as CuratorNode | undefined)
      : runPrompt(entry as PromptNode | undefined);
  return { graph, chat, embeddings, recorder, deps, run };
}

/** What the stub returned for one chat call, recomputed from the request alone (the fixtures are pure functions of it). */
function chatUsage(
  call: StubCall,
  verdicts: Record<number, PromptVerdict> = {},
): { node: StepName; usage: Usage } {
  const input = stubTokens(call.messages.map((m) => m.content).join('\n'));
  const answer = (value: unknown, node: StepName) => ({
    node,
    usage: {
      modelCalls: 1,
      inputTokens: input,
      outputTokens: stubTokens(JSON.stringify(value)),
      embeddingTokens: 0,
    },
  });
  switch (call.label) {
    case CURATOR_LABELS.extract:
      return answer(extractedConceptsFor(call), 'extractConcepts');
    case CURATOR_LABELS.link:
      return answer(chainLinksFor(call), 'linkPrerequisites');
    case CURATOR_LABELS.draft:
      return answer(draftsFor(call), 'draftQuestions');
    case PROMPT_LABELS.outline:
      return answer(outlineFor(call), 'outline');
    case PROMPT_LABELS.write:
      return answer(promptDraftsFor(call), 'draftQuestions');
    case PROMPT_LABELS.critique:
      return answer(critiquesFor(call, verdicts), 'critique');
    case PROMPT_LABELS.rewrite:
      return answer(promptDraftsFor(call), 'refine');
    case PROMPT_LABELS.recritique:
      return answer(critiquesFor(call), 'refine');
    default:
      throw new Error(`Unexpected label ${String(call.label)}`);
  }
}

/** Expected usage per node, from the requests the stubs received. */
function expectedByNode(
  s: ReturnType<typeof build>,
  verdicts: Record<number, PromptVerdict> = {},
): Record<string, Usage> {
  const out: Record<string, Usage> = {};
  const add = (node: string, usage: Usage) =>
    (out[node] = sumUsage([out[node] ?? ZERO_USAGE, usage]));
  for (const call of s.chat.calls) {
    const { node, usage } = chatUsage(call, verdicts);
    add(node, usage);
  }
  for (const call of s.embeddings.calls) {
    const embeddingTokens = call.texts.reduce((n, t) => n + stubTokens(t), 0);
    add('embed', { modelCalls: 1, inputTokens: 0, outputTokens: 0, embeddingTokens });
  }
  return out;
}

const stepUsages = (graph: FakeCuratorGraph) =>
  Object.fromEntries(
    graph
      .stepsOf(TASK)
      .filter((x) => x.status === 'complete')
      .map((x) => [x.node, x.usage]),
  );

describe('step usage equals what the calls returned', () => {
  it('upload run: each step, the zero steps, embed with embedding tokens only, and the task total', async () => {
    const s = build('upload');
    await s.run();
    const expected = expectedByNode(s);
    const steps = s.graph.stepsOf(TASK);
    expect(steps.map((x) => x.node)).toEqual(UPLOAD_NODES);
    for (const step of steps) expect(step.usage).toEqual(expected[step.node] ?? ZERO_USAGE);
    expect(stepUsages(s.graph).chunk).toEqual(ZERO_USAGE);
    expect(stepUsages(s.graph).validate).toEqual(ZERO_USAGE);
    const embed = stepUsages(s.graph).embed!;
    expect(embed).toMatchObject({ inputTokens: 0, outputTokens: 0 });
    expect(embed.embeddingTokens).toBeGreaterThan(0);
    const task = (await s.graph.loadTask(TASK))!;
    expect(task.usage).toEqual(sumUsage(steps.map((x) => x.usage)));
    expect(task.usage).toEqual(sumUsage(Object.values(expected)));
  });

  it('prompt run with one rewrite pass: refine holds the rewrite and the second critique; nothing else is added', async () => {
    const verdicts = { 0: 'rewrite' } as const;
    const s = build('prompt', { verdicts });
    await s.run();
    const expected = expectedByNode(s, verdicts);
    const steps = s.graph.stepsOf(TASK);
    expect(steps.map((x) => x.node)).toEqual(PROMPT_NODES);
    for (const step of steps) expect(step.usage).toEqual(expected[step.node] ?? ZERO_USAGE);
    expect(stepUsages(s.graph).refine!.modelCalls).toBe(2);
    expect(stepUsages(s.graph).validate).toEqual(ZERO_USAGE);
    const task = (await s.graph.loadTask(TASK))!;
    expect(task.usage).toEqual(sumUsage(steps.map((x) => x.usage)));
    expect(task.usage.embeddingTokens).toBe(0);
  });

  it('a refine with nothing to rewrite is zero', async () => {
    const s = build('prompt');
    await s.run();
    expect(stepUsages(s.graph).refine).toEqual(ZERO_USAGE);
    expect(s.chat.callCount(PROMPT_LABELS.rewrite)).toBe(0);
  });
});

describe.each([
  ['upload', UPLOAD_NODES],
  ['prompt', PROMPT_NODES],
] as const)('resume (%s)', (kind, nodes) => {
  describe.each(nodes)('interrupted after %s', (node) => {
    it('the task total is still the sum of its steps and no step is counted twice', async () => {
      const verdicts = kind === 'prompt' ? ({ 0: 'rewrite' } as const) : undefined;
      const reference = build(kind, verdicts ? { verdicts } : {});
      await reference.run();

      let alive = true;
      let armed = true;
      const s = build(kind, { isActive: async () => alive, ...(verdicts ? { verdicts } : {}) });
      const complete = s.graph.complete.bind(s.graph);
      s.graph.complete = async (handle, log, usage) => {
        await complete(handle, log, usage);
        if (armed && handle.node === node) {
          armed = false;
          alive = false;
        }
      };
      await s.run().catch(() => undefined);

      alive = true;
      const task = (await s.graph.loadTask(TASK))!;
      if (kind === 'upload') {
        const entry = resolveEntry(task.lastCompletedStep);
        if (entry !== 'finalise' && entry !== 'none') await s.run(entry);
      } else {
        const entry = resolvePromptEntry(
          task.lastCompletedStep,
          s.graph.sources.get(SOURCE)!.outline !== null,
        );
        if (entry !== 'finalise' && entry !== 'none') await s.run(entry);
      }

      const after = (await s.graph.loadTask(TASK))!;
      expect(after.usage).toEqual(sumUsage(after.steps.map((x) => x.usage)));
      const ids = after.steps.map((x) => x.stepId);
      expect(new Set(ids).size).toBe(ids.length);
      // Deterministic stubs: every step costs what it cost in the uninterrupted run.
      expect(stepUsages(s.graph)).toEqual(stepUsages(reference.graph));
      expect(after.usage).toEqual((await reference.graph.loadTask(TASK))!.usage);
    });
  });
});

describe('failure and retry', () => {
  it('the failed attempt keeps its usage, the new attempt adds its own, and the total is the sum of both', async () => {
    const s = build('upload');
    s.chat.enqueue(CURATOR_LABELS.extract, new Error('provider down'));
    await expect(s.run()).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      node: 'extractConcepts',
    });

    const failed = s.graph.stepsOf(TASK).find((x) => x.status === 'error')!;
    expect(failed.node).toBe('extractConcepts');
    // The chunks are asked concurrently: the first request failed (its input counted, no output), the others answered.
    const [firstCall, ...others] = s.chat.calls;
    const failedCall: Usage = {
      modelCalls: 1,
      inputTokens: stubTokens(firstCall!.messages.map((m) => m.content).join('\n')),
      outputTokens: 0,
      embeddingTokens: 0,
    };
    // The step stores the usage of the calls that had returned or failed when it failed; a request still in flight at that
    // moment is not in it (a documented limit of the step's meter).
    expect(failed.usage.modelCalls).toBeGreaterThanOrEqual(1);
    expect(failed.usage.modelCalls).toBeLessThanOrEqual(1 + others.length);
    expect(failed.usage.inputTokens).toBeGreaterThanOrEqual(failedCall.inputTokens);
    expect(failed.usage.embeddingTokens).toBe(0);
    const candidates = others.map((c) => chatUsage(c).usage);
    const answered = failed.usage.modelCalls - 1;
    expect(failed.usage.outputTokens).toBeGreaterThanOrEqual(0);
    expect(candidates.length).toBeGreaterThanOrEqual(answered);

    const task = (await s.graph.loadTask(TASK))!;
    await s.run(resolveEntry(task.lastCompletedStep) as CuratorNode);
    const steps = s.graph.stepsOf(TASK);
    const attempts = steps.filter((x) => x.node === 'extractConcepts');
    expect(attempts.map((x) => x.status)).toEqual(['error', 'complete']);
    expect(attempts[0]!.usage).toEqual(failed.usage);
    expect(attempts[1]!.usage.modelCalls).toBeGreaterThan(0);
    const after = (await s.graph.loadTask(TASK))!;
    expect(after.usage).toEqual(sumUsage(steps.map((x) => x.usage)));
    // What the tracer saw covers every call, including the one that was still in flight when the first attempt failed.
    expect(s.recorder.totalUsage(TASK).modelCalls).toBeGreaterThanOrEqual(after.usage.modelCalls);
  });
});

describe('what the tracer receives', () => {
  it('one startStep and endStep per executed step, one recordCall per model call under the step handle, no content', async () => {
    const s = build('upload');
    await s.run();
    const { steps, calls, runs } = s.recorder;
    expect(runs).toEqual([]); // the runs are opened by the API's orchestrator, never by the pipeline
    expect(steps.map((x) => x.node)).toEqual(UPLOAD_NODES);
    expect(steps.every((x) => x.ended && x.ok === true && x.runId === TASK)).toBe(true);

    // Exactly the model calls: the pipeline itself records none.
    expect(calls).toHaveLength(s.chat.calls.length + s.embeddings.calls.length);
    const expected = expectedByNode(s);
    for (const node of UPLOAD_NODES) {
      const sum = sumUsage(s.recorder.callsFor(node).map((c) => c.usage));
      expect(sum).toEqual(expected[node] ?? ZERO_USAGE);
    }
    expect(s.recorder.callsFor('chunk')).toHaveLength(0);
    expect(s.recorder.callsFor('validate')).toHaveLength(0);

    // Nothing but counts, names of call sites, and model identifiers.
    const seen = JSON.stringify({ runs, steps, calls });
    const concepts = [...s.graph.concepts.values()];
    expect(concepts.length).toBeGreaterThan(0);
    for (const concept of concepts) {
      expect(seen).not.toContain(concept.name);
      expect(seen).not.toContain(concept.description);
    }
    for (let i = 0; i + 30 <= LONG_TEXT.length; i += 7)
      expect(seen).not.toContain(LONG_TEXT.slice(i, i + 30));
    for (const call of s.chat.calls) {
      for (const message of call.messages) expect(seen).not.toContain(message.content.slice(0, 40));
    }
    expect(seen).not.toContain('@');
    for (const entry of calls) {
      expect(Object.keys(entry.call).sort()).toEqual(
        ['durationMs', 'label', 'model', 'ok', 'provider', 'usage', 'usageReported'].sort(),
      );
    }
  });

  it('a prompt run is traced the same way, with a brief that never appears', async () => {
    const s = build('prompt', { verdicts: { 0: 'rewrite' } });
    await s.run();
    expect(s.recorder.steps.map((x) => x.node)).toEqual(PROMPT_NODES);
    expect(s.recorder.calls).toHaveLength(s.chat.calls.length);
    const seen = JSON.stringify(s.recorder.calls);
    expect(seen).not.toContain(BRIEF.subject);
    expect(seen).not.toContain(BRIEF.focus);
    expect(s.recorder.callsFor('refine')).toHaveLength(2);
  });
});

function brokenTracer(mode: 'throw' | 'hang'): UsageTracer {
  const fail = (): never => {
    throw new Error('tracer down');
  };
  const hang = (): never => new Promise(() => undefined) as never;
  const act = mode === 'throw' ? fail : hang;
  return {
    enabled: true,
    startRun: act,
    startStep: act,
    recordCall: act,
    endStep: act,
    endRun: act,
    flush: async () => act(),
  };
}

describe('a tracer that fails', () => {
  it.each(['throw', 'hang'] as const)(
    'a tracer that %ss changes neither the stored usage nor the duration',
    async (mode) => {
      const reference = build('upload');
      const started = Date.now();
      await reference.run();
      const referenceMs = Date.now() - started;

      const s = build('upload', { tracer: brokenTracer(mode) });
      const begin = Date.now();
      const result = await s.run();
      const elapsed = Date.now() - begin;

      expect(result.outcome).toBe('awaiting_review');
      expect(stepUsages(s.graph)).toEqual(stepUsages(reference.graph));
      expect((await s.graph.loadTask(TASK))!.usage).toEqual(
        (await reference.graph.loadTask(TASK))!.usage,
      );
      expect(elapsed).toBeLessThan(referenceMs + 1000);
    },
  );
});
