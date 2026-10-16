import { describe, expect, it } from 'vitest';
import { StubChatProvider, StubEmbeddingsProvider } from '../../../llm/stub';
import { puzzleIdForSource } from '../../ids';
import { FakeCuratorGraph, makeDeps } from '../../testing/fake-graph-port';
import { PROMPT_LABELS, outlineFor, scriptPrompt } from '../../testing/fixtures';
import type { Outline } from '../schemas';
import { EMPTY_PROMPT_COUNTS, type PromptDraft, type PromptStateType } from '../state';
import { critiqueNode } from './critique';
import { draftQuestionsNode } from './draft-questions';
import { outlineNode } from './outline';
import { refineNode } from './refine';
import { validateNode } from './validate';

const OWNER = 'owner-1';
const SOURCE = 'source-1';
const TASK = 'task-1';
const BRIEF = { subject: 'Library cataloguing', difficulty: 'easy', sentences: 3 } as const;

function setup(
  brief: typeof BRIEF | { subject: string; difficulty: 'easy'; sentences: number } = BRIEF,
) {
  const graph = new FakeCuratorGraph();
  const chat = new StubChatProvider();
  const embeddings = new StubEmbeddingsProvider(16);
  graph.addPromptSource({ id: SOURCE, ownerId: OWNER, brief });
  graph.addTask({ id: TASK, sourceId: SOURCE, requesterId: OWNER, kind: 'generate' });
  scriptPrompt(chat);
  const deps = makeDeps({ graph, chat, embeddings });
  const state = (patch: Partial<PromptStateType> = {}): PromptStateType => ({
    taskId: TASK,
    sourceId: SOURCE,
    ownerId: OWNER,
    entry: 'outline',
    minQuestions: 2,
    drafts: [],
    kept: [],
    round: 0,
    requested: 0,
    tried: [],
    settled: false,
    lastAdded: 0,
    counts: { ...EMPTY_PROMPT_COUNTS, discarded: {} },
    outcome: null,
    ...patch,
  });
  return { graph, chat, embeddings, deps, state };
}

const draft = (index: number, patch: Partial<PromptDraft> = {}): PromptDraft => ({
  index,
  sentence: `Library number ${index} keeps the ___ in a tidy order for readers.`,
  answers: ['shelves'],
  distractors: ['trolleys', 'catalogues'],
  conceptSlug: 'call-numbers',
  verdict: 'pass',
  note: 'Fine.',
  rewritten: false,
  ...patch,
});

/** Runs outline so that the source holds an outline. */
async function withOutline(s: ReturnType<typeof setup>) {
  await outlineNode(s.deps)(s.state());
}

