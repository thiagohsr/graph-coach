import { describe, expect, it } from 'vitest';
import { renderSummary } from './summary';
import { selectTarget } from './select';
import { DEFAULT_COACH_SETTINGS } from './settings';
import type { PuzzleChoice, SelectedConcept, Selection } from './state';
import { workedExampleRows } from './testing/stubs';

const puzzle: PuzzleChoice = {
  puzzleId: 'p',
  name: 'Databases 101: Storage and B-trees',
  coversTarget: true,
  playedRecently: false,
};

const concept = (name: string, over: Partial<SelectedConcept> = {}): SelectedConcept => ({
  conceptId: name,
  slug: name,
  name,
  score: 0.12005,
  attempts: 4,
  lastSeen: 0,
  daysSince: 9,
  risk: 1.4456,
  ...over,
});

describe('renderSummary', () => {
  const worked = selectTarget(
    { tier: 1, weak: workedExampleRows().weak, other: [] },
    DEFAULT_COACH_SETTINGS,
  )!;

  it('prerequisite-first names target, driver, and puzzle', () => {
    const text = renderSummary({ selection: worked, puzzle, flags: ['prerequisite_first'] });
    expect(text).toContain('"B-trees"');
    expect(text).toContain('"Indexes"');
    expect(text).toContain('"Databases 101: Storage and B-trees"');
    expect(text).toContain('mastery 0.12, last practised 9 days ago');
  });

  it('a plain weak concept names target and puzzle', () => {
    const selection: Selection = {
      kind: 'weak',
      target: concept('Joins'),
      drivers: [],
      alternatives: [],
    };
    const text = renderSummary({ selection, puzzle, flags: [] });
    expect(text).toContain('"Joins"');
    expect(text).toContain('Recommended puzzle: "Databases 101: Storage and B-trees".');
  });

  it('is identical for identical input and at most 600 characters', () => {
    const input = { selection: worked, puzzle, flags: ['prerequisite_first' as const] };
    expect(renderSummary(input)).toBe(renderSummary(input));
    const long = concept('x'.repeat(700));
    expect(
      renderSummary({
        selection: { kind: 'weak', target: long, drivers: [], alternatives: [] },
        puzzle,
        flags: [],
      }).length,
    ).toBeLessThanOrEqual(600);
  });

  it('unseen, decayed, and all-mastered cases', () => {
    const unseen = renderSummary({
      selection: {
        kind: 'unseen',
        target: concept('Locking', { score: null, daysSince: null, risk: null }),
        drivers: [],
        alternatives: [],
      },
      puzzle,
      flags: ['unseen'],
    });
    expect(unseen).toContain('have not practised "Locking"');
    const decayed = renderSummary({
      selection: {
        kind: 'decayed',
        target: concept('Locking', { daysSince: 20 }),
        drivers: [],
        alternatives: [],
      },
      puzzle,
      flags: ['decayed'],
    });
    expect(decayed).toContain('It has been a while since you practised "Locking"');
    const mastered = renderSummary({
      selection: {
        kind: 'all_mastered',
        target: concept('Locking', { daysSince: 12 }),
        drivers: [],
        alternatives: [],
      },
      puzzle,
      flags: ['all_mastered'],
    });
    expect(mastered).toContain('looks solid');
    expect(mastered).toContain('(12 days)');
  });

  it('cold start says that no history exists', () => {
    const selection: Selection = {
      kind: 'cold_start',
      target: concept('Relational model', { score: null, risk: null, daysSince: null }),
      drivers: [],
      alternatives: [],
    };
    const text = renderSummary({ selection, puzzle, flags: ['cold_start'] });
    expect(text).toContain('no study history yet');
    expect(text).toContain('"Relational model"');
  });

  it('coverage gap, no puzzle, and repeat sentences', () => {
    const selection: Selection = {
      kind: 'weak',
      target: concept('Joins'),
      drivers: [],
      alternatives: [],
    };
    const gap = renderSummary({
      selection,
      puzzle: { ...puzzle, coversTarget: false },
      flags: ['coverage_gap'],
    });
    expect(gap).toContain('No puzzle tests "Joins" directly yet');
    const none = renderSummary({ selection, puzzle: null, flags: ['coverage_gap', 'no_puzzle'] });
    expect(none).toContain('No playable puzzle covers it yet.');
    expect(none).not.toContain('Recommended puzzle');
    const repeat = renderSummary({
      selection,
      puzzle: { ...puzzle, playedRecently: true },
      flags: ['repeat'],
    });
    expect(repeat).toContain('You played this puzzle recently');
  });
});
