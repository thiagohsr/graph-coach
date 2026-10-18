/**
 * Deterministic repair of the one formatting mistake small models make most: the blank marker. A model asked for
 * three underscores often writes four or more (`_____`) or forgets the marker and leaves the answer in the sentence.
 * Neither changes the meaning, so both are fixed before validation instead of discarding the draft:
 *  1. every run of two or more underscores becomes exactly `___`;
 *  2. a sentence with no blank at all gets its answers, in order, replaced by `___` where each one first appears as a
 *     whole word (case-insensitive); the sentence is left as it was unless every answer was found.
 * Nothing else is touched, and validation still runs on the result (including the answer-leak check).
 */
const BLANK = '___';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function repairBlanks(sentence: string, answers: readonly string[]): string {
  const normalised = sentence.replace(/_{2,}/g, BLANK);
  if (normalised.includes(BLANK) || answers.length === 0) return normalised;

  let repaired = normalised;
  let from = 0;
  for (const answer of answers) {
    const trimmed = answer.trim();
    if (trimmed === '') return normalised;
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}])${escapeRegExp(trimmed)}(?![\\p{L}\\p{N}])`,
      'iu',
    );
    const match = pattern.exec(repaired.slice(from));
    if (!match) return normalised;
    const start = from + match.index;
    repaired = repaired.slice(0, start) + BLANK + repaired.slice(start + match[0].length);
    from = start + BLANK.length;
  }
  return repaired;
}
