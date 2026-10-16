// Fixture builders for the Coach query tests (spec 004 T012). Built on the harness of @coach/graph-kit/testing.
// The worked example is the real seed with its scenario (data-model 5.6); the other fixtures are small hand-made graphs.
import type { TestGraph } from '../../src/testing';
import { seedIds } from '../../src';

export const DAY = 86_400_000;
/** The fixed seed time T = 2026-10-11T12:00:00Z used by every Coach test. */
export const NOW = Date.parse('2026-10-11T12:00:00Z');

export const cid = (slug: string): string => seedIds.concept(slug);

export interface WorkedExample {
  learnerId: string;
  learner2Id: string;
  reviewerId: string;
  adminId: string;
}

/** The seeded weak-prerequisite scenario: learner weak on `indexes`, weaker on its prerequisite `b-trees`. */
export async function loadWorkedExample(tg: TestGraph): Promise<WorkedExample> {
  await tg.loadSeed({ now: new Date(NOW) });
  return {
    learnerId: seedIds.user('learner'),
    learner2Id: seedIds.user('learner2'),
    reviewerId: seedIds.user('reviewer'),
    adminId: seedIds.user('admin'),
  };
}

/** The seed without any history: every user is a cold start. */
export async function loadColdStart(tg: TestGraph): Promise<WorkedExample> {
  await tg.loadSeed({ now: new Date(NOW), scenario: false });
  return {
    learnerId: seedIds.user('learner'),
    learner2Id: seedIds.user('learner2'),
    reviewerId: seedIds.user('reviewer'),
    adminId: seedIds.user('admin'),
  };
}

export interface MasterySpec {
  slug: string;
  score: number;
  attempts: number;
  daysAgo: number;
}

export async function addMastery(
  tg: TestGraph,
  learnerId: string,
  rows: MasterySpec[],
): Promise<void> {
  await tg.cypher(
    `MATCH (l:Learner {id: $learnerId})
     UNWIND $rows AS r
     MATCH (c:Concept {id: r.conceptId})
     MERGE (l)-[m:HAS_MASTERY]->(c)
     SET m.score = r.score, m.attempts = r.attempts, m.lastSeen = r.lastSeen`,
    {
      learnerId,
      rows: rows.map((r) => ({
        conceptId: cid(r.slug),
        score: r.score,
        attempts: r.attempts,
        lastSeen: NOW - r.daysAgo * DAY,
      })),
    },
  );
}

/** Seed plus a second weak concept (`transactions`) whose prerequisite is not weak: a second group. */
export async function loadTwoWeakGroups(tg: TestGraph): Promise<WorkedExample> {
  const ids = await loadWorkedExample(tg);
  await addMastery(tg, ids.learnerId, [
    { slug: 'transactions', score: 0.3, attempts: 2, daysAgo: 5 },
  ]);
  return ids;
}

export interface ConceptSpec {
  slug: string;
  prereqs?: string[];
}

export async function addConcepts(tg: TestGraph, concepts: ConceptSpec[]): Promise<void> {
  await tg.cypher(
    `UNWIND $rows AS r
     CREATE (:Concept {id: r.id, slug: r.slug, name: r.name, createdAt: 1})`,
    { rows: concepts.map((c) => ({ id: cid(c.slug), slug: c.slug, name: c.slug.toUpperCase() })) },
  );
  const edges = concepts.flatMap((c) =>
    (c.prereqs ?? []).map((p) => ({ from: cid(p), to: cid(c.slug) })),
  );
  if (edges.length > 0) {
    await tg.cypher(
      `UNWIND $edges AS e
       MATCH (a:Concept {id: e.from}), (b:Concept {id: e.to})
       CREATE (a)-[:PREREQUISITE_OF {confidence: 1.0}]->(b)`,
      { edges },
    );
  }
}

export async function addLearner(tg: TestGraph, id: string, displayName = id): Promise<void> {
  await tg.cypher(`MERGE (l:Learner {id: $id}) SET l.displayName = $name, l.createdAt = 1`, {
    id,
    name: displayName,
  });
}

