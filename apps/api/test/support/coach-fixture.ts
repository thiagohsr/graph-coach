// Helpers for the Coach API tests (spec 004). Small hand-made graphs on top of the test graph, and sign-in for the seeded
// demo users. A related copy for the graph layer lives in packages/graph-kit/test/fixtures/coach.fixture.ts.
import { seedIds } from '@coach/graph-kit';
import type { Role } from '@coach/types';
import { users } from '../../src/apps/accounts/user.model';
import { DevTokenVerifier } from '../../src/common/auth/dev-token-verifier';
import type { TestApp, TestUser } from './test-app';

export const DAY = 86_400_000;

/** The signing secret of createTestApp (test-only). */
const TEST_JWT_SECRET = 'test-only-signing-secret-0123456789';

type SeedUserKey = Parameters<typeof seedIds.user>[0];
const SEED_USERS: Record<string, { name: string; role: Role }> = {
  learner: { name: 'Demo Learner', role: 'learner' },
  learner2: { name: 'Second Learner', role: 'learner' },
  reviewer: { name: 'Demo Reviewer', role: 'reviewer' },
  admin: { name: 'Demo Admin', role: 'admin' },
};

/** Creates the users row of a seeded demo user (its Learner node comes from the seed) and returns a development token. */
export async function signInSeeded(
  app: TestApp,
  key: 'learner' | 'learner2' | 'reviewer' | 'admin',
): Promise<TestUser> {
  const meta = SEED_USERS[key]!;
  const id = seedIds.user(key as SeedUserKey);
  const email = seedIds.email(key as SeedUserKey);
  await app.db.insert(users).values({
    id,
    email,
    displayName: meta.name,
    role: meta.role,
    status: 'active',
    createdAt: app.clock.now(),
    lastSeenAt: app.clock.now(),
  });
  const signer = new DevTokenVerifier({ secret: TEST_JWT_SECRET, clock: app.clock });
  const { accessToken } = await signer.sign(id);
  return {
    id,
    email,
    name: meta.name,
    role: meta.role,
    token: accessToken,
    auth: { Authorization: `Bearer ${accessToken}` },
  };
}

export const cid = (slug: string): string => `c-${slug}`;

export async function addAgents(app: TestApp): Promise<void> {
  await app.testGraph.cypher(`MERGE (:Agent {name: 'Coach'}) MERGE (:Agent {name: 'Curator'})`);
}

export async function addConcepts(
  app: TestApp,
  concepts: Array<{ slug: string; prereqs?: string[] }>,
): Promise<void> {
  await app.testGraph.cypher(
    `UNWIND $rows AS r CREATE (:Concept {id: r.id, slug: r.slug, name: r.name, createdAt: 1})`,
    { rows: concepts.map((c) => ({ id: cid(c.slug), slug: c.slug, name: c.slug.toUpperCase() })) },
  );
  const edges = concepts.flatMap((c) =>
    (c.prereqs ?? []).map((p) => ({ from: cid(p), to: cid(c.slug) })),
  );
  if (edges.length > 0) {
    await app.testGraph.cypher(
      `UNWIND $edges AS e MATCH (a:Concept {id: e.from}), (b:Concept {id: e.to}) CREATE (a)-[:PREREQUISITE_OF {confidence: 1.0}]->(b)`,
      { edges },
    );
  }
}

export async function addMastery(
  app: TestApp,
  learnerId: string,
  rows: Array<{ slug: string; score: number; attempts: number; daysAgo: number }>,
): Promise<void> {
  const now = app.clock.now().getTime();
  await app.testGraph.cypher(
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
        lastSeen: now - r.daysAgo * DAY,
      })),
    },
  );
}

export async function addPuzzle(
  app: TestApp,
  spec: {
    id: string;
    name: string;
    ownerId: string;
    visibility: 'private' | 'public';
    tests: string[];
  },
): Promise<void> {
  await app.testGraph.cypher(
    `MATCH (o:Learner {id: $ownerId})
     CREATE (o)-[:OWNS]->(p:Puzzle {id: $id, name: $name, status: 'published', visibility: $visibility, origin: 'upload', createdAt: 1})`,
    { ownerId: spec.ownerId, id: spec.id, name: spec.name, visibility: spec.visibility },
  );
  let order = 1;
  for (const slug of spec.tests) {
    await app.testGraph.cypher(
      `MATCH (p:Puzzle {id: $puzzleId}), (c:Concept {id: $conceptId})
       CREATE (p)-[:CONTAINS {order: $order}]->(q:Question {id: $qid, sentence: 'A sentence about ' + c.name + ' with a ___.',
                                                         status: 'approved', answers: ['key-' + $qid], distractors: ['decoy-' + $qid, 'other-' + $qid], createdAt: 1})
       CREATE (q)-[:TESTS]->(c)`,
      { puzzleId: spec.id, conceptId: cid(slug), order, qid: `${spec.id}-q${order}` },
    );
    order += 1;
  }
}

export async function share(
  app: TestApp,
  puzzleId: string,
  learnerId: string,
  withSource: boolean,
): Promise<void> {
  await app.testGraph.cypher(
    `MATCH (p:Puzzle {id: $puzzleId}), (l:Learner {id: $learnerId})
     MERGE (p)-[sh:SHARED_WITH]->(l) SET sh.withSource = $withSource, sh.at = 1`,
    { puzzleId, learnerId, withSource },
  );
}

export async function revokeShare(
  app: TestApp,
  puzzleId: string,
  learnerId: string,
): Promise<void> {
  await app.testGraph.cypher(
    `MATCH (:Puzzle {id: $puzzleId})-[sh:SHARED_WITH]->(:Learner {id: $learnerId}) DELETE sh`,
    {
      puzzleId,
      learnerId,
    },
  );
}
