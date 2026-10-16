import { describe, expect, it } from 'vitest';
import { DEFAULT_COACH_SETTINGS } from './settings';
import { selectTarget } from './select';
import type { DecayedRow, PrereqRef, WeakRow } from './rows';
import type { Signals } from './state';
import { WORKED_IDS, workedExampleRows } from './testing/stubs';

const settings = DEFAULT_COACH_SETTINGS;

const prereq = (id: string, risk: number, over: Partial<PrereqRef> = {}): PrereqRef => ({
  conceptId: id,
  slug: id,
  name: id.toUpperCase(),
  distance: 1,
  score: 0.5,
  attempts: 2,
  lastSeen: 0,
  daysSince: 1,
  risk,
  ...over,
});

const weak = (id: string, risk: number, over: Partial<WeakRow> = {}): WeakRow => ({
  conceptId: id,
  slug: id,
  name: id.toUpperCase(),
  score: 0.3,
  attempts: 3,
  lastSeen: 0,
  daysSince: 2,
  risk,
  weakestPrereq: null,
  cyclic: false,
  ...over,
});

const tier1 = (rows: WeakRow[]): Signals => ({ tier: 1, weak: rows, other: [] });

describe('selectTarget, tier 1', () => {
  it('worked example: target b-trees, driver indexes, no alternatives', () => {
    const selection = selectTarget(tier1(workedExampleRows().weak), settings)!;
    expect(selection.kind).toBe('weak');
    expect(selection.target.conceptId).toBe(WORKED_IDS.btrees);
    expect(selection.drivers.map((d) => d.conceptId)).toEqual([WORKED_IDS.indexes]);
    expect(selection.alternatives).toEqual([]);
  });

  it('a prerequisite below the threshold does not replace; one exactly at the threshold does', () => {
    const below = selectTarget(
      tier1([weak('x', 0.9, { weakestPrereq: prereq('p', 0.4999) })]),
      settings,
    )!;
    expect(below.target.conceptId).toBe('x');
    expect(below.drivers).toEqual([]);
    const at = selectTarget(
      tier1([weak('x', 0.9, { weakestPrereq: prereq('p', 0.5) })]),
      settings,
    )!;
    expect(at.target.conceptId).toBe('p');
    expect(at.drivers.map((d) => d.conceptId)).toEqual(['x']);
  });

  it('two weak concepts sharing one weak prerequisite form one group', () => {
    const rows = [
      weak('a', 0.8, { weakestPrereq: prereq('p', 1.2) }),
      weak('b', 0.7, { weakestPrereq: prereq('p', 1.2) }),
    ];
    const selection = selectTarget(tier1(rows), settings)!;
    expect(selection.target.conceptId).toBe('p');
    expect(selection.drivers.map((d) => d.conceptId)).toEqual(['a', 'b']);
    expect(selection.alternatives).toEqual([]);
  });

  it('ranks groups by the highest member risk; the second becomes an alternative', () => {
    const rows = [weak('a', 0.9, { weakestPrereq: prereq('p', 1.5) }), weak('lone', 1.1)];
    const selection = selectTarget(tier1(rows), settings)!;
    expect(selection.target.conceptId).toBe('lone');
    expect(selection.alternatives.map((a) => a.conceptId)).toEqual(['p']);
    expect(selection.alternatives[0]!.risk).toBeCloseTo(0.9);
  });

  it('breaks ties by attempts, then name, then slug', () => {
    const byAttempts = selectTarget(
      tier1([weak('a', 1, { attempts: 5 }), weak('b', 1, { attempts: 2 })]),
      settings,
    )!;
    expect(byAttempts.target.conceptId).toBe('b');
    const byName = selectTarget(
      tier1([weak('z', 1, { name: 'Beta' }), weak('y', 1, { name: 'Alpha' })]),
      settings,
    )!;
    expect(byName.target.conceptId).toBe('y');
    const bySlug = selectTarget(
      tier1([
        weak('z', 1, { name: 'Same', slug: 'zz' }),
        weak('y', 1, { name: 'Same', slug: 'aa' }),
      ]),
      settings,
    )!;
    expect(bySlug.target.conceptId).toBe('y');
  });

  it('ignores cyclic rows', () => {
    const rows = [weak('cyc', 2, { cyclic: true }), weak('ok', 0.6)];
    expect(selectTarget(tier1(rows), settings)!.target.conceptId).toBe('ok');
    expect(selectTarget(tier1([weak('cyc', 2, { cyclic: true })]), settings)).toBeNull();
  });

  it('gives the same output for shuffled input rows', () => {
    const rows = [
      weak('a', 0.9, { weakestPrereq: prereq('p', 1.5) }),
      weak('b', 0.8, { weakestPrereq: prereq('p', 1.5) }),
      weak('c', 1.1),
      weak('d', 0.7),
      weak('e', 0.7, { attempts: 1 }),
    ];
    const expected = JSON.stringify(selectTarget(tier1(rows), settings));
    const shuffles = [
      [4, 2, 0, 3, 1],
      [1, 0, 4, 2, 3],
      [3, 4, 1, 0, 2],
      [2, 3, 4, 1, 0],
    ];
    for (const order of shuffles) {
      expect(JSON.stringify(selectTarget(tier1(order.map((i) => rows[i]!)), settings))).toBe(
        expected,
      );
    }
  });

  it('caps the alternatives at MAX_ALTERNATIVES', () => {
    const rows = Array.from({ length: 8 }, (_, i) => weak(`c${i}`, 1 + i / 100));
    const selection = selectTarget(tier1(rows), settings)!;
    expect(selection.alternatives).toHaveLength(5);
    expect(selection.target.conceptId).toBe('c7');
  });
});