describe('outline', () => {
  it('makes one planner call, plans brief.sentences + 2 sentences, upserts concepts by slug, and stores the outline', async () => {
    const s = setup();
    const result = await outlineNode(s.deps)(s.state());
    expect(s.chat.calls.map((c) => c.label)).toEqual([PROMPT_LABELS.outline]);
    expect(s.chat.calls[0]!.messages[1]!.content).toContain('Plan exactly 5 sentences.');
    expect([...s.graph.concepts.keys()].sort()).toEqual(['accession-register', 'call-numbers']);
    expect(s.graph.mentions.size).toBe(0);
    expect(s.graph.sources.get(SOURCE)!.outline!.sentences).toHaveLength(5);
    expect(result.counts).toMatchObject({ concepts: 2, links: 1, planned: 5 });
    const step = s.graph.stepsOf(TASK)[0]!;
    expect(step).toMatchObject({ node: 'outline', status: 'complete' });
    expect(step.usage.modelCalls).toBe(1);
  });

  it('caps the plan at 12 sentences', async () => {
    const s = setup({ subject: 'Library cataloguing', difficulty: 'easy', sentences: 10 });
    await outlineNode(s.deps)(s.state());
    expect(s.chat.calls[0]!.messages[1]!.content).toContain('Plan exactly 12 sentences.');
  });

  it('keeps an existing concept as it is and still links the run to it', async () => {
    const s = setup();
    s.graph.concepts.set('call-numbers', {
      id: 'seeded-id',
      slug: 'call-numbers',
      name: 'Call numbers (seed)',
      description: 'Seeded description.',
    });
    await outlineNode(s.deps)(s.state());
    expect(s.graph.concepts.get('call-numbers')).toMatchObject({
      id: 'seeded-id',
      name: 'Call numbers (seed)',
    });
    expect(s.graph.produced.has(`${TASK}|concept|seeded-id`)).toBe(true);
  });

  it('writes a planner-stated link only above the stricter floor and when it makes no cycle', async () => {
    const s = setup();
    const prerequisites: Outline['prerequisites'] = [
      // 0.65 is above the upload floor (0.6) but below the prompt floor (0.7).
      { prerequisite: 'Call numbers', dependent: 'Accession register', confidence: 0.65 },
    ];
    s.chat.reset();
    s.chat.on(PROMPT_LABELS.outline, (call) => ({ ...outlineFor(call), prerequisites }));
    await outlineNode(s.deps)(s.state());
    expect(s.graph.prerequisites.size).toBe(0);

    const t = setup();
    await t.graph.upsertConcepts(TASK, [
      {
        id: 'a',
        slug: 'accession-register',
        name: 'Accession register',
        description: 'x'.repeat(12),
        chunkIds: [],
      },
      {
        id: 'b',
        slug: 'call-numbers',
        name: 'Call numbers',
        description: 'x'.repeat(12),
        chunkIds: [],
      },
    ]);
    await t.graph.linkPrerequisite('accession-register', 'call-numbers', 0.9);
    // The planner now says the opposite: it would close a cycle and is refused.
    await outlineNode(t.deps)(t.state());
    expect([...t.graph.prerequisites.keys()]).toEqual(['accession-register>call-numbers']);
    expect(t.graph.stepsOf(TASK)[0]!.log).toContain('0 linked, 1 refused');
  });

  it('drops planned sentences whose concept is not in the planner list and prerequisites between unknown names', async () => {
    const s = setup();
    s.chat.reset();
    s.chat.on(PROMPT_LABELS.outline, (call) => {
      const base = outlineFor(call);
      return {
        ...base,
        sentences: [
          ...base.sentences.slice(0, 4),
          { fact: 'A stray fact about something the planner never listed.', concept: 'Unlisted' },
        ],
        prerequisites: [{ prerequisite: 'Call numbers', dependent: 'Unlisted', confidence: 0.9 }],
      };
    });
    await outlineNode(s.deps)(s.state());
    const stored = s.graph.sources.get(SOURCE)!.outline!;
    expect(stored.sentences).toHaveLength(4);
    expect(stored.sentences.every((x) => x.concept !== 'Unlisted')).toBe(true);
    expect(stored.prerequisites).toEqual([]);
    expect(s.graph.prerequisites.size).toBe(0);
  });
});

describe('draftQuestions (writer)', () => {
  it('makes one call labelled curator.prompt.write from the stored outline and writes nothing', async () => {
    const s = setup();
    await withOutline(s);
    const writes = s.graph.writeLog.length;
    const result = await draftQuestionsNode(s.deps)(s.state());
    expect(s.chat.callCount(PROMPT_LABELS.write)).toBe(1);
    expect(result.drafts).toHaveLength(5);
    expect(result.drafts!.map((d) => d.index)).toEqual([0, 1, 2, 3, 4]);
    // The only writes since are the step records.
    expect(s.graph.writeLog.slice(writes).every((w) => w === 'addStep' || w === 'updateTask')).toBe(
      true,
    );
    expect(s.graph.count('Question')).toBe(0);
  });

  it('makes no call when the task already produced questions', async () => {
    const s = setup();
    await withOutline(s);
    s.graph.produced.add(`${TASK}|question|q1`);
    const result = await draftQuestionsNode(s.deps)(s.state());
    expect(result.drafts).toEqual([]);
    expect(s.chat.callCount(PROMPT_LABELS.write)).toBe(0);
    expect(s.graph.stepsOf(TASK).at(-1)).toMatchObject({
      status: 'complete',
      log: 'Drafts already stored',
    });
  });

  it('fails with INCONSISTENT_STATE when the outline is missing', async () => {
    const s = setup();
    await expect(draftQuestionsNode(s.deps)(s.state())).rejects.toMatchObject({
      code: 'INCONSISTENT_STATE',
      node: 'draftQuestions',
    });
  });
});

