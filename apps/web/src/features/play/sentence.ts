import type { PlayQuestion } from '~/lib/api/gameplay-schemas';

export const BLANK_MARKER = '___';

export type Segment = { kind: 'text'; text: string } | { kind: 'blank'; index: number };

export type SplitResult = { ok: true; segments: Segment[] } | { ok: false; error: string };

/** Splits a sentence on `___` into text and blank segments (blank indexes are zero-based). */
export function splitSentence(sentence: string, blanks: number): SplitResult {
  const parts = sentence.split(BLANK_MARKER);
  const found = parts.length - 1;
  if (found !== blanks) {
    return { ok: false, error: `Sentence has ${found} blank${found === 1 ? '' : 's'} but the puzzle says ${blanks}.` };
  }
  const segments: Segment[] = [];
  parts.forEach((text, i) => {
    if (text !== '') segments.push({ kind: 'text', text });
    if (i < blanks) segments.push({ kind: 'blank', index: i });
  });
  return { ok: true, segments };
}

/** The first question whose sentence does not match its blank count, or null (data-model §1.6). */
export function findSentenceMismatch(questions: PlayQuestion[]): string | null {
  for (const q of questions) {
    const result = splitSentence(q.sentence, q.blanks);
    if (!result.ok) return result.error;
  }
  return null;
}
