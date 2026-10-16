import { describe, expect, it } from 'vitest';
import { buildDecisionPath } from './path';
import type { PathRow } from './rows';

const T = Date.parse('2026-10-11T12:00:00Z');
const DAY = 86_400_000;

const row = (over: Partial<PathRow> & Pick<PathRow, 'part' | 'fromLabel' | 'fromId' | 'type' | 'toLabel' | 'toId'>): PathRow => ({
  fromData: {},
  toData: {},
  role: null,
  reason: 'r',
  weight: null,
  ...over,
});

const because = (toLabel: string, toId: string, role: string, reason: string, weight: number, toData: Record<string, unknown> = {}) =>
  row({ part: 'because', fromLabel: 'Decision', fromId: 'd1', type: 'BECAUSE', toLabel, toId, toData, role, reason, weight });

function workedRows(): PathRow[] {
  const ixPuzzle = { puzzleId: 'p-ix', puzzleName: 'Databases 101: Indexes and Query Planning' };
  const btPuzzle = { puzzleId: 'p-bt', puzzleName: 'Databases 101: Storage and B-trees' };
  return [
    row({
      part: 'made', fromLabel: 'Agent', fromId: 'Coach', fromData: { name: 'Coach' }, type: 'MADE', toLabel: 'Decision', toId: 'd1',
      toData: { kind: 'recommendation', summary: 'Practise B-trees.', createdAt: T, flags: ['prerequisite_first'] }, reason: 'decided by the Coach',
    }),
    row({
      part: 'for', fromLabel: 'Decision', fromId: 'd1', type: 'FOR', toLabel: 'Learner', toId: 'l1',
      toData: { displayName: 'Demo Learner' }, reason: 'decided for this learner',
    }),
    row({
      part: 'recommended', fromLabel: 'Decision', fromId: 'd1', type: 'RECOMMENDED', toLabel: 'Puzzle', toId: 'p-bt',
      toData: { name: 'Databases 101: Storage and B-trees' }, reason: 'recommended puzzle',
    }),
    because('Concept', 'c-bt', 'target', 'target: mastery 0.12, last practised 9 days ago, risk 1.45', 0.723, { name: 'B-trees', slug: 'b-trees' }),
    because('Concept', 'c-ix', 'driver', 'weak concept that depends on the target: mastery 0.26, risk 0.80', 0.359, { name: 'Indexes', slug: 'indexes' }),
    because('Question', 'q-ix-2', 'answer', 'missed 2 times', 0.467, { sentence: 'Every index must be updated on each write, so adding indexes makes ___ slower.' }),
    because('Question', 'q-ix-3', 'answer', 'missed 2 times', 0.467, { sentence: 'Most relational databases implement their default index as a ___.' }),
    because('Question', 'q-bt-3', 'answer', 'missed 1 time', 0.233, { sentence: 'A B-tree keeps its keys in ___ order so that a range of values can be read in sequence.' }),
    because('Session', 's-C', 'session', '2 wrong answers on these concepts', 0.333, { submittedAt: T - DAY, score: 50, maxScore: 70, ...ixPuzzle }),
    because('Session', 's-B', 'session', '2 wrong answers on these concepts', 0.333, { submittedAt: T - 2 * DAY, score: 50, maxScore: 70, ...ixPuzzle }),
    because('Session', 's-A', 'session', '4 wrong answers on these concepts', 0.5, { submittedAt: T - 9 * DAY, score: 30, maxScore: 70, ...btPuzzle }),
    row({
      part: 'chain', fromLabel: 'Concept', fromId: 'c-bt', fromData: { name: 'B-trees', slug: 'b-trees' }, type: 'PREREQUISITE_OF',
      toLabel: 'Concept', toId: 'c-ix', toData: { name: 'Indexes', slug: 'indexes' }, reason: 'prerequisite of',
    }),
    row({ part: 'answered', fromLabel: 'Session', fromId: 's-C', type: 'ANSWERED', toLabel: 'Question', toId: 'q-ix-2', reason: '1 of 1 blanks wrong' }),
    row({ part: 'tests', fromLabel: 'Question', fromId: 'q-ix-2', type: 'TESTS', toLabel: 'Concept', toId: 'c-ix', reason: 'tests' }),
  ];
}