describe('critique', () => {
  async function drafted(s: ReturnType<typeof setup>) {
    await withOutline(s);
    const { drafts } = await draftQuestionsNode(s.deps)(s.state());
    return drafts!.map(({ verdict: _v, note: _n, ...d }) => d);
  }

  it('makes one call for all drafts and drops reject drafts, counting them', async () => {
    const s = setup();
    const drafts = await drafted(s);
    s.chat.reset();
    scriptPrompt(s.chat, { firstVerdicts: { 1: 'reject', 3: 'rewrite' } });
    const result = await critiqueNode(s.deps)(s.state({ drafts }));
    expect(s.chat.callCount(PROMPT_LABELS.critique)).toBe(1);
    expect(result.drafts!.map((d) => [d.index, d.verdict])).toEqual([
      [0, 'pass'],
      [2, 'pass'],
      [3, 'rewrite'],
      [4, 'pass'],
    ]);
    expect(result.counts).toMatchObject({ passed: 3, dropped: 1 });
    expect(s.graph.stepsOf(TASK).at(-1)!.log).toBe(
      '5 reviewed: 3 passed, 1 to rewrite, 1 rejected',
    );
  });

  it('treats a draft without a review as invalid output and fails the step', async () => {
    const s = setup();
    const drafts = await drafted(s);
    s.chat.enqueue(PROMPT_LABELS.critique, ...Array.from({ length: 3 }, () => ({ reviews: [] })));
    await expect(critiqueNode(s.deps)(s.state({ drafts }))).rejects.toMatchObject({
      code: 'INVALID_MODEL_OUTPUT',
      node: 'critique',
    });
    expect(s.chat.callCount(PROMPT_LABELS.critique)).toBe(3);
  });

  it('makes no call when there are no drafts, and still completes the step', async () => {
    const s = setup();
    await withOutline(s);
    await critiqueNode(s.deps)(s.state());
    expect(s.chat.callCount(PROMPT_LABELS.critique)).toBe(0);
    expect(s.graph.stepsOf(TASK).at(-1)).toMatchObject({
      node: 'critique',
      status: 'complete',
      log: 'No drafts to review',
    });
  });
});

describe('refine', () => {
  it('rewrites only the rewrite drafts, has them judged again, and drops those that do not pass', async () => {
    const s = setup();
    await withOutline(s);
    const { drafts } = await draftQuestionsNode(s.deps)(s.state());
    const judged = drafts!.map((d) => ({
      ...d,
      verdict: d.index === 1 || d.index === 2 ? ('rewrite' as const) : ('pass' as const),
      note: 'See the sentence.',
    }));
    s.chat.reset();
    scriptPrompt(s.chat, { secondVerdicts: { 2: 'reject' } });
    const result = await refineNode(s.deps)(s.state({ drafts: judged }));

    expect(s.chat.calls.map((c) => c.label)).toEqual([
      PROMPT_LABELS.rewrite,
      PROMPT_LABELS.recritique,
    ]);
    // The rewrite prompt carried only the two indexes sent back.
    expect(s.chat.calls[0]!.messages[1]!.content.match(/<<<DRAFT:/g)).toHaveLength(2);
    const out = result.drafts!;
    expect(out.map((d) => d.index)).toEqual([0, 1, 3, 4]);
    expect(out.find((d) => d.index === 1)).toMatchObject({ rewritten: true, verdict: 'pass' });
    expect(out.find((d) => d.index === 0)!.rewritten).toBe(false);
    expect(s.graph.stepsOf(TASK).at(-1)!.usage.modelCalls).toBe(2);
  });

  it('with nothing to rewrite makes no call and completes with "Nothing to rewrite"', async () => {
    const s = setup();
    await withOutline(s);
    const result = await refineNode(s.deps)(s.state({ drafts: [draft(0), draft(1)] }));
    expect(s.chat.callCount(PROMPT_LABELS.rewrite)).toBe(0);
    expect(s.chat.callCount(PROMPT_LABELS.recritique)).toBe(0);
    expect(result.drafts).toHaveLength(2);
    expect(s.graph.stepsOf(TASK).at(-1)).toMatchObject({
      node: 'refine',
      status: 'complete',
      log: 'Nothing to rewrite',
    });
  });
});

