import { describe, expect, it } from 'vitest';
import { foldMastery, updateMastery } from './mastery';

describe('updateMastery', () => {
  it('starts an unseen concept at 0.5', () => {
    expect(updateMastery(undefined, 1, 0.3)).toBeCloseTo(0.65);
    expect(updateMastery(null, 0, 0.3)).toBeCloseTo(0.35);
  });

  it('moves strictly between prev and outcome for 0 < alpha < 1', () => {
    for (const prev of [0.1, 0.5, 0.9]) {
      for (const alpha of [0.1, 0.3, 0.9]) {
        const up = updateMastery(prev, 1, alpha);
        const down = updateMastery(prev, 0, alpha);
        expect(up).toBeGreaterThan(prev);
        expect(up).toBeLessThan(1);
        expect(down).toBeLessThan(prev);
        expect(down).toBeGreaterThan(0);
      }
    }
  });

  it('alpha = 1 returns the outcome', () => {
    expect(updateMastery(0.4, 1, 1)).toBe(1);
    expect(updateMastery(0.4, 0, 1)).toBe(0);
  });

  it('throws RangeError for alpha <= 0 or > 1', () => {
    expect(() => updateMastery(0.5, 1, 0)).toThrow(RangeError);
    expect(() => updateMastery(0.5, 1, -0.1)).toThrow(RangeError);
    expect(() => updateMastery(0.5, 1, 1.1)).toThrow(RangeError);
  });

  it('clamps to [0, 1]', () => {
    expect(updateMastery(2, 1, 0.5)).toBe(1);
    expect(updateMastery(-1, 0, 0.5)).toBe(0);
  });
});

describe('foldMastery', () => {
  it('folds in order and counts attempts', () => {
    const a = foldMastery(undefined, [1, 0], 0.3);
    expect(a.before).toBe(0.5);
    expect(a.after).toBeCloseTo(0.455);
    expect(a.attempts).toBe(2);
    const b = foldMastery(undefined, [0, 1], 0.3);
    expect(b.after).toBeCloseTo(0.545);
  });

  it('adds attempts to the previous count and starts from the previous score', () => {
    const r = foldMastery({ score: 0.8, attempts: 4 }, [1], 0.3);
    expect(r.before).toBe(0.8);
    expect(r.attempts).toBe(5);
    expect(r.after).toBeCloseTo(0.86);
  });

  it('throws on empty outcomes', () => {
    expect(() => foldMastery(undefined, [], 0.3)).toThrow();
  });
});
