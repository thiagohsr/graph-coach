import { describe, expect, it } from 'vitest';
import { RecordingUsageTracer } from '../llm/recording-usage-tracer';
import { StubChatProvider, StubEmbeddingsProvider } from '../llm/stub';
import { runCurator } from './graph';
import { LONG_TEXT, scriptCurator } from './testing/fixtures';
import { FakeCuratorGraph, makeDeps } from './testing/fake-graph-port';

const OWNER = 'owner-1';

function setup(blockAfter: string | null) {
  const tracer = new RecordingUsageTracer();
  const graph = new FakeCuratorGraph();
  const chat = new StubChatProvider({ tracer });
  const embeddings = new StubEmbeddingsProvider(16, { tracer });
  graph.addSource({ id: 's', ownerId: OWNER, content: LONG_TEXT });
  graph.addTask({ id: 't', sourceId: 's', requesterId: OWNER });
  scriptCurator(chat);

  let active = true;
  // Turns the account off as soon as the named step has completed.
  const complete = graph.complete.bind(graph);
  graph.complete = async (handle, log, usage) => {
    await complete(handle, log, usage);
    if (handle.node === blockAfter) active = false;
  };
  const deps = makeDeps({
    graph,
    chat,
    embeddings,
    tracer,
    isActive: async (id) => id === OWNER && active,
  });
  return { graph, chat, embeddings, deps };
}

describe('a blocked requester', () => {
  it('stops the run before the next step: no Step node, no model or embedding call after the block', async () => {
    const s = setup('embed');
    const error = await runCurator(s.deps, {
      taskId: 't',
      kind: 'ingest',
      sourceId: 's',
      ownerId: OWNER,
      entry: 'chunk',
    }).catch((e: unknown) => e);
    expect(error).toMatchObject({
      name: 'CuratorStepError',
      code: 'ACCOUNT_BLOCKED',
      node: 'extractConcepts',
    });
    expect((error as Error).message).toBe('account blocked');
    expect(s.graph.stepsOf('t').map((x) => x.node)).toEqual(['chunk', 'embed']);
    expect(s.chat.callCount()).toBe(0);
    expect(s.embeddings.calls).toHaveLength(1);
    expect(s.graph.count('Concept')).toBe(0);
  });

  it('does not even start the first step', async () => {
    const s = setup(null);
    const deps = { ...s.deps, isActive: async () => false };
    await expect(
      runCurator(deps, {
        taskId: 't',
        kind: 'ingest',
        sourceId: 's',
        ownerId: OWNER,
        entry: 'chunk',
      }),
    ).rejects.toMatchObject({
      code: 'ACCOUNT_BLOCKED',
      node: 'chunk',
    });
    expect(s.graph.count('Step')).toBe(0);
    expect(s.graph.count('Chunk')).toBe(0);
  });

  it('formats the stored error as "<node>: ACCOUNT_BLOCKED: account blocked"', async () => {
    const s = setup('chunk');
    const error = await runCurator(s.deps, {
      taskId: 't',
      kind: 'ingest',
      sourceId: 's',
      ownerId: OWNER,
      entry: 'chunk',
    }).catch((e: unknown) => e);
    expect((error as { toTaskError(): string }).toTaskError()).toBe(
      'embed: ACCOUNT_BLOCKED: account blocked',
    );
  });
});
