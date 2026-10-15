// Mirror of the risk formula in the Cypher queries (reconciliation F1). The Cypher value is the one used at run time.
import { DAY_MS } from './constants';

/** Whole days between two epoch-millisecond times (floor). */
export function daysSince(now: number, lastSeen: number): number {
  return Math.floor((now - lastSeen) / DAY_MS);
}

/** risk = (1 - score) x min(1 + days / decayDays, 2) */
export function computeRisk(score: number, days: number, decayDays: number): number {
  return (1 - score) * Math.min(1 + days / decayDays, 2);
}

export function round4(n: number): number {
  // EPSILON keeps exact halves such as 0.28175 from rounding down on float error (the plan's table says 0.2818).
  return Math.round((n + Number.EPSILON) * 10_000) / 10_000;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