export async function addAgents(tg: TestGraph): Promise<void> {
  await tg.cypher(`MERGE (:Agent {name: 'Coach'}) MERGE (:Agent {name: 'Curator'})`);
}

export interface PuzzleSpec {
  id: string;
  name: string;
  ownerId: string;
  status?: 'draft' | 'published';
  visibility?: 'private' | 'public';
  /** Each question tests the listed concept slugs. */
  questions: Array<{
    id: string;
    tests: string[];
    status?: 'draft' | 'approved' | 'rejected';
    sentence?: string;
  }>;
}

export async function addPuzzle(tg: TestGraph, spec: PuzzleSpec): Promise<void> {
  await tg.cypher(
    `MATCH (o:Learner {id: $ownerId})
     CREATE (o)-[:OWNS]->(p:Puzzle {id: $id, name: $name, status: $status, visibility: $visibility, origin: 'upload', createdAt: 1})`,
    {
      ownerId: spec.ownerId,
      id: spec.id,
      name: spec.name,
      status: spec.status ?? 'published',
      visibility: spec.visibility ?? 'public',
    },
  );
  let order = 1;
  for (const q of spec.questions) {
    await tg.cypher(
      `MATCH (p:Puzzle {id: $puzzleId})
       CREATE (p)-[:CONTAINS {order: $order}]->(q:Question {id: $id, sentence: $sentence, status: $status,
                    answers: ['secret-' + $id], distractors: ['decoy-' + $id], createdAt: 1})
       WITH q
       UNWIND $tests AS slug
       MATCH (c:Concept {id: slug})
       CREATE (q)-[:TESTS]->(c)`,
      {
        puzzleId: spec.id,
        order,
        id: q.id,
        sentence: q.sentence ?? `Sentence of ${q.id} with a ___.`,
        status: q.status ?? 'approved',
        tests: q.tests.map(cid),
      },
    );
    order += 1;
  }
}

export interface SessionSpec {
  id: string;
  learnerId: string;
  puzzleId: string;
  /** Absent: the session is not submitted. */
  submittedDaysAgo?: number;
  answers: Array<{ questionId: string; blank?: number; correct: boolean }>;
}

export async function addSession(tg: TestGraph, spec: SessionSpec): Promise<void> {
  const submittedAt =
    spec.submittedDaysAgo === undefined ? null : NOW - spec.submittedDaysAgo * DAY;
  await tg.cypher(
    `MATCH (l:Learner {id: $learnerId}), (p:Puzzle {id: $puzzleId})
     CREATE (l)-[:PLAYED]->(s:Session {id: $id, startedAt: $startedAt, score: 0, maxScore: 10})
     CREATE (s)-[:OF]->(p)
     SET s.submittedAt = $submittedAt`,
    {
      learnerId: spec.learnerId,
      puzzleId: spec.puzzleId,
      id: spec.id,
      startedAt: NOW - 1000,
      submittedAt,
    },
  );
  await tg.cypher(
    `MATCH (s:Session {id: $id})
     UNWIND $answers AS a
     MATCH (q:Question {id: a.questionId})
     CREATE (s)-[:ANSWERED {blank: a.blank, word: 'w', correct: a.correct}]->(q)`,
    {
      id: spec.id,
      answers: spec.answers.map((a) => ({
        questionId: a.questionId,
        blank: a.blank ?? 0,
        correct: a.correct,
      })),
    },
  );
}

export async function share(
  tg: TestGraph,
  puzzleId: string,
  learnerId: string,
  withSource: boolean,
): Promise<void> {
  await tg.cypher(
    `MATCH (p:Puzzle {id: $puzzleId}), (l:Learner {id: $learnerId})
     MERGE (p)-[sh:SHARED_WITH]->(l) SET sh.withSource = $withSource, sh.at = 1`,
    { puzzleId, learnerId, withSource },
  );
}