const candidate = (
  id: string,
  kind: 'unseen' | 'decayed',
  over: Partial<DecayedRow> = {},
): DecayedRow => ({
  conceptId: id,
  slug: id,
  name: id.toUpperCase(),
  kind,
  score: kind === 'unseen' ? null : 0.6,
  attempts: kind === 'unseen' ? 0 : 3,
  lastSeen: kind === 'unseen' ? null : 100,
  daysSince: kind === 'unseen' ? null : 20,
  risk: kind === 'unseen' ? null : 0.9,
  openPrereqs: 0,
  ...over,
});

describe('selectTarget, tiers 2 and 3', () => {
  it('tier 2 takes the first candidate and reports unseen or decayed', () => {
    const unseen = selectTarget(
      { tier: 2, weak: [], other: [candidate('u', 'unseen'), candidate('d', 'decayed')] },
      settings,
    )!;
    expect(unseen.kind).toBe('unseen');
    expect(unseen.target.conceptId).toBe('u');
    const decayed = selectTarget(
      { tier: 2, weak: [], other: [candidate('d', 'decayed')] },
      settings,
    )!;
    expect(decayed.kind).toBe('decayed');
    expect(decayed.target.risk).toBe(0.9);
  });

  it('tier 3 reports all_mastered', () => {
    const selection = selectTarget(
      { tier: 3, weak: [], other: [candidate('d', 'decayed')] },
      settings,
    )!;
    expect(selection.kind).toBe('all_mastered');
    expect(selection.drivers).toEqual([]);
  });

  it('is independent of input order and returns null for no rows', () => {
    const rows = [
      candidate('b', 'unseen', { openPrereqs: 2 }),
      candidate('a', 'unseen', { openPrereqs: 1 }),
      candidate('c', 'decayed'),
    ];
    expect(selectTarget({ tier: 2, weak: [], other: rows }, settings)!.target.conceptId).toBe('a');
    expect(
      selectTarget({ tier: 2, weak: [], other: [...rows].reverse() }, settings)!.target.conceptId,
    ).toBe('a');
    expect(selectTarget({ tier: 2, weak: [], other: [] }, settings)).toBeNull();
  });
});
