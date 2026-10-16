// SC-U07 / Principle VII: source text and prompts never reach a step log, a task error, an event, or the tracer, and the
// model sees passages only between per-call delimiters. Exercised on the happy and failing runs of both graphs.
import { describe, expect, it } from 'vitest';
import { RecordingUsageTracer } from '../llm/recording-usage-tracer';
import { StubChatProvider, StubEmbeddingsProvider, type StubCall } from '../llm/stub';
import { runCurator } from './graph';
import { runPromptCreation } from './prompt/graph';
import { CuratorStepError } from './ports';
import {
  CURATOR_LABELS,
  LONG_TEXT,
  type DraftMode,
  PROMPT_LABELS,
  scriptCurator,
  scriptPrompt,
} from './testing/fixtures';
import { FakeCuratorGraph, makeDeps } from './testing/fake-graph-port';

const OWNER = 'owner-1';
const SOURCE = 'source-1';
const TASK = 'task-1';
const WINDOW = 30;

const BRIEF = {
  subject: 'Cataloguing rules for rare manuscripts and incunabula',
  focus: 'accession registers, shelf marks and provenance notes in a research library',
  difficulty: 'easy',
  sentences: 4,
} as const;

/** The first 30-character window of any haystack that also occurs in the corpus, or null. */
function leak(haystacks: string[], corpus: string[]): string | null {
  for (const text of haystacks) {
    for (let i = 0; i + WINDOW <= text.length; i += 1) {
      const window = text.slice(i, i + WINDOW);
      if (corpus.some((c) => c.includes(window))) return window;
    }
  }
  return null;
}

const messagesOf = (calls: StubCall[]) => calls.flatMap((c) => c.messages.map((m) => m.content));

/** Everything the run stored or sent out, apart from the model requests. */
function outputs(graph: FakeCuratorGraph, tracer: RecordingUsageTracer, error: unknown): string[] {
  return [
    ...[...graph.steps.values()].map((s) => s.log ?? ''),
    ...graph.events.map((e) => e.log ?? ''),
    ...[...graph.tasks.values()].map((t) => t.error ?? ''),
    error instanceof CuratorStepError
      ? error.toTaskError()
      : error instanceof Error
        ? error.message
        : '',
    JSON.stringify(tracer.runs),
    JSON.stringify(tracer.steps),
    JSON.stringify(tracer.calls),
  ];
}

/** Passages and brief fields stripped of their delimited blocks. */
const outsideBlocks = (text: string) =>
  text.replace(/<<<(\w+):(\w+)>>>\n[\s\S]*?\n<<<END:\2>>>/g, '');

function uploadRun(setup: (chat: StubChatProvider) => void, drafts?: DraftMode) {
  const tracer = new RecordingUsageTracer();
  const graph = new FakeCuratorGraph();
  const chat = new StubChatProvider({ tracer });
  const embeddings = new StubEmbeddingsProvider(16, { tracer });
  graph.addSource({ id: SOURCE, ownerId: OWNER, content: LONG_TEXT, title: 'Library notes' });
  graph.addTask({ id: TASK, sourceId: SOURCE, requesterId: OWNER });
  scriptCurator(chat, drafts ? { drafts } : {});
  setup(chat);
  const deps = makeDeps({ graph, chat, embeddings, tracer });
  return {
    graph,
    chat,
    tracer,
    secrets: [LONG_TEXT],
    run: () =>
      runCurator(deps, {
        taskId: TASK,
        kind: 'ingest',
        sourceId: SOURCE,
        ownerId: OWNER,
        entry: 'chunk',
      }),
  };
}

function promptRun(setup: (chat: StubChatProvider) => void) {
  const tracer = new RecordingUsageTracer();
  const graph = new FakeCuratorGraph();
  const chat = new StubChatProvider({ tracer });
  const embeddings = new StubEmbeddingsProvider(16, { tracer });
  graph.addPromptSource({ id: SOURCE, ownerId: OWNER, brief: BRIEF });
  graph.addTask({ id: TASK, sourceId: SOURCE, requesterId: OWNER, kind: 'generate' });
  scriptPrompt(chat);
  setup(chat);
  const deps = makeDeps({ graph, chat, embeddings, tracer });
  return {
    graph,
    chat,
    tracer,
    secrets: [BRIEF.subject, BRIEF.focus],
    run: () =>
      runPromptCreation(deps, {
        taskId: TASK,
        sourceId: SOURCE,
        ownerId: OWNER,
        entry: 'outline',
        minQuestions: 3,
      }),
  };
}

