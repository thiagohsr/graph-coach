import type { DecisionPathDto } from '@coach/types';
import { describe, expect, it } from 'vitest';
import { path } from './fixtures';
import { buildDisplayGraph, NODE_HEIGHT, NODE_WIDTH } from './why-graph';
import { buildWhyPath } from './why-path';

const rich: DecisionPathDto = {
  nodes: [
    { id: 'Coach', label: 'Agent', title: 'Coach', props: {} },
    { id: 'L', label: 'Learner', title: 'Sam', props: {} },
    { id: 'd', label: 'Decision', title: 'Coach decision', props: {} },
    { id: 'p', label: 'Puzzle', title: 'Databases 101', props: {} },
    { id: 'pool', label: 'Concept', title: 'Pages and the buffer pool', props: {} },
    { id: 'bt', label: 'Concept', title: 'B-trees', props: {} },
    { id: 'wal', label: 'Concept', title: 'Write-ahead log', props: {} },
    { id: 'norm', label: 'Concept', title: 'Normalization', props: {} },
    ...['q1', 'q2', 'q3'].map((id) => ({
      id,
      label: 'Question' as const,
      title: `Sentence ${id}`,
      props: {},
    })),
    ...['s1', 's2', 's3'].map((id) => ({
      id,
      label: 'Session' as const,
      title: 'Session on Databases 101, 2026-10-16',
      props: {},
    })),
  ],
  edges: [
    { from: 'Coach', to: 'd', type: 'MADE', reason: 'decided by the Coach' },
    { from: 'd', to: 'L', type: 'FOR', reason: 'decided for this learner' },
    { from: 'd', to: 'p', type: 'RECOMMENDED', reason: 'recommended puzzle' },
    { from: 'd', to: 'pool', type: 'BECAUSE', role: 'target', reason: 'target: mastery 0.22' },
    { from: 'd', to: 'bt', type: 'BECAUSE', role: 'driver', reason: 'weak concept' },
    { from: 'd', to: 'wal', type: 'BECAUSE', role: 'driver', reason: 'weak concept' },
    { from: 'd', to: 'norm', type: 'BECAUSE', role: 'alternative', reason: 'also considered' },
    { from: 'pool', to: 'bt', type: 'PREREQUISITE_OF', reason: 'prerequisite of' },
    { from: 'pool', to: 'wal', type: 'PREREQUISITE_OF', reason: 'prerequisite of' },
    { from: 'd', to: 'q1', type: 'BECAUSE', role: 'answer', reason: 'missed 29 times' },
    { from: 'd', to: 'q2', type: 'BECAUSE', role: 'answer', reason: 'missed 7 times' },
    { from: 'd', to: 'q3', type: 'BECAUSE', role: 'answer', reason: 'missed 7 times' },
    { from: 'q1', to: 'wal', type: 'TESTS', reason: 'tests' },
    { from: 'q2', to: 'bt', type: 'TESTS', reason: 'tests' },
    { from: 'q3', to: 'bt', type: 'TESTS', reason: 'tests' },
    ...['s1', 's2', 's3'].flatMap((s) => [
      { from: 'd', to: s, type: 'BECAUSE', role: 'session' as const, reason: 'recent session' },
      { from: s, to: 'q2', type: 'ANSWERED', reason: '2 of 2 blanks wrong' },
      { from: s, to: 'q1', type: 'ANSWERED', reason: '1 of 1 blanks wrong' },
    ]),
  ],
  steps: ['x'],
};

const build = (showAlternatives = false, orientation: 'LR' | 'TB' = 'LR') =>
  buildDisplayGraph(buildWhyPath(rich), { orientation, showAlternatives });
const overlaps = (
  a: { position: { x: number; y: number } },
  b: { position: { x: number; y: number } },
) =>
  Math.abs(a.position.x - b.position.x) < NODE_WIDTH &&
  Math.abs(a.position.y - b.position.y) < NODE_HEIGHT;

describe('buildDisplayGraph', () => {
  it('drops Agent and Learner, aggregates questions per concept and sessions into one node', () => {
    const g = build();
    const ids = g.nodes.map((n) => n.id);
    expect(ids).not.toContain('Coach');
    expect(ids).not.toContain('L');
    expect(ids).not.toContain('s1');
    expect(g.nodes.find((n) => n.id === 'agg:questions:bt')).toMatchObject({
      title: '2 missed questions',
      subtitle: 'on B-trees',
    });
    expect(g.nodes.find((n) => n.id === 'agg:questions:wal')?.items).toEqual([
      'Sentence q1 (missed 29 times)',
    ]);
    const sessions = g.nodes.find((n) => n.id === 'agg:sessions')!;
    expect(sessions.title).toBe('3 recent sessions');
    expect(sessions.subtitle).toBeUndefined();
    expect(sessions.items).toHaveLength(3);
  });

  it('hides alternatives until asked, then draws them faded', () => {
    expect(build().hasAlternatives).toBe(true);
    expect(build().nodes.some((n) => n.id === 'norm')).toBe(false);
    const shown = build(true).nodes.find((n) => n.id === 'norm');
    expect(shown?.faded).toBe(true);
  });

  it('labels only main-story edges and leaves evidence edges to hover', () => {
    const g = build();
    expect(
      g.edges
        .filter((e) => e.label)
        .map((e) => e.label)
        .sort(),
    ).toEqual(['prerequisite of', 'prerequisite of', 'recommends']);
    expect(g.edges.filter((e) => e.style === 'evidence').every((e) => e.label === undefined)).toBe(
      true,
    );
  });

  it('lays out in columns left to right without overlaps', () => {
    const g = build();
    const x = (id: string) => g.nodes.find((n) => n.id === id)!.position.x;
    expect(x('d')).toBeLessThan(x('p'));
    expect(x('p')).toBeLessThan(x('pool'));
    expect(x('pool')).toBeLessThan(x('bt'));
    expect(x('bt')).toBeLessThan(x('agg:questions:bt'));
    for (const [i, a] of g.nodes.entries())
      for (const b of g.nodes.slice(i + 1)) expect(overlaps(a, b), `${a.id} / ${b.id}`).toBe(false);
  });

  it('lays out top to bottom for narrow screens', () => {
    const g = build(true, 'TB');
    const y = (id: string) => g.nodes.find((n) => n.id === id)!.position.y;
    expect(y('d')).toBeLessThan(y('p'));
    expect(y('p')).toBeLessThan(y('pool'));
    expect(y('pool')).toBeLessThan(y('bt'));
  });

  it('keeps the small fixture readable: decision, puzzle, target and the dependent concept', () => {
    const g = buildDisplayGraph(buildWhyPath(path), { orientation: 'LR', showAlternatives: false });
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['c-bt', 'c-ix', 'dec-1', 'pz-1']);
  });
});
