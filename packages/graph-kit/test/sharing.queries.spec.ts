import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { QueryParams } from '../src';
import { createTestGraph, type TestGraph } from '../src/testing';
import { IDS, SOURCE_TEXT, buildCuratorFixture, type Run } from './curator.fixture';
import { addDraftPuzzle, addPublishedPuzzles } from './review.fixture';

const { A, B, R, M } = IDS;
const NOW = 1_760_000_000_000;

let tg: TestGraph;
const run: Run = (text, params) => tg.cypher(text, params as QueryParams);
const q = <T = Record<string, unknown>>(name: string, params: Record<string, unknown>) =>
  tg.graph.query<T>(name, params as QueryParams);
const share = (puzzleId: string, targetId: string, withSource: boolean, extra: Record<string, unknown> = {}) =>
  q('share_puzzle', { puzzleId, userId: A, targetId, withSource, now: NOW, ...extra });

async function signature(): Promise<string> {
  const [nodes] = await tg.cypher<{ n: number }>('MATCH (n) RETURN count(n) AS n');
  const [edges] = await tg.cypher<{ n: number }>('MATCH ()-[r]->() RETURN count(r) AS n');
  return `${nodes!.n}/${edges!.n}`;
}

beforeAll(async () => {
  tg = await createTestGraph();
});
afterAll(async () => {
  await tg?.dispose();
});
beforeEach(async () => {
  await tg.clear();
  await buildCuratorFixture(run);
  await addDraftPuzzle(run);
  await addPublishedPuzzles(run);
});

describe('share_puzzle', () => {
  it('creates one SHARED_WITH edge with withSource and at, and is idempotent', async () => {
    expect(await share('PZ1', B, false)).toEqual([
      { status: 'published', hasSource: true, targetFound: true, shared: true, targetId: B, withSource: false, at: NOW },
    ]);
    const before = await signature();
    await share('PZ1', B, false, { now: NOW + 5 });
    expect(await signature()).toBe(before);
    expect(await tg.countEdges('SHARED_WITH')).toBe(1);
  });

  it('changing withSource updates the edge and keeps at', async () => {
    await share('PZ1', B, false);
    const rows = await share('PZ1', B, true, { now: NOW + 99 });
    expect(rows).toEqual([
      { status: 'published', hasSource: true, targetFound: true, shared: true, targetId: B, withSource: true, at: NOW },
    ]);
    expect(await tg.countEdges('SHARED_WITH')).toBe(1);
  });

  it('shares a puzzle that has no source when withSource is false', async () => {
    const [row] = await share('PZ2', B, false);
    expect(row).toMatchObject({ hasSource: false, shared: true });
  });

  it('returns no row for a non-owner, whatever the role', async () => {
    for (const userId of [B, R, M]) {
      expect(await q('share_puzzle', { puzzleId: 'PZ1', userId, targetId: R, withSource: false, now: NOW })).toEqual([]);
    }
    expect(await tg.countEdges('SHARED_WITH')).toBe(0);
  });

  it('writes no edge for a draft puzzle, an unknown target, the owner, or withSource on a puzzle without a source', async () => {
    const [draft] = await share('PZ3', B, false);
    expect(draft).toMatchObject({ status: 'draft', shared: false });
    const [unknown] = await share('PZ1', 'nobody', false);
    expect(unknown).toMatchObject({ targetFound: false, shared: false, targetId: null });
    const [self] = await share('PZ1', A, false);
    expect(self).toMatchObject({ targetFound: true, shared: false });
    const [noSource] = await share('PZ2', B, true);
    expect(noSource).toMatchObject({ hasSource: false, shared: false });
    expect(await tg.countEdges('SHARED_WITH')).toBe(0);
  });

  it('returns no row for an unknown puzzle', async () => {
    expect(await share('nope', B, false)).toEqual([]);
  });
});

describe('unshare_puzzle', () => {
  it('removes the edge, and reports 0 when there was none', async () => {
    await share('PZ1', B, true);
    expect(await q('unshare_puzzle', { puzzleId: 'PZ1', userId: A, targetId: B })).toEqual([{ removed: 1 }]);
    expect(await tg.countEdges('SHARED_WITH')).toBe(0);
    expect(await q('unshare_puzzle', { puzzleId: 'PZ1', userId: A, targetId: B })).toEqual([{ removed: 0 }]);
    expect(await q('unshare_puzzle', { puzzleId: 'PZ1', userId: A, targetId: 'nobody' })).toEqual([{ removed: 0 }]);
  });

  it('returns no row and removes nothing for a non-owner', async () => {
    await share('PZ1', B, true);
    for (const userId of [B, R, M]) {
      expect(await q('unshare_puzzle', { puzzleId: 'PZ1', userId, targetId: B })).toEqual([]);
    }
    expect(await tg.countEdges('SHARED_WITH')).toBe(1);
  });
});

