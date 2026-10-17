import { describe, expect, it } from 'vitest';
import { StubChatProvider, StubEmbeddingsProvider } from '../../llm/stub';
import { chunkId, conceptId, puzzleIdForSource, questionId } from '../ids';
import { EMPTY_COUNTS, type CuratorStateType, type DraftCandidate } from '../state';
import {
  CURATOR_LABELS,
  FULL_TEXT,
  SHORT_TEXT,
  conceptLinesOf,
  draftsFor,
  scriptCurator,
} from '../testing/fixtures';
import { FakeCuratorGraph, makeDeps } from '../testing/fake-graph-port';
import { chunkNode } from './chunk';
import { draftQuestionsNode } from './draft-questions';
import { embedNode } from './embed';
import { extractConceptsNode } from './extract-concepts';
import { linkPrerequisitesNode } from './link-prerequisites';
import { validateNode } from './validate';

const OWNER = 'owner-1';
const SOURCE = 'source-1';
const TASK = 'task-1';

function setup(
  options: {
    content?: string;
    params?: { chunkSizeChars: number; chunkOverlapChars: number };
  } = {},
) {
  const graph = new FakeCuratorGraph();
  const chat = new StubChatProvider();
  const embeddings = new StubEmbeddingsProvider(16);
  graph.addSource({
    id: SOURCE,
    ownerId: OWNER,
    content: options.content ?? SHORT_TEXT,
    title: 'Library notes',
  });
  graph.addTask({ id: TASK, sourceId: SOURCE, requesterId: OWNER });
  const deps = makeDeps({
    graph,
    chat,
    embeddings,
    ...(options.params ? { params: options.params } : {}),
  });
  const state = (patch: Partial<CuratorStateType> = {}): CuratorStateType => ({
    taskId: TASK,
    kind: 'ingest',
    sourceId: SOURCE,
    ownerId: OWNER,
    entry: 'chunk',
    candidates: [],
    counts: { ...EMPTY_COUNTS, discarded: {} },
    outcome: null,
    ...patch,
  });
  return { graph, chat, embeddings, deps, state };
}

const SMALL = { chunkSizeChars: 500, chunkOverlapChars: 50 };

async function through(
  s: ReturnType<typeof setup>,
  upTo: 'chunk' | 'embed' | 'extractConcepts' | 'linkPrerequisites' | 'draftQuestions',
) {
  const order = [
    'chunk',
    'embed',
    'extractConcepts',
    'linkPrerequisites',
    'draftQuestions',
  ] as const;
  const nodes = {
    chunk: chunkNode,
    embed: embedNode,
    extractConcepts: extractConceptsNode,
    linkPrerequisites: linkPrerequisitesNode,
    draftQuestions: draftQuestionsNode,
  };
  let state = s.state();
  for (const name of order) {
    const patch = await nodes[name](s.deps)(state);
    state = { ...state, ...patch } as CuratorStateType;
    if (name === upTo) break;
  }
  return state;
}

describe('chunk', () => {
  it('reads the source text and the two chunk parameters and writes chunks without vectors', async () => {
    const s = setup({ params: SMALL });
    const patch = await chunkNode(s.deps)(s.state());
    expect(s.graph.count('Chunk')).toBeGreaterThan(3);
    expect(patch.counts?.chunks).toBe(s.graph.count('Chunk'));
    for (const chunk of s.graph.chunks.values()) {
      expect(chunk.embedding).toBeNull();
      expect(chunk.text.length).toBeLessThanOrEqual(SMALL.chunkSizeChars);
    }
    const first = s.graph.chunks.get(chunkId(SOURCE, 0))!;
    expect(first.prevId).toBeNull();
    expect(s.graph.chunks.get(chunkId(SOURCE, 1))!.prevId).toBe(first.id);
  });

  it('records a step with a count-only log and leaves the same graph when run twice', async () => {
    const s = setup({ params: SMALL });
    await chunkNode(s.deps)(s.state());
    const chunks = s.graph.count('Chunk');
    await chunkNode(s.deps)(s.state());
    expect(s.graph.count('Chunk')).toBe(chunks);
    const steps = s.graph.stepsOf(TASK).filter((x) => x.node === 'chunk');
    expect(steps).toHaveLength(1);
    expect(steps[0]!.log).toBe(`${chunks} chunks`);
    expect(steps[0]!.usage.modelCalls).toBe(0);
  });

  it('fails when the source has no text', async () => {
    const s = setup({ content: '   ' });
    await expect(chunkNode(s.deps)(s.state())).rejects.toMatchObject({
      code: 'INCONSISTENT_STATE',
      node: 'chunk',
    });
    expect(s.graph.stepsOf(TASK)[0]!.status).toBe('error');
  });
});