export async function revokeShare(
  tg: TestGraph,
  puzzleId: string,
  learnerId: string,
): Promise<void> {
  await tg.cypher(
    `MATCH (:Puzzle {id: $puzzleId})-[sh:SHARED_WITH]->(:Learner {id: $learnerId}) DELETE sh`,
    {
      puzzleId,
      learnerId,
    },
  );
}

export const L1 = 'learner-main';
export const L2 = 'learner-other';

/**
 * Two paths to one weak prerequisite: base -> left -> top and base -> right -> top. `top` and `base` are weak; the
 * middle concepts are not. Also a tiny public puzzle on `top`.
 */
export async function loadDiamond(tg: TestGraph): Promise<void> {
  await addLearner(tg, L1, 'Main');
  await addAgents(tg);
  await addConcepts(tg, [
    { slug: 'base' },
    { slug: 'left', prereqs: ['base'] },
    { slug: 'right', prereqs: ['base'] },
    { slug: 'top', prereqs: ['left', 'right'] },
  ]);
  await addMastery(tg, L1, [
    { slug: 'base', score: 0.1, attempts: 2, daysAgo: 3 },
    { slug: 'left', score: 0.9, attempts: 3, daysAgo: 1 },
    { slug: 'right', score: 0.9, attempts: 3, daysAgo: 1 },
    { slug: 'top', score: 0.3, attempts: 2, daysAgo: 1 },
  ]);
}

/** A prerequisite cycle a -> b -> a with both concepts weak. */
export async function loadCycle(tg: TestGraph): Promise<void> {
  await addLearner(tg, L1, 'Main');
  await addAgents(tg);
  await addConcepts(tg, [{ slug: 'a' }, { slug: 'b', prereqs: ['a'] }]);
  await tg.cypher(
    `MATCH (a:Concept {id: $a}), (b:Concept {id: $b}) CREATE (b)-[:PREREQUISITE_OF {confidence: 1.0}]->(a)`,
    { a: cid('a'), b: cid('b') },
  );
  await addMastery(tg, L1, [
    { slug: 'a', score: 0.2, attempts: 2, daysAgo: 2 },
    { slug: 'b', score: 0.2, attempts: 2, daysAgo: 2 },
  ]);
}

/** A weak concept `x` with no playable question; its neighbour `y` (a prerequisite) has one public puzzle. */
export async function loadCoverageGap(tg: TestGraph): Promise<void> {
  await addLearner(tg, L1, 'Main');
  await addLearner(tg, L2, 'Other');
  await addAgents(tg);
  await addConcepts(tg, [{ slug: 'y' }, { slug: 'x', prereqs: ['y'] }]);
  await addMastery(tg, L1, [{ slug: 'x', score: 0.1, attempts: 3, daysAgo: 4 }]);
  await addPuzzle(tg, {
    id: 'gap-puzzle',
    name: 'Neighbour puzzle',
    ownerId: L2,
    questions: [
      { id: 'gap-q1', tests: ['y'] },
      { id: 'gap-q2', tests: ['y'] },
    ],
  });
}

export const OWNERSHIP = {
  publicPuzzle: 'own-public',
  otherPrivate: 'own-other-private',
  sharedPrivate: 'own-shared-private',
  mainPrivate: 'own-main-private',
  draftPuzzle: 'own-draft',
  unsharedOnly: 'own-unshared-only',
} as const;

/**
 * Ownership fixture. L1 is the learner the Coach decides for, L2 another learner.
 * - own-public: public, published, approved question on `shared`, plus a draft and a rejected question on `hidden`.
 * - own-other-private: L2's private published puzzle on `priv`.
 * - own-shared-private: L2's private published puzzle on `shared` shared with L1 (play only); revoke with `revokeShare`.
 * - own-unshared-only: L2's private published puzzle on `lonely`, never shared.
 * - own-main-private: L1's own private published puzzle on `mine`.
 * - own-draft: L2's draft puzzle (public visibility) on `drafty`.
 * Concepts: priv, shared, lonely, mine, drafty, hidden (no prerequisites among them).
 */