describe('buildDecisionPath', () => {
  const path = buildDecisionPath(workedRows());

  it('deduplicates nodes by label and id and merges their data', () => {
    const keys = path.nodes.map((n) => `${n.label}:${n.id}`);
    expect(new Set(keys).size).toBe(keys.length);
    const question = path.nodes.find((n) => n.id === 'q-ix-2')!;
    expect(question.props).toEqual({ sentence: 'Every index must be updated on each write, so adding indexes makes ___ slower.' });
    expect(path.nodes.find((n) => n.id === 'c-ix')!.props).toEqual({ name: 'Indexes', slug: 'indexes' });
  });

  it('titles follow the label rules and are never empty', () => {
    const title = (id: string) => path.nodes.find((n) => n.id === id)!.title;
    expect(title('d1')).toBe('Coach decision');
    expect(title('Coach')).toBe('Coach');
    expect(title('l1')).toBe('Demo Learner');
    expect(title('p-bt')).toBe('Databases 101: Storage and B-trees');
    expect(title('c-bt')).toBe('B-trees');
    expect(title('s-C')).toBe('Session on Databases 101: Indexes and Query Planning, 2026-10-10');
    expect(title('q-bt-3').length).toBeLessThanOrEqual(80);
    expect(path.nodes.every((n) => n.title.length > 0)).toBe(true);
  });

  it('converts time props to ISO strings', () => {
    expect(path.nodes.find((n) => n.id === 'd1')!.props.createdAt).toBe('2026-10-11T12:00:00.000Z');
    expect(path.nodes.find((n) => n.id === 's-C')!.props.submittedAt).toBe('2026-10-10T12:00:00.000Z');
  });

  it('every edge has a reason; weight and role only on BECAUSE edges', () => {
    for (const edge of path.edges) {
      expect(edge.reason && edge.reason.length > 0).toBe(true);
      if (edge.type === 'BECAUSE') {
        expect(edge.role).toBeTruthy();
        expect(edge.weight).toBeGreaterThan(0);
      } else {
        expect(edge.role).toBeUndefined();
        expect(edge.weight).toBeUndefined();
      }
    }
    expect(path.edges.filter((e) => e.type === 'BECAUSE')).toHaveLength(8);
    expect(path.edges[0]).toEqual({ from: 'Coach', to: 'd1', type: 'MADE', reason: 'decided by the Coach' });
  });

  it('steps equal the worked example of data-model 3.10, in order', () => {
    expect(path.steps).toEqual([
      'The Coach recommended the puzzle "Databases 101: Storage and B-trees".',
      'B-trees — target: mastery 0.12, last practised 9 days ago, risk 1.45.',
      'Indexes — weak concept that depends on the target: mastery 0.26, risk 0.80.',
      'B-trees is a prerequisite of Indexes.',
      'Question "Every index must be updated on each write, so adding indexes makes ___ slower." — missed 2 times.',
      'Question "Most relational databases implement their default index as a ___." — missed 2 times.',
      'Question "A B-tree keeps its keys in ___ order so that a range of values can be read in sequence." — missed 1 time.',
      'Session on Databases 101: Indexes and Query Planning, 2026-10-10 — 2 wrong answers on these concepts.',
      'Session on Databases 101: Indexes and Query Planning, 2026-10-09 — 2 wrong answers on these concepts.',
      'Session on Databases 101: Storage and B-trees, 2026-10-02 — 4 wrong answers on these concepts.',
    ]);
  });

  it('contains no e-mail address', () => {
    expect(JSON.stringify(path)).not.toMatch(/\S+@\S+/);
  });

  it('adds an "Also considered" line for alternatives', () => {
    const rows = [...workedRows(), because('Concept', 'c-tx', 'alternative', 'also considered: risk 0.95', 0.2, { name: 'Transactions', slug: 'transactions' })];
    const result = buildDecisionPath(rows);
    expect(result.steps[result.steps.length - 1]).toBe('Also considered: Transactions.');
  });

  it('without a recommended puzzle the first line says so and the rest is unchanged', () => {
    const rows = workedRows().filter((r) => r.part !== 'recommended');
    const result = buildDecisionPath(rows);
    expect(result.steps[0]).toBe('The Coach found no playable puzzle for this learner yet.');
    expect(result.steps.slice(1)).toEqual(path.steps.slice(1));
  });

  it('a passage row adds a Chunk node, a passage edge, and a step; without it nothing else changes', () => {
    const passage = row({
      part: 'passage', fromLabel: 'Decision', fromId: 'd1', type: 'BECAUSE', toLabel: 'Chunk', toId: 'k1',
      toData: { excerpt: 'Pages are fixed-size.', sourceTitle: 'My notes' }, role: 'passage',
      reason: 'matched the goal (similarity 0.82)', weight: 0.41,
    });
    const withPassage = buildDecisionPath([...workedRows(), passage]);
    expect(withPassage.nodes.find((n) => n.id === 'k1')).toMatchObject({ label: 'Chunk', title: 'Passage from My notes', props: { excerpt: 'Pages are fixed-size.' } });
    expect(withPassage.edges.find((e) => e.to === 'k1')).toMatchObject({ role: 'passage', weight: 0.41 });
    expect(withPassage.steps).toContain('Passage from My notes — matched the goal (similarity 0.82).');
    expect(withPassage.nodes.filter((n) => n.id !== 'k1')).toEqual(path.nodes);
    expect(withPassage.steps.filter((s) => !s.startsWith('Passage from'))).toEqual(path.steps);
  });

  it('goal and task rows add Goal and Task nodes, their edges, and goal and task steps after the sessions', () => {
    const goalRows = [
      row({
        part: 'toward', fromLabel: 'Decision', fromId: 'd1', type: 'TOWARD', toLabel: 'Goal', toId: 'g1',
        toData: { text: 'learn the storage engine' }, reason: 'practising toward this goal',
      }),
      row({
        part: 'targets', fromLabel: 'Goal', fromId: 'g1', fromData: { text: 'learn the storage engine' }, type: 'TARGETS',
        toLabel: 'Concept', toId: 'c-bt', toData: { name: 'B-trees', slug: 'b-trees' }, reason: 'the goal covers this concept',
      }),
      row({
        part: 'requested', fromLabel: 'Decision', fromId: 'd1', type: 'REQUESTED', toLabel: 'Task', toId: 't1',
        toData: { kind: 'cover', status: 'queued' }, reason: 'requested new puzzles for the Curator',
      }),
      row({
        part: 'concerns', fromLabel: 'Task', fromId: 't1', fromData: { kind: 'cover', status: 'queued' }, type: 'CONCERNS',
        toLabel: 'Concept', toId: 'c-ix', toData: { name: 'Indexes', slug: 'indexes' }, reason: 'needs more puzzles on this concept',
      }),
    ];
    const withGoal = buildDecisionPath([...workedRows(), ...goalRows]);
    expect(withGoal.nodes.find((n) => n.id === 'g1')).toMatchObject({ label: 'Goal', title: 'learn the storage engine', props: { text: 'learn the storage engine' } });
    expect(withGoal.nodes.find((n) => n.id === 't1')).toMatchObject({ label: 'Task', title: 'Coverage request', props: { kind: 'cover', status: 'queued' } });
    expect(withGoal.edges.filter((e) => ['TOWARD', 'TARGETS', 'REQUESTED', 'CONCERNS'].includes(e.type))).toHaveLength(4);
    expect(withGoal.edges.every((e) => (e.type === 'BECAUSE') === (e.role !== undefined))).toBe(true);
    expect(withGoal.steps).toEqual([
      ...path.steps,
      'The Coach was working toward your goal "learn the storage engine".',
      'The Coach asked the Curator for new puzzles on: Indexes.',
    ]);
    expect(withGoal.nodes.filter((n) => n.label !== 'Goal' && n.label !== 'Task')).toEqual(path.nodes);
    // goal lines come before the passage line, which comes before the task line
    const passage = row({
      part: 'passage', fromLabel: 'Decision', fromId: 'd1', type: 'BECAUSE', toLabel: 'Chunk', toId: 'k1',
      toData: { excerpt: 'x', sourceTitle: 'My notes' }, role: 'passage', reason: 'matched the goal (similarity 0.82)', weight: 0.41,
    });
    const all = buildDecisionPath([...workedRows(), ...goalRows, passage]);
    expect(all.steps.slice(path.steps.length)).toEqual([
      'The Coach was working toward your goal "learn the storage engine".',
      'Passage from My notes — matched the goal (similarity 0.82).',
      'The Coach asked the Curator for new puzzles on: Indexes.',
    ]);
  });

  it('a long goal text is cut to 80 characters in its title only', () => {
    const text = 'x'.repeat(120);
    const result = buildDecisionPath([
      ...workedRows(),
      row({ part: 'toward', fromLabel: 'Decision', fromId: 'd1', type: 'TOWARD', toLabel: 'Goal', toId: 'g1', toData: { text } }),
    ]);
    expect(result.nodes.find((n) => n.id === 'g1')!.title).toHaveLength(80);
  });

  it('drops properties outside the whitelist', () => {
    const rows = [
      ...workedRows(),
      because('Question', 'q-x', 'answer', 'missed 1 time', 0.2, { sentence: 's ___', answers: ['secret'], distractors: ['decoy'] }),
    ];
    const result = buildDecisionPath(rows);
    expect(JSON.stringify(result)).not.toMatch(/secret|decoy|distractors/);
  });
});
