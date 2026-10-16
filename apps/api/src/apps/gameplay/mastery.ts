// Mastery. Pure: no framework imports.
//
// THE ONLY implementation of the mastery formula (constitution Principle III). Nothing else, in TypeScript or Cypher,
// computes mastery; the queries only store the absolute values computed here.
//
//   mastery' = clamp01(p + alpha * (outcome - p))      p = previous score, or 0.5 (UNSEEN_MASTERY) if never practised
//
// outcome is 1 for a correct blank and 0 for an incorrect or empty one; alpha comes from the `masteryAlpha` setting
// (default 0.3, must be in (0, 1]). Every concept a question tests receives the outcome of each of its blanks.
import { UNSEEN_MASTERY } from '@coach/types';
import type { MasteryState } from './gameplay.dto';

export function updateMastery(
  prev: number | null | undefined,
  outcome: 0 | 1,
  alpha: number,
): number {
  if (!(alpha > 0 && alpha <= 1)) throw new RangeError(`alpha must be in (0, 1], got ${alpha}`);
  const p = prev ?? UNSEEN_MASTERY;
  return Math.min(1, Math.max(0, p + alpha * (outcome - p)));
}

/** Applies updateMastery once per outcome, in array order. attempts adds the number of outcomes. */
export function foldMastery(
  prev: MasteryState | undefined,
  outcomes: (0 | 1)[],
  alpha: number,
): { before: number; after: number; attempts: number } {
  if (outcomes.length === 0) throw new Error('foldMastery needs at least one outcome');
  const before = prev?.score ?? UNSEEN_MASTERY;
  let after = before;
  for (const outcome of outcomes) after = updateMastery(after, outcome, alpha);
  return { before, after, attempts: (prev?.attempts ?? 0) + outcomes.length };
}