const echo = (call: StubCall) =>
  new Error(`provider echo: ${call.messages.map((m) => m.content).join(' ')}`);

const SCENARIOS: Array<
  [string, () => ReturnType<typeof uploadRun> | ReturnType<typeof promptRun>]
> = [
  ['upload, happy run', () => uploadRun(() => undefined)],
  [
    'upload, nothing usable (every draft breaks a rule)',
    () => uploadRun(() => undefined, 'rule-breaking'),
  ],
  [
    'upload, provider fails and echoes the request',
    () => uploadRun((chat) => chat.enqueue(CURATOR_LABELS.extract, echo)),
  ],
  ['upload, invalid model output', () => uploadRun(() => undefined, 'schema-invalid')],
  ['prompt, happy run', () => promptRun(() => undefined)],
  [
    'prompt, provider fails and echoes the brief',
    () => promptRun((chat) => chat.enqueue(PROMPT_LABELS.outline, echo)),
  ],
  [
    'prompt, critic leaves a draft without a review',
    () =>
      promptRun((chat) =>
        chat.enqueue(PROMPT_LABELS.critique, { reviews: [] }, { reviews: [] }, { reviews: [] }),
      ),
  ],
];

describe.each(SCENARIOS)('redaction: %s', (_name, make) => {
  async function execute() {
    const scenario = make();
    const error = await scenario.run().then(
      () => null,
      (e: unknown) => e,
    );
    return { ...scenario, error };
  }

  it('no step log, task error, event, or tracer argument holds 30 characters of the source or of a prompt', async () => {
    const s = await execute();
    expect(s.chat.calls.length).toBeGreaterThan(0);
    const corpus = [...s.secrets, ...messagesOf(s.chat.calls)];
    expect(leak(outputs(s.graph, s.tracer, s.error), corpus)).toBeNull();
  });

  it('the model sees the source text and the brief only between per-call delimiters', async () => {
    const s = await execute();
    for (const message of messagesOf(s.chat.calls)) {
      expect(leak([outsideBlocks(message)], s.secrets)).toBeNull();
    }
  });
});

describe('the leak detector', () => {
  it('finds a 30-character copy and ignores shorter ones', () => {
    expect(leak([`log: ${LONG_TEXT.slice(10, 45)}`], [LONG_TEXT])).not.toBeNull();
    expect(leak([`log: ${LONG_TEXT.slice(10, 38)}`], [LONG_TEXT])).toBeNull();
    expect(outsideBlocks('a <<<PASSAGE:ab12>>>\nsecret\n<<<END:ab12>>> b')).toBe('a  b');
  });
});

describe('the scenarios exercise what they claim', () => {
  it('the failing runs end with the expected codes and the echoing providers had text to leak', async () => {
    const provider = uploadRun((chat) => chat.enqueue(CURATOR_LABELS.extract, echo));
    const error = await provider.run().catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'PROVIDER_UNAVAILABLE', node: 'extractConcepts' });
    expect((error as CuratorStepError).toTaskError()).toBe(
      'extractConcepts: PROVIDER_UNAVAILABLE: The model provider could not answer',
    );

    const invalid = uploadRun(() => undefined, 'schema-invalid');
    expect(await invalid.run().catch((e: unknown) => e)).toMatchObject({
      code: 'INVALID_MODEL_OUTPUT',
    });

    const prompt = promptRun((chat) => chat.enqueue(PROMPT_LABELS.outline, echo));
    expect(await prompt.run().catch((e: unknown) => e)).toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      node: 'outline',
    });
    expect(messagesOf(prompt.chat.calls).join('')).toContain(BRIEF.focus);
  });
});
