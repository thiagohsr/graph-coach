// The selection rule (reconciliation F, plan "Selection rule", steps 3 to 6). Pure: rows in, selection out.
import { MAX_ALTERNATIVES } from './constants';
import type { DecayedRow, PrereqRef, WeakRow } from './rows';
import { round4 } from './risk';
import type { CoachSettings } from './settings';
import type { SelectedConcept, Selection, Signals } from './state';

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function fromWeakRow(row: WeakRow | PrereqRef): SelectedConcept {
  return {
    conceptId: row.conceptId,
    slug: row.slug,
    name: row.name,
    score: row.score,
    attempts: row.attempts,
    lastSeen: row.lastSeen,
    daysSince: row.daysSince,
    risk: row.risk,
  };
}

export function fromDecayedRow(row: DecayedRow): SelectedConcept {
  return {
    conceptId: row.conceptId,
    slug: row.slug,
    name: row.name,
    score: row.score,
    attempts: row.attempts,
    lastSeen: row.lastSeen,
    daysSince: row.daysSince,
    risk: row.risk,
  };
}

interface Group {
  target: SelectedConcept;
  members: WeakRow[];
  rank: number;
}

function selectWeak(weak: WeakRow[], settings: CoachSettings): Selection | null {
  const rows = weak.filter((row) => !row.cyclic);
  if (rows.length === 0) return null;

  const groups = new Map<string, Group>();
  for (const row of rows) {
    const prereq = row.weakestPrereq;
    // A prerequisite replaces the concept only when it is itself weak (risk >= threshold). Unpractised ones never come back.
    const replaced = prereq !== null && prereq.risk >= settings.riskThreshold;
    const target = replaced ? fromWeakRow(prereq) : fromWeakRow(row);
    const group = groups.get(target.conceptId) ?? { target, members: [], rank: 0 };
    group.members.push(row);
    group.rank = Math.max(group.rank, row.risk);
    groups.set(target.conceptId, group);
  }

  const ranked = [...groups.values()].sort(
    (a, b) =>
      round4(b.rank) - round4(a.rank) ||
      a.target.attempts - b.target.attempts ||
      cmp(a.target.name, b.target.name) ||
      cmp(a.target.slug, b.target.slug) ||
      cmp(a.target.conceptId, b.target.conceptId),
  );
  const [first, ...others] = ranked;
  if (!first) return null;

  const drivers = first.members
    .filter((row) => row.conceptId !== first.target.conceptId)
    .sort((a, b) => round4(b.risk) - round4(a.risk) || cmp(a.name, b.name) || cmp(a.slug, b.slug) || cmp(a.conceptId, b.conceptId))
    .map(fromWeakRow);

  return {
    kind: 'weak',
    target: first.target,
    drivers,
    alternatives: others.slice(0, MAX_ALTERNATIVES).map((g) => ({ ...g.target, risk: g.rank })),
  };
}

/** Unseen first, fewer unpractised prerequisites, oldest lastSeen, name, slug. */
export function sortCandidates(rows: DecayedRow[]): DecayedRow[] {
  return [...rows].sort(
    (a, b) =>
      (a.kind === 'unseen' ? 0 : 1) - (b.kind === 'unseen' ? 0 : 1) ||
      a.openPrereqs - b.openPrereqs ||
      (a.lastSeen ?? 0) - (b.lastSeen ?? 0) ||
      cmp(a.name, b.name) ||
      cmp(a.slug, b.slug) ||
      cmp(a.conceptId, b.conceptId),
  );
}

export function selectTarget(signals: Signals, settings: CoachSettings): Selection | null {
  if (signals.tier === 1) return selectWeak(signals.weak, settings);
  const [first] = sortCandidates(signals.other);
  if (!first) return null;
  const kind = signals.tier === 3 ? 'all_mastered' : first.kind === 'unseen' ? 'unseen' : 'decayed';
  return { kind, target: fromDecayedRow(first), drivers: [], alternatives: [] };
}