describe('embed', () => {
  it('makes one batched call for all chunks and stores the vectors', async () => {
    const s = setup({ params: SMALL });
    await through(s, 'chunk');
    await embedNode(s.deps)(s.state());
    expect(s.embeddings.calls).toHaveLength(1);
    expect(s.embeddings.calls[0]!.texts).toHaveLength(s.graph.count('Chunk'));
    for (const chunk of s.graph.chunks.values()) expect(chunk.embedding).toHaveLength(16);
    const step = s.graph.stepsOf(TASK).find((x) => x.node === 'embed')!;
    expect(step.usage.embeddingTokens).toBeGreaterThan(0);
    expect(step.usage.modelCalls).toBe(1);
    expect(step.log).toBe(`${s.graph.count('Chunk')} chunks embedded`);
  });

  it('skips the call when every chunk already has a vector, and still records the step', async () => {
    const s = setup({ params: SMALL });
    await through(s, 'embed');
    s.embeddings.calls.length = 0;
    await embedNode(s.deps)(s.state());
    expect(s.embeddings.calls).toHaveLength(0);
    const steps = s.graph.stepsOf(TASK).filter((x) => x.node === 'embed');
    expect(steps).toHaveLength(1);
    expect(steps[0]!.log).toBe('All chunks already embedded');
    expect(steps[0]!.usage.embeddingTokens).toBe(0);
  });
});

describe('extractConcepts', () => {
  it('asks for the neighbourhood once per chunk, calls the model once per chunk, and writes once', async () => {
    const s = setup({ params: SMALL });
    scriptCurator(s.chat);
    await through(s, 'embed');
    let neighbourhoodCalls = 0;
    const original = s.graph.conceptNeighbourhood.bind(s.graph);
    s.graph.conceptNeighbourhood = async (...args) => {
      neighbourhoodCalls += 1;
      return original(...args);
    };
    const chunks = s.graph.count('Chunk');
    const patch = await extractConceptsNode(s.deps)(s.state());
    expect(neighbourhoodCalls).toBe(chunks);
    expect(s.chat.callCount(CURATOR_LABELS.extract)).toBe(chunks);
    expect(s.graph.countWrites('upsertConcepts')).toBe(1);
    expect(s.graph.count('Concept')).toBeGreaterThan(0);
    expect(patch.counts?.concepts).toBe(s.graph.count('Concept'));
    expect(s.graph.mentions.size).toBeGreaterThan(0);
  });

  it('lists each merge in its log as "name" → slug', async () => {
    const text =
      'Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda.\n\nSecond paragraph speaks about other things entirely and at some length too.';
    const s = setup({ content: text, params: { chunkSizeChars: 80, chunkOverlapChars: 0 } });
    await through(s, 'embed');
    expect(s.graph.count('Chunk')).toBe(2);
    s.chat.on(CURATOR_LABELS.extract, (call) => {
      const passage = call.messages[1]!.content;
      const name = passage.includes('Alpha') ? 'Index tree' : 'Index trees';
      return { concepts: [{ name, description: 'A tree used as an index.', existingSlug: null }] };
    });
    await extractConceptsNode(s.deps)(s.state());
    const step = s.graph.stepsOf(TASK).find((x) => x.node === 'extractConcepts')!;
    expect(step.log).toContain('"Index trees" → index-tree');
    expect(step.log).toMatch(/1 created, 0 matched, 1 merged/);
    expect([...s.graph.concepts.keys()]).toEqual(['index-tree']);
    expect(s.graph.concepts.get('index-tree')!.id).toBe(conceptId('index-tree'));
  });

  it('uses the known concepts that the neighbourhood returns', async () => {
    const s = setup({ params: SMALL });
    scriptCurator(s.chat);
    await through(s, 'embed');
    s.graph.concepts.set('call-numbers', {
      id: 'seed-1',
      slug: 'call-numbers',
      name: 'Call numbers',
      description: 'Seeded concept.',
    });
    s.graph.conceptNeighbourhood = async () => [
      {
        conceptId: 'seed-1',
        slug: 'call-numbers',
        name: 'Call numbers',
        description: 'Seeded concept.',
      },
    ];
    await extractConceptsNode(s.deps)(s.state());
    expect(s.graph.concepts.get('call-numbers')!.id).toBe('seed-1');
    expect(s.graph.concepts.get('call-numbers')!.description).toBe('Seeded concept.');
    const prompts = s.chat.calls.map((c) => conceptLinesOf(c).map((l) => l.slug));
    expect(prompts.every((slugs) => slugs.includes('call-numbers'))).toBe(true);
  });
});

