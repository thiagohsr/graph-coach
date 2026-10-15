import { describe, expect, it } from 'vitest';
import { computeRisk, daysSince, round4 } from './risk';

const DAY = 86_400_000;

describe('computeRisk (plan worked example)', () => {
  it('b-trees 1.4456, indexes 0.7969, storage-pages 0.2818', () => {
    expect(round4(computeRisk(0.12005, 9, 14))).toBe(1.4456);
    expect(round4(computeRisk(0.2562455, 1, 14))).toBe(0.7969);
    expect(round4(computeRisk(0.8285, 9, 14))).toBe(0.2818);
  });
  it('caps the recency factor at 2', () => {
    expect(computeRisk(0, 100, 14)).toBe(2);
    expect(computeRisk(0.5, 14, 14)).toBe(1);
  });
});

describe('daysSince', () => {
  it('floors to whole days', () => {
    expect(daysSince(10 * DAY, 10 * DAY - (DAY - 1))).toBe(0);
    expect(daysSince(10 * DAY, 9 * DAY)).toBe(1);
    expect(daysSince(10 * DAY, 9 * DAY - 1)).toBe(1);
    expect(daysSince(10 * DAY, 1 * DAY)).toBe(9);
  });
});