describe('validate', () => {
  it('applies validateDraft with no passage, keeps at most brief.sentences in planned order, and stores the critique', async () => {
    const s = setup();
    await withOutline(s);
    const drafts = [draft(3, { rewritten: true }), draft(1), draft(0), draft(2), draft(4)].map(
      (d, i) => ({
        ...d,
        sentence: `Number ${i} of the library cases keeps every ___ in a tidy order.`,
      }),
    );
    const result = await validateNode(s.deps)(s.state({ drafts }));

    expect(result.outcome).toBe('awaiting_review');
    expect(s.graph.questions.size).toBe(3);
    const stored = [...s.graph.questions.values()].sort((a, b) => a.order - b.order);
    // Planned order: indexes 0, 1, 2 (index 3 and 4 are over the limit of three).
    expect(stored.map((q) => q.critique)).toEqual([
      { verdict: 'pass', note: 'Fine.', rewritten: false },
      { verdict: 'pass', note: 'Fine.', rewritten: false },
      { verdict: 'pass', note: 'Fine.', rewritten: false },
    ]);
    expect(stored.every((q) => q.generatedFrom === SOURCE && q.chunkId === '')).toBe(true);
    expect([...s.graph.puzzles.values()][0]).toMatchObject({
      id: puzzleIdForSource(SOURCE),
      origin: 'prompt',
      ownerId: OWNER,
    });
    expect(s.chat.calls).toHaveLength(1);
    expect(s.embeddings.calls).toHaveLength(0);
  });

  it('discards a draft that breaks a rule other than the passage rule, and counts it', async () => {
    const s = setup();
    await withOutline(s);
    const bad = draft(0, { answers: ['shelves', 'extra'] });
    const result = await validateNode(s.deps)(
      s.state({ drafts: [bad, draft(1), draft(2), draft(3)] }),
    );
    expect(result.counts!.discarded).toMatchObject({ blank_count_mismatch: 1 });
    expect(s.graph.questions.size).toBe(3);
  });

  it('writes nothing when fewer than minQuestions remain', async () => {
    const s = setup();
    await withOutline(s);
    const result = await validateNode(s.deps)(s.state({ drafts: [draft(0)], minQuestions: 2 }));
    expect(result.outcome).toBe('nothing_usable');
    expect(s.graph.count('Puzzle')).toBe(0);
    expect(s.graph.count('Question')).toBe(0);
  });

  it('with no drafts reports the stored count when the task already produced questions', async () => {
    const s = setup();
    await withOutline(s);
    s.graph.produced.add(`${TASK}|question|q1`);
    const stored = await validateNode(s.deps)(s.state());
    expect(stored.outcome).toBe('awaiting_review');
    const t = setup();
    await withOutline(t);
    expect((await validateNode(t.deps)(t.state())).outcome).toBe('nothing_usable');
  });
});

describe('no node touches the embeddings, chunks, or the vector search', () => {
  it('runs every node without an embeddings call, addChunks, or conceptNeighbourhood', async () => {
    const s = setup();
    let touched = 0;
    s.graph.addChunks = async () => {
      touched += 1;
      return 0;
    };
    s.graph.conceptNeighbourhood = async () => {
      touched += 1;
      return [];
    };
    await withOutline(s);
    const { drafts } = await draftQuestionsNode(s.deps)(s.state());
    const critiqued = await critiqueNode(s.deps)(s.state({ drafts: drafts! }));
    const refined = await refineNode(s.deps)(s.state({ drafts: critiqued.drafts! }));
    await validateNode(s.deps)(s.state({ drafts: refined.drafts! }));
    expect(touched).toBe(0);
    expect(s.embeddings.calls).toHaveLength(0);
  });
});
