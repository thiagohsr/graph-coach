import { NEAR_DUPLICATE_SIMILARITY } from '../constants';

/** Lower-cased words of a sentence, without punctuation and without the blank marker. */
export function sentenceTokens(sentence: string): Set<string> {
  return new Set(
    sentence
      .toLowerCase()
      .replace(/_+/gu, ' ')
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word !== ''),
  );
}

/** Jaccard overlap of the word sets of two sentences (0 to 1). */
export function sentenceSimilarity(a: string, b: string): number {
  const left = sentenceTokens(a);
  const right = sentenceTokens(b);
  if (left.size === 0 && right.size === 0) return 1;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** Identical after normalising, or overlapping by `NEAR_DUPLICATE_SIMILARITY` or more. */
export function isNearDuplicate(a: string, b: string): boolean {
  return sentenceSimilarity(a, b) >= NEAR_DUPLICATE_SIMILARITY;
}
