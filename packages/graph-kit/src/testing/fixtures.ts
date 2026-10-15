// Ready-made graph fixtures for tests (contracts/internal-interfaces.md §3). Pure: no server access, fixed times.
import type { FixtureEdge, FixtureNode, GraphFixture } from '../fixture';
import { deterministicId } from '../ids';

/** Time stored on every fixture node: 2026-10-01T00:00:00Z. */
export const FIXTURE_TIME = Date.parse('2026-10-01T00:00:00Z');

/** Ids that the fixtures use, so tests can refer to them. */
export const fixtureIds = {
  concept: (slug: string): string => deterministicId('concept', slug),
  tinyPuzzle: deterministicId('puzzle', 'fixture-tiny'),
  tinyOwner: deterministicId('user', 'fixture-tiny-owner'),
  tinyQuestion: (order: 1 | 2 | 3): string => deterministicId('question', `fixture-tiny:${order}`),
  source: (puzzleId: string, ownerId: string): string => deterministicId('source', puzzleId, ownerId),
};

const concept = (slug: string): FixtureNode => ({
  label: 'Concept',
  key: fixtureIds.concept(slug),
  props: { slug, name: slug, description: `Fixture concept ${slug}.`, createdAt: FIXTURE_TIME },
});
const conceptRef = (slug: string) => ({ label: 'Concept' as const, key: fixtureIds.concept(slug) });

/** A learner node: id, displayName, createdAt. No e-mail. */
function learner(id: string, displayName: string): GraphFixture {
  return {
    nodes: [{ label: 'Learner', key: id, props: { displayName, createdAt: FIXTURE_TIME }, onMatch: 'keep' }],
    edges: [],
  };
}

/** Six concepts `chain-1` to `chain-6`: 1 to 5 in a chain, and a branch 3 to 6. Six nodes, five PREREQUISITE_OF edges. */
function conceptChain(): GraphFixture {
  const slugs = [1, 2, 3, 4, 5, 6].map((n) => `chain-${n}`);
  const link = (from: string, to: string): FixtureEdge => ({
    type: 'PREREQUISITE_OF',
    from: conceptRef(from),
    to: conceptRef(to),
    props: { confidence: 1.0 },
  });
  return {
    nodes: slugs.map(concept),
    edges: [
      link('chain-1', 'chain-2'),
      link('chain-2', 'chain-3'),
      link('chain-3', 'chain-4'),
      link('chain-4', 'chain-5'),
      link('chain-3', 'chain-6'),
    ],
  };
}

/**
 * One puzzle with three approved one-blank questions on two concepts (`tiny-a`, `tiny-b`) and one owner.
 * Seven nodes (owner, two concepts, puzzle, three questions) and seven edges (OWNS, 3 CONTAINS, 3 TESTS).
 */
function tinyPuzzle(
  options: { ownerId?: string; visibility?: 'private' | 'public'; status?: 'draft' | 'published' } = {},
): GraphFixture {
  const ownerId = options.ownerId ?? fixtureIds.tinyOwner;
  const puzzle = { label: 'Puzzle' as const, key: fixtureIds.tinyPuzzle };
  const questions = [
    { order: 1 as const, sentence: 'A table stores data in ___.', answers: ['rows'], distractors: ['trees', 'files'], concept: 'tiny-a' },
    { order: 2 as const, sentence: 'A key identifies a ___.', answers: ['row'], distractors: ['page', 'file'], concept: 'tiny-a' },
    { order: 3 as const, sentence: 'An index speeds up ___.', answers: ['lookups'], distractors: ['backups', 'logins'], concept: 'tiny-b' },
  ];
  const nodes: FixtureNode[] = [
    ...learner(ownerId, 'Fixture Owner').nodes,
    concept('tiny-a'),
    concept('tiny-b'),
    {
      ...puzzle,
      props: {
        name: 'Tiny puzzle',
        origin: 'seed',
        status: options.status ?? 'published',
        visibility: options.visibility ?? 'public',
        distractors: ['cache'],
        createdAt: FIXTURE_TIME,
      },
    },
  ];
  const edges: FixtureEdge[] = [{ type: 'OWNS', from: { label: 'Learner', key: ownerId }, to: puzzle }];
  for (const q of questions) {
    const ref = { label: 'Question' as const, key: fixtureIds.tinyQuestion(q.order) };
    nodes.push({
      ...ref,
      props: {
        sentence: q.sentence,
        answers: q.answers,
        distractors: q.distractors,
        status: 'approved',
        createdAt: FIXTURE_TIME,
        reviewedAt: FIXTURE_TIME,
      },
    });
    edges.push({ type: 'CONTAINS', from: puzzle, to: ref, props: { order: q.order } });
    edges.push({ type: 'TESTS', from: ref, to: conceptRef(q.concept) });
  }
  return { nodes, edges };
}

/** A Source with one Chunk, owned by `ownerId`, with YIELDED to the puzzle. Both must exist when it is loaded. */
function sourceFor(puzzleId: string, ownerId: string): GraphFixture {
  const sourceId = fixtureIds.source(puzzleId, ownerId);
  const source = { label: 'Source' as const, key: sourceId };
  const chunk = { label: 'Chunk' as const, key: deterministicId('chunk', sourceId, '0') };
  return {
    nodes: [
      {
        ...source,
        props: {
          title: 'Fixture source',
          kind: 'text',
          fingerprint: deterministicId('fingerprint', sourceId),
          content: 'A fixture text about tables and indexes.',
          createdAt: FIXTURE_TIME,
        },
      },
      { ...chunk, props: { text: 'A fixture text about tables and indexes.', position: 0 } },
    ],
    edges: [
      { type: 'OWNS', from: { label: 'Learner', key: ownerId }, to: source },
      { type: 'HAS_CHUNK', from: source, to: chunk },
      { type: 'YIELDED', from: source, to: { label: 'Puzzle', key: puzzleId } },
    ],
  };
}

/** `(Puzzle)-[:SHARED_WITH {withSource, at}]->(Learner)`. Both nodes must exist when it is loaded. */
function share(puzzleId: string, learnerId: string, withSource: boolean): GraphFixture {
  return {
    nodes: [],
    edges: [
      {
        type: 'SHARED_WITH',
        from: { label: 'Puzzle', key: puzzleId },
        to: { label: 'Learner', key: learnerId },
        props: { withSource, at: FIXTURE_TIME },
      },
    ],
  };
}

/** Concatenates fixtures. */
function merge(...parts: GraphFixture[]): GraphFixture {
  return { nodes: parts.flatMap((p) => p.nodes), edges: parts.flatMap((p) => p.edges) };
}

export const fixtures = { conceptChain, tinyPuzzle, sourceFor, share, learner, merge };
