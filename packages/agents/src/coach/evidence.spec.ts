import { describe, expect, it } from 'vitest';
import { buildEvidence } from './evidence';
import { selectTarget } from './select';
import { DEFAULT_COACH_SETTINGS } from './settings';
import type { Selection } from './state';
import { WORKED_IDS, workedExampleRows } from './testing/stubs';

const workedSelection = (): Selection =>
  selectTarget({ tier: 1, weak: workedExampleRows().weak, other: [] }, DEFAULT_COACH_SETTINGS)!;

describe('buildEvidence, worked example', () => {
  const items = buildEvidence(
    {
      selection: workedSelection(),
      answers: workedExampleRows().answers,
      flags: ['prerequisite_first'],
    },
    DEFAULT_COACH_SETTINGS,
  );

  it('target and driver have the documented reasons and weights', () => {
    expect(items[0]).toEqual({
      label: 'Concept',
      nodeId: WORKED_IDS.btrees,
      role: 'target',
      reason: 'target: mastery 0.12, last practised 9 days ago, risk 1.45',
      weight: 0.723,
    });
    expect(items[1]).toEqual({
      label: 'Concept',
      nodeId: WORKED_IDS.indexes,
      role: 'driver',
      reason: 'weak concept that depends on the target: mastery 0.26, risk 0.80',
      weight: 0.359,
    });
  });

  it('answers: the two Indexes questions missed twice, then three B-tree questions by lowest id', () => {
    const answers = items.filter((i) => i.role === 'answer');
    expect(answers.map((a) => [a.nodeId, a.reason, a.weight])).toEqual([
      ['q-ix-2', 'missed 2 times', 0.467],
      ['q-ix-3', 'missed 2 times', 0.467],
      ['q-bt-3', 'missed 1 time', 0.233],
      ['q-bt-4', 'missed 1 time', 0.233],
      ['q-bt-5', 'missed 1 time', 0.233],
    ]);
  });

  it('sessions C, B, A with their wrong-answer counts', () => {
    const sessions = items.filter((i) => i.role === 'session');
    expect(sessions.map((s) => [s.nodeId, s.reason, s.weight])).toEqual([
      ['s-C', '2 wrong answers on these concepts', 0.333],
      ['s-B', '2 wrong answers on these concepts', 0.333],
      ['s-A', '4 wrong answers on these concepts', 0.5],
    ]);
    expect(items.some((i) => i.role === 'alternative')).toBe(false);
  });

  it('is never empty, and every weight is within 0 to 1 and every reason within 1 to 200 characters', () => {
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.weight).toBeGreaterThanOrEqual(0);
      expect(item.weight).toBeLessThanOrEqual(1);
      expect(item.reason.length).toBeGreaterThanOrEqual(1);
      expect(item.reason.length).toBeLessThanOrEqual(200);
    }
  });
});

describe('buildEvidence, other cases', () => {
  const concept = (id: string, over = {}) => ({
    conceptId: id,
    slug: id,
    name: id,
    score: 0.5,
    attempts: 1,
    lastSeen: 0,
    daysSince: 1,
    risk: 0.5,
    ...over,
  });

  it('alternatives get role alternative with weight 0.4 x rank / 2', () => {
    const selection: Selection = {
      kind: 'weak',
      target: concept('t', { risk: 1 }),
      drivers: [],
      alternatives: [concept('alt', { risk: 0.79 })],
    };
    const items = buildEvidence({ selection, answers: [], flags: [] });
    expect(items.map((i) => i.role)).toEqual(['target', 'alternative']);
    expect(items[1]).toMatchObject({ reason: 'also considered: risk 0.79', weight: 0.158 });
  });

  it('unseen and cold start targets use the unseen strength', () => {
    const base = {
      target: concept('t', { score: null, risk: null, daysSince: null }),
      drivers: [],
      alternatives: [],
    };
    const unseen = buildEvidence({
      selection: { ...base, kind: 'unseen' },
      answers: [],
      flags: [],
    });
    expect(unseen).toEqual([
      {
        label: 'Concept',
        nodeId: 't',
        role: 'target',
        reason: 'target: never practised',
        weight: 0.375,
      },
    ]);
    const cold = buildEvidence({
      selection: { ...base, kind: 'cold_start' },
      answers: [],
      flags: [],
    });
    expect(cold[0]).toMatchObject({
      reason: 'target: introductory concept with no prerequisites',
      weight: 0.375,
    });
  });

  it('tier 3 says how long ago the concept was practised', () => {
    const selection: Selection = {
      kind: 'all_mastered',
      target: concept('t', { daysSince: 12, risk: 0.2 }),
      drivers: [],
      alternatives: [],
    };
    expect(buildEvidence({ selection, answers: [], flags: [] })[0]!.reason).toBe(
      'target: practised longest ago (12 days)',
    );
  });

  it('counts a question that tests two concepts once per session', () => {
    const selection = workedSelection();
    const answers = [
      { conceptId: 'a', questionId: 'q', sessionId: 's', submittedAt: 10, misses: 1 },
      { conceptId: 'b', questionId: 'q', sessionId: 's', submittedAt: 10, misses: 1 },
    ];
    const items = buildEvidence({ selection, answers, flags: [] });
    expect(items.find((i) => i.role === 'answer')!.reason).toBe('missed 1 time');
    expect(items.find((i) => i.role === 'session')!.reason).toBe(
      '1 wrong answer on these concepts',
    );
  });
});
