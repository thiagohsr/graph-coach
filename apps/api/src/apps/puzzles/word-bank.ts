import { randomInt } from 'node:crypto';
import { normaliseWord } from '@coach/types';

/**
 * The word bank of a play payload: trim, drop empties, sort by code unit, dedupe on `normaliseWord` (first kept), then
 * Fisher-Yates with `rng`. A set of distinct words, never a multiset: words are reusable (reconciliation D5), so no
 * count per word is kept and repetition cannot reveal an answer.
 */
export function buildWordBank(
  words: string[],
  rng: (upperExclusive: number) => number = (n) => randomInt(n),
): string[] {
  const sorted = words
    .map((w) => w.trim())
    .filter((w) => w !== '')
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const seen = new Set<string>();
  const bank: string[] = [];
  for (const word of sorted) {
    const key = normaliseWord(word);
    if (seen.has(key)) continue;
    seen.add(key);
    bank.push(word);
  }
  for (let i = bank.length - 1; i > 0; i -= 1) {
    const j = rng(i + 1);
    [bank[i], bank[j]] = [bank[j]!, bank[i]!];
  }
  return bank;
}
