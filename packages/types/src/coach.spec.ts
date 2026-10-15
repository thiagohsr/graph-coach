import { describe, expect, it } from 'vitest';
import { CoachFlag, DecisionPathDto, RecommendationDto, RecommendationRequest } from './coach';

describe('RecommendationRequest', () => {
  it('accepts an empty body and a 3 to 280 character goal', () => {
    expect(RecommendationRequest.safeParse({}).success).toBe(true);
    expect(RecommendationRequest.safeParse({ goal: 'abc' }).success).toBe(true);
    expect(RecommendationRequest.safeParse({ goal: 'x'.repeat(280) }).success).toBe(true);
    expect(RecommendationRequest.safeParse({ goal: '  trimmed goal  ' }).success).toBe(true);
  });
  it('rejects a short goal, a long goal, and unknown fields', () => {
    expect(RecommendationRequest.safeParse({ goal: 'ab' }).success).toBe(false);
    expect(RecommendationRequest.safeParse({ goal: '  ab  ' }).success).toBe(false);
    expect(RecommendationRequest.safeParse({ goal: 'x'.repeat(281) }).success).toBe(false);
    expect(RecommendationRequest.safeParse({ learnerId: 'someone' }).success).toBe(false);
  });
});

describe('RecommendationDto', () => {
  const base = {
    decisionId: 'd1',
    puzzle: { id: 'p1', name: 'P' },
    target: { conceptId: 'c1', name: 'C' },
    summary: 'text',
    alternatives: [],
    flags: ['prerequisite_first'],
    reused: false,
  };
  it('requires reused and flags', () => {
    expect(RecommendationDto.safeParse(base).success).toBe(true);
    expect(RecommendationDto.safeParse({ ...base, reused: undefined }).success).toBe(false);
    expect(RecommendationDto.safeParse({ ...base, flags: undefined }).success).toBe(false);
  });
  it('accepts coverageGap with at least one concept only', () => {
    expect(
      RecommendationDto.safeParse({ ...base, coverageGap: { concepts: [{ conceptId: 'c1', name: 'C' }] } }).success,
    ).toBe(true);
    expect(RecommendationDto.safeParse({ ...base, coverageGap: { concepts: [] } }).success).toBe(false);
  });
});

describe('CoachFlag', () => {
  it('equals the flag table of contracts/coach-api.md', () => {
    expect([...CoachFlag.options].sort()).toEqual(
      [
        'prerequisite_first',
        'unseen',
        'decayed',
        'all_mastered',
        'cold_start',
        'coverage_gap',
        'no_puzzle',
        'repeat',
        'goal_unmatched',
        'coverage_requested',
        'coverage_not_requested',
      ].sort(),
    );
  });
});

describe('DecisionPathDto', () => {
  const node = { id: 'a', label: 'Concept', title: 'A', props: {} };
  it('accepts a known role and rejects an unknown one', () => {
    const edge = { from: 'a', to: 'b', type: 'BECAUSE', reason: 'r', weight: 0.5 };
    expect(DecisionPathDto.safeParse({ nodes: [node], edges: [{ ...edge, role: 'target' }], steps: ['x'] }).success).toBe(true);
    expect(DecisionPathDto.safeParse({ nodes: [node], edges: [{ ...edge, role: 'boss' }], steps: ['x'] }).success).toBe(false);
  });
});
