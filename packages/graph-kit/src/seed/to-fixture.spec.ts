import { beforeAll, describe, expect, it } from 'vitest';
import type { FixtureEdge, FixtureNode } from '../fixture';
import { readSeedDir } from './read';
import type { SeedData } from './schema';
import { seedIds, seedToFixture } from './to-fixture';

const NOW = new Date('2026-10-11T12:00:00Z');
const DAY = 86_400_000;

let seed: SeedData;
beforeAll(async () => {
  seed = await readSeedDir();
});

const countBy = <T>(items: T[], key: (item: T) => string): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
  return out;
};

describe('seedToFixture', () => {
  it('is pure and deterministic for a fixed now', () => {
    const before = structuredClone(seed);
    const a = seedToFixture(seed, { now: NOW });
    const b = seedToFixture(seed, { now: new Date(NOW.getTime()) });
    expect(b).toEqual(a);
    expect(seed).toEqual(before);
  });

  it('produces the counts of data-model.md §5', () => {
    const f = seedToFixture(seed, { now: NOW });
    const nodes = countBy(f.nodes, (n) => n.label);
    const edges = countBy(f.edges, (e) => e.type);
    expect(nodes).toMatchObject({
      Concept: 25,
      Puzzle: 6,
      Question: 36,
      Learner: 4,
      Agent: 2,
      Session: 5,
    });
    expect(edges).toMatchObject({
      PREREQUISITE_OF: 32,
      ANSWERED: 41,
      CHANGED_MASTERY: 16,
      HAS_MASTERY: 13,
      OWNS: 6,
      CONTAINS: 36,
      REVIEWED: 36,
    });
    expect(edges.SHARED_WITH).toBeUndefined();
  });

  it("marks scenario items 'keep' and content 'update'", () => {
    const f = seedToFixture(seed, { now: NOW });
    const modeOf = (item: FixtureNode | FixtureEdge) => item.onMatch ?? 'update';
    for (const n of f.nodes.filter((n) => n.label === 'Session')) expect(modeOf(n)).toBe('keep');
    for (const type of ['PLAYED', 'OF', 'ANSWERED', 'CHANGED_MASTERY', 'HAS_MASTERY']) {
      for (const e of f.edges.filter((e) => e.type === type)) expect(modeOf(e)).toBe('keep');
    }
    for (const n of f.nodes.filter((n) => ['Concept', 'Puzzle', 'Question'].includes(n.label))) {
      expect(modeOf(n)).toBe('update');
    }
  });

  it('omits the scenario with scenario: false but keeps the learners', () => {
    const f = seedToFixture(seed, { now: NOW, scenario: false });
    expect(f.nodes.some((n) => n.label === 'Session')).toBe(false);
    for (const type of ['PLAYED', 'OF', 'ANSWERED', 'CHANGED_MASTERY', 'HAS_MASTERY']) {
      expect(f.edges.some((e) => e.type === type)).toBe(false);
    }
    expect(f.nodes.filter((n) => n.label === 'Learner')).toHaveLength(4);
  });

  it('sets times as epoch milliseconds relative to now', () => {
    const f = seedToFixture(seed, { now: NOW });
    const sessionA = f.nodes.find((n) => n.key === seedIds.session('A'))!;
    expect(sessionA.props).toMatchObject({
      submittedAt: NOW.getTime() - 9 * DAY,
      startedAt: NOW.getTime() - 9 * DAY - 5 * 60_000,
      score: 30,
      maxScore: 70,
    });
    const indexes = f.edges.find(
      (e) => e.type === 'HAS_MASTERY' && e.to.key === seedIds.concept('indexes'),
    )!;
    expect(indexes.props).toMatchObject({
      score: 0.2562455,
      attempts: 6,
      lastSeen: NOW.getTime() - DAY,
    });

    const later = seedToFixture(seed, { now: new Date(NOW.getTime() + 1000) });
    const laterA = later.nodes.find((n) => n.key === seedIds.session('A'))!;
    expect(laterA.props!.submittedAt).toBe((sessionA.props!.submittedAt as number) + 1000);
  });

  it('stores an unanswered blank as an empty word', () => {
    const copy = structuredClone(seed);
    copy.scenario.sessions[2]!.answers[3]!.word = null;
    const f = seedToFixture(copy, { now: NOW });
    const edge = f.edges.find(
      (e) =>
        e.type === 'ANSWERED' &&
        e.from.key === seedIds.session('A') &&
        e.to.key === seedIds.question('storage-and-b-trees', 3),
    )!;
    expect(edge.props).toMatchObject({ blank: 0, word: '' });
  });

  it("gives puzzles origin 'seed', published and public, owned by the admin", () => {
    const f = seedToFixture(seed, { now: NOW });
    for (const p of f.nodes.filter((n) => n.label === 'Puzzle')) {
      expect(p.props).toMatchObject({ origin: 'seed', status: 'published', visibility: 'public' });
    }
    const owners = new Set(f.edges.filter((e) => e.type === 'OWNS').map((e) => e.from.key));
    expect([...owners]).toEqual([seedIds.user('admin')]);
  });

  it('builds ids by the documented scheme', () => {
    expect(seedIds.email('learner2')).toBe('learner2@example.test');
    expect(seedIds.question('storage-and-b-trees', 3)).toMatch(
      /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/,
    );
    expect(seedIds.user('admin')).not.toBe(seedIds.user('learner'));
  });
});