describe('list_shares', () => {
  it('lists ids, status, hasSource, oldest first', async () => {
    await share('PZ1', R, false, { now: NOW + 10 });
    await share('PZ1', B, true, { now: NOW });
    const rows = await q('list_shares', { puzzleId: 'PZ1', userId: A });
    expect(rows).toEqual([
      { puzzleId: 'PZ1', status: 'published', hasSource: true, targetId: B, withSource: true, at: NOW },
      { puzzleId: 'PZ1', status: 'published', hasSource: true, targetId: R, withSource: false, at: NOW + 10 },
    ]);
  });

  it('returns one row with a null target when owned and not shared, and none for a non-owner', async () => {
    expect(await q('list_shares', { puzzleId: 'PZ3', userId: A })).toEqual([
      { puzzleId: 'PZ3', status: 'draft', hasSource: false, targetId: null, withSource: null, at: null },
    ]);
    for (const userId of [B, R, M]) expect(await q('list_shares', { puzzleId: 'PZ1', userId })).toEqual([]);
  });

  it('leaves no property containing an at-sign anywhere in the graph', async () => {
    await share('PZ1', B, true);
    await q('list_shares', { puzzleId: 'PZ1', userId: A });
    await q('unshare_puzzle', { puzzleId: 'PZ1', userId: A, targetId: B });
    await share('PZ1', R, false);
    const nodes = await tg.cypher<{ p: Record<string, unknown> }>('MATCH (n) RETURN properties(n) AS p');
    const edges = await tg.cypher<{ p: Record<string, unknown> }>('MATCH ()-[r]->() RETURN properties(r) AS p');
    for (const { p } of [...nodes, ...edges]) {
      for (const value of Object.values(p)) {
        const text = JSON.stringify(value);
        // The fixture source text has no at-sign either; any hit would be an address leaking in.
        expect(text.includes('@')).toBe(false);
      }
    }
  });
});

describe('get_source', () => {
  const get = (userId: string) => q<Record<string, unknown>>('get_source', { sourceId: 'S1', userId });

  it('gives the owner the content with access owner', async () => {
    const [row] = await get(A);
    expect(row).toMatchObject({
      id: 'S1',
      title: 'Ann notes',
      kind: 'text',
      content: SOURCE_TEXT,
      access: 'owner',
      ownerName: 'Ann',
      puzzleId: 'PZ1',
    });
  });

  it('gives a user shared with the source the content with access shared, and nobody else', async () => {
    await share('PZ1', B, true);
    const [row] = await get(B);
    expect(row).toMatchObject({ content: SOURCE_TEXT, access: 'shared', ownerName: 'Ann' });
    expect(await get(R)).toEqual([]);
    expect(await get(M)).toEqual([]);
  });

  it('gives nothing when shared without the source, after revocation, or when the puzzle is public', async () => {
    await share('PZ1', B, false);
    expect(await get(B)).toEqual([]);
    await share('PZ1', B, true);
    expect(await get(B)).toHaveLength(1);
    await q('unshare_puzzle', { puzzleId: 'PZ1', userId: A, targetId: B });
    expect(await get(B)).toEqual([]);
    await q('set_puzzle_visibility', { puzzleId: 'PZ1', userId: A, visibility: 'public' });
    expect(await get(B)).toEqual([]);
    expect(await get(R)).toEqual([]);
  });

  it('works for a source with a brief and no content', async () => {
    await run(`MATCH (s:Source {id: 'S1'}) SET s.kind = 'prompt', s.brief = '{"subject":"x"}' REMOVE s.content`);
    const [row] = await get(A);
    expect(row).toMatchObject({ kind: 'prompt', brief: '{"subject":"x"}', content: null });
  });

  it('is listed by list_sources as shared, without task fields, until revoked or withSource is turned off', async () => {
    await share('PZ1', B, true);
    const shared = await q<{ id: string; access: string; taskId: string | null; taskStatus: string | null }>(
      'list_sources',
      { userId: B },
    );
    expect(shared.filter((s) => s.id === 'S1')).toEqual([
      expect.objectContaining({ id: 'S1', access: 'shared', taskId: null, taskStatus: null }),
    ]);
    await share('PZ1', B, false);
    expect((await q<{ id: string }>('list_sources', { userId: B })).map((s) => s.id)).not.toContain('S1');
    await share('PZ1', B, true);
    await q('unshare_puzzle', { puzzleId: 'PZ1', userId: A, targetId: B });
    expect((await q<{ id: string }>('list_sources', { userId: B })).map((s) => s.id)).not.toContain('S1');
  });
});

describe('set_puzzle_visibility', () => {
  const set = (puzzleId: string, userId: string, visibility: string) =>
    q('set_puzzle_visibility', { puzzleId, userId, visibility });

  it('sets public and private on a published puzzle the caller owns', async () => {
    expect(await set('PZ1', A, 'public')).toEqual([
      { id: 'PZ1', status: 'published', visibility: 'public', origin: 'upload' },
    ]);
    const before = await signature();
    expect(await set('PZ1', A, 'public')).toHaveLength(1);
    expect(await signature()).toBe(before);
    expect(await set('PZ1', A, 'private')).toEqual([
      { id: 'PZ1', status: 'published', visibility: 'private', origin: 'upload' },
    ]);
  });

  it('returns the row unchanged with status draft for an owned draft puzzle', async () => {
    expect(await set('PZ3', A, 'public')).toEqual([
      { id: 'PZ3', status: 'draft', visibility: 'private', origin: 'upload' },
    ]);
  });

  it('returns no row for an unknown puzzle or one the caller does not own', async () => {
    expect(await set('nope', A, 'public')).toEqual([]);
    for (const userId of [B, R, M]) expect(await set('PZ1', userId, 'public')).toEqual([]);
  });

  it('touches no SHARED_WITH edge or source relationship', async () => {
    await share('PZ1', B, true);
    const before = await signature();
    await set('PZ1', A, 'public');
    expect(await signature()).toBe(before);
    expect(await tg.countEdges('SHARED_WITH')).toBe(1);
    expect(await tg.countEdges('YIELDED')).toBe(1);
  });
});