describe('linkPrerequisites', () => {
  function withConcepts(slugs: string[]) {
    const s = setup();
    s.graph.chunks.set('c1', {
      id: 'c1',
      sourceId: SOURCE,
      position: 0,
      text: 'Some text here.',
      prevId: null,
      embedding: null,
    });
    for (const slug of slugs) {
      s.graph.concepts.set(slug, {
        id: `id-${slug}`,
        slug,
        name: slug.toUpperCase(),
        description: `The concept ${slug}.`,
      });
      s.graph.mentions.add(`c1|${slug}`);
    }
    return s;
  }

  it('makes no model call with fewer than two concepts and still records the step', async () => {
    const s = withConcepts(['only']);
    const patch = await linkPrerequisitesNode(s.deps)(s.state());
    expect(s.chat.callCount()).toBe(0);
    expect(patch.counts?.links).toBe(0);
    const step = s.graph.stepsOf(TASK)[0]!;
    expect(step.node).toBe('linkPrerequisites');
    expect(step.status).toBe('complete');
    expect(step.log).toBe('No links to add');
  });

  it('drops unknown slugs, self-links, and low confidence, and refuses a cycle', async () => {
    const s = withConcepts(['a', 'b', 'c']);
    s.chat.on(CURATOR_LABELS.link, {
      links: [
        { prerequisite: 'a', dependent: 'b', confidence: 0.9 },
        { prerequisite: 'b', dependent: 'a', confidence: 0.8 }, // would close a cycle
        { prerequisite: 'a', dependent: 'nope', confidence: 0.9 }, // unknown slug
        { prerequisite: 'c', dependent: 'c', confidence: 0.9 }, // self
        { prerequisite: 'b', dependent: 'c', confidence: 0.3 }, // low confidence
      ],
    });
    const patch = await linkPrerequisitesNode(s.deps)(s.state());
    expect([...s.graph.prerequisites.keys()]).toEqual(['a>b']);
    expect(patch.counts?.links).toBe(1);
    expect(s.graph.stepsOf(TASK)[0]!.log).toBe('1 linked, 1 refused');
    expect(s.chat.callCount(CURATOR_LABELS.link)).toBe(1);
  });

  it('applies the links in order of confidence', async () => {
    const s = withConcepts(['a', 'b']);
    s.chat.on(CURATOR_LABELS.link, {
      links: [
        { prerequisite: 'b', dependent: 'a', confidence: 0.7 },
        { prerequisite: 'a', dependent: 'b', confidence: 0.95 },
      ],
    });
    await linkPrerequisitesNode(s.deps)(s.state());
    expect([...s.graph.prerequisites.keys()]).toEqual(['a>b']);
  });
});