export async function loadOwnership(tg: TestGraph): Promise<void> {
  await addLearner(tg, L1, 'Main');
  await addLearner(tg, L2, 'Other');
  await addAgents(tg);
  await addConcepts(tg, [
    { slug: 'priv' },
    { slug: 'shared' },
    { slug: 'lonely' },
    { slug: 'mine' },
    { slug: 'drafty' },
    { slug: 'hidden' },
  ]);
  await addPuzzle(tg, {
    id: OWNERSHIP.publicPuzzle,
    name: 'Public puzzle',
    ownerId: L2,
    visibility: 'public',
    questions: [
      { id: 'own-q-pub', tests: ['shared'] },
      { id: 'own-q-draft', tests: ['hidden'], status: 'draft' },
      { id: 'own-q-rejected', tests: ['hidden'], status: 'rejected' },
    ],
  });
  await addPuzzle(tg, {
    id: OWNERSHIP.otherPrivate,
    name: 'Other private',
    ownerId: L2,
    visibility: 'private',
    questions: [{ id: 'own-q-priv', tests: ['priv'] }],
  });
  await addPuzzle(tg, {
    id: OWNERSHIP.sharedPrivate,
    name: 'Shared private',
    ownerId: L2,
    visibility: 'private',
    questions: [{ id: 'own-q-shared', tests: ['shared'] }],
  });
  await addPuzzle(tg, {
    id: OWNERSHIP.unsharedOnly,
    name: 'Unshared only',
    ownerId: L2,
    visibility: 'private',
    questions: [{ id: 'own-q-lonely', tests: ['lonely'] }],
  });
  await addPuzzle(tg, {
    id: OWNERSHIP.mainPrivate,
    name: 'Main private',
    ownerId: L1,
    visibility: 'private',
    questions: [{ id: 'own-q-mine', tests: ['mine'] }],
  });
  await addPuzzle(tg, {
    id: OWNERSHIP.draftPuzzle,
    name: 'Draft puzzle',
    ownerId: L2,
    status: 'draft',
    visibility: 'public',
    questions: [{ id: 'own-q-drafty', tests: ['drafty'] }],
  });
  await share(tg, OWNERSHIP.sharedPrivate, L1, false);
}

export const ADMIN = 'learner-admin';

/**
 * Passages (goal stretch): L2 owns a source with one chunk that yielded the private puzzle `pass-puzzle`, which is
 * shared with L1 with the source (`withSource` true). `ADMIN` is a third learner with no share. L1 passes
 * canReadSource on the source, the admin does not.
 */
export async function loadPassages(tg: TestGraph): Promise<void> {
  await addLearner(tg, L1, 'Main');
  await addLearner(tg, L2, 'Other');
  await addLearner(tg, ADMIN, 'Admin');
  await addAgents(tg);
  await addConcepts(tg, [{ slug: 'topic' }]);
  await addPuzzle(tg, {
    id: 'pass-puzzle',
    name: 'Passage puzzle',
    ownerId: L2,
    visibility: 'private',
    questions: [{ id: 'pass-q', tests: ['topic'] }],
  });
  await tg.cypher(
    `MATCH (o:Learner {id: $owner}), (p:Puzzle {id: 'pass-puzzle'}), (c:Concept {id: $topic})
     CREATE (o)-[:OWNS]->(s:Source {id: 'pass-source', title: 'Owner notes', kind: 'text', createdAt: 1})
     CREATE (s)-[:HAS_CHUNK]->(k:Chunk {id: 'pass-chunk', position: 0, text: 'A passage about the topic.'})
     CREATE (s)-[:YIELDED]->(p)
     CREATE (k)-[:MENTIONS]->(c)`,
    { owner: L2, topic: cid('topic') },
  );
  await share(tg, 'pass-puzzle', L1, true);
}