describe('draftQuestions', () => {
  it('calls the model for chunks with a concept, keeps the drafts in memory, and writes nothing', async () => {
    const s = setup({
      content: FULL_TEXT,
      params: { chunkSizeChars: 1200, chunkOverlapChars: 100 },
    });
    scriptCurator(s.chat);
    const state = await through(s, 'linkPrerequisites');
    const writesBefore = [...s.graph.writeLog];
    const patch = await draftQuestionsNode(s.deps)(state);
    expect(patch.candidates!.length).toBeGreaterThan(0);
    expect(
      patch.candidates!.every((c) => typeof c.chunkId === 'string' && c.answers.length >= 1),
    ).toBe(true);
    const newWrites = s.graph.writeLog
      .slice(writesBefore.length)
      .filter((w) => w !== 'addStep' && w !== 'updateTask');
    expect(newWrites).toEqual([]);
    expect(s.graph.count('Question')).toBe(0);
    const chunksWithConcepts = [...s.graph.chunks.keys()].filter((id) =>
      [...s.graph.mentions].some((m) => m.startsWith(`${id}|`)),
    ).length;
    expect(s.chat.callCount(CURATOR_LABELS.draft)).toBe(chunksWithConcepts);
  });

  it('skips a chunk whose answer keeps the wrong shape and keeps the other drafts', async () => {
    const s = setup({
      content: FULL_TEXT,
      params: { chunkSizeChars: 1200, chunkOverlapChars: 100 },
    });
    // The first chunk asked about always answers with the wrong shape; every other chunk answers well.
    // Registered before scriptCurator: the stub uses the first handler that matches a label.
    let firstPassage: string | null = null;
    s.chat.on(CURATOR_LABELS.draft, (call) => {
      // The first user message is the passage; a retry adds a correction after it, so match on that one.
      const user = call.messages.find((m) => m.role === 'user')?.content ?? '';
      firstPassage ??= user;
      return user === firstPassage ? { questions: 'not a list' } : draftsFor(call, 'valid');
    });
    scriptCurator(s.chat);
    const state = await through(s, 'linkPrerequisites');
    const patch = await draftQuestionsNode(s.deps)(state);
    expect(patch.candidates!.length).toBeGreaterThan(0);
    const step = s.graph.stepsOf(TASK).find((x) => x.node === 'draftQuestions')!;
    expect(step.status).toBe('complete');
    expect(step.log).toMatch(/1 skipped: the model's answer did not match the expected shape/);
  });

  it('still fails when every chunk answers with the wrong shape', async () => {
    const s = setup({
      content: FULL_TEXT,
      params: { chunkSizeChars: 1200, chunkOverlapChars: 100 },
    });
    s.chat.on(CURATOR_LABELS.draft, () => ({ questions: 'not a list' }));
    scriptCurator(s.chat);
    const state = await through(s, 'linkPrerequisites');
    await expect(draftQuestionsNode(s.deps)(state)).rejects.toMatchObject({
      code: 'INVALID_MODEL_OUTPUT',
    });
  });

  it('skips the model when the task already produced questions', async () => {
    const s = setup();
    s.graph.produced.add(`${TASK}|question|q1`);
    const patch = await draftQuestionsNode(s.deps)(s.state());
    expect(patch.candidates).toEqual([]);
    expect(s.chat.callCount()).toBe(0);
    expect(s.graph.stepsOf(TASK)[0]!.log).toBe('Drafts already stored');
  });
});

describe('validate', () => {
  const PASSAGE =
    'A call number is the code on the spine of a book. The accession register records every new item on the day it arrives.';

  function prepared() {
    const s = setup();
    s.graph.chunks.set('c1', {
      id: 'c1',
      sourceId: SOURCE,
      position: 0,
      text: PASSAGE,
      prevId: null,
      embedding: null,
    });
    s.graph.concepts.set('call-numbers', {
      id: 'k1',
      slug: 'call-numbers',
      name: 'Call numbers',
      description: 'Codes on spines.',
    });
    s.graph.mentions.add('c1|call-numbers');
    return s;
  }

  const good: DraftCandidate = {
    sentence: 'A ___ is the code on the spine of a book.',
    answers: ['call number'],
    distractors: ['catalogue card', 'shelf trolley'],
    conceptSlugs: ['call-numbers'],
    chunkId: 'c1',
  };

  it('stores only drafts that pass every rule and counts the discards by code', async () => {
    const s = prepared();
    const candidates: DraftCandidate[] = [
      good,
      {
        ...good,
        answers: ['hologram'],
        sentence: 'A ___ is the code on the spine of a book, said someone.',
      },
      { ...good, sentence: 'There is no blank in this sentence at all, sadly.' },
      {
        ...good,
        sentence: 'Here a ___ is the code on the spine of a book.',
        conceptSlugs: ['unknown'],
      },
      good, // duplicate of the first
    ];
    const patch = await validateNode(s.deps)(s.state({ candidates }));
    expect(patch.outcome).toBe('awaiting_review');
    expect(patch.counts?.kept).toBe(1);
    expect(patch.counts?.discarded).toMatchObject({
      answer_not_in_passage: 1,
      no_blank: 1,
      no_concept: 1,
      duplicate: 1,
    });
    expect(s.graph.count('Question')).toBe(1);
    expect(s.graph.questions.has(questionId('c1', good.sentence, good.answers))).toBe(true);
    expect(s.graph.puzzles.get(puzzleIdForSource(SOURCE))).toMatchObject({
      name: 'Library notes',
      origin: 'upload',
      status: 'draft',
      visibility: 'private',
    });
    const step = s.graph.stepsOf(TASK).find((x) => x.node === 'validate')!;
    expect(step.log).toMatch(/1 drafts kept, 4 discarded/);
  });

  it('writes nothing and ends nothing_usable when no draft passes', async () => {
    const s = prepared();
    const patch = await validateNode(s.deps)(
      s.state({ candidates: [{ ...good, answers: ['hologram'] }] }),
    );
    expect(patch.outcome).toBe('nothing_usable');
    expect(s.graph.count('Puzzle')).toBe(0);
    expect(s.graph.count('Question')).toBe(0);
    expect(s.graph.stepsOf(TASK).find((x) => x.node === 'validate')!.log).toMatch(
      /^No usable drafts/,
    );
  });

  it('reports stored counts when the task already produced questions', async () => {
    const s = prepared();
    s.graph.produced.add(`${TASK}|question|q1`);
    const patch = await validateNode(s.deps)(s.state());
    expect(patch.outcome).toBe('awaiting_review');
    expect(s.graph.writeLog.filter((w) => w.startsWith('createDraft'))).toEqual([]);
  });

  it('fails with INCONSISTENT_STATE when fewer questions were written than sent', async () => {
    const s = prepared();
    s.graph.createDraftQuestions = async () => 0;
    await expect(validateNode(s.deps)(s.state({ candidates: [good] }))).rejects.toMatchObject({
      code: 'INCONSISTENT_STATE',
    });
  });
});
