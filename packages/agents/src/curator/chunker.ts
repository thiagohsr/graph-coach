// A small pure chunker (research R3): no text-splitter dependency. Same text and parameters always give the same list.
import { splitSentences } from '@coach/types';
import { CHUNK_MIN_CHARS } from './constants';

export interface ChunkDraft {
  position: number;
  text: string;
}

interface Unit {
  text: string;
  /** The unit ends a paragraph. */
  paraEnd: boolean;
}

const separator = (unit: Unit) => (unit.paraEnd ? '\n\n' : ' ');

/** A single sentence longer than the limit is split at the last space before it. */
function splitLong(sentence: string, size: number): string[] {
  const pieces: string[] = [];
  let rest = sentence;
  while (rest.length > size) {
    let cut = rest.lastIndexOf(' ', size);
    if (cut <= 0) cut = size;
    pieces.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest !== '') pieces.push(rest);
  return pieces;
}

function toUnits(plainText: string, size: number): Unit[] {
  const units: Unit[] = [];
  for (const paragraph of plainText.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/)) {
    const pieces = splitSentences(paragraph).flatMap((sentence) => splitLong(sentence, size));
    pieces.forEach((text, index) => units.push({ text, paraEnd: index === pieces.length - 1 }));
  }
  return units;
}

/**
 * Chunks end at the last sentence end that fits `chunkSizeChars`; a paragraph break is preferred when it falls in the
 * last quarter of the chunk. The next chunk starts with the trailing whole sentences of the previous one, up to
 * `chunkOverlapChars`. A final piece smaller than CHUNK_MIN_CHARS is merged into the previous chunk when the result
 * still fits.
 */
export function chunkText(
  plainText: string,
  params: { chunkSizeChars: number; chunkOverlapChars: number },
): ChunkDraft[] {
  const size = Math.max(1, Math.floor(params.chunkSizeChars));
  const overlap = Math.max(0, Math.min(Math.floor(params.chunkOverlapChars), size - 1));
  const units = toUnits(plainText, size);
  if (units.length === 0) return [];

  const lengthOf = (start: number, end: number): number => {
    let total = 0;
    for (let i = start; i < end; i += 1)
      total += units[i]!.text.length + (i < end - 1 ? separator(units[i]!).length : 0);
    return total;
  };
  const textOf = (start: number, end: number): string => {
    let out = '';
    for (let i = start; i < end; i += 1)
      out += units[i]!.text + (i < end - 1 ? separator(units[i]!) : '');
    return out;
  };

  const ranges: Array<[number, number]> = [];
  let start = 0;
  while (start < units.length) {
    let end = start;
    let length = 0;
    while (end < units.length) {
      const added = units[end]!.text.length + (end > start ? separator(units[end - 1]!).length : 0);
      if (end > start && length + added > size) break;
      length += added;
      end += 1;
    }

    if (end < units.length) {
      for (let k = end - 1; k > start; k -= 1) {
        if (units[k - 1]!.paraEnd && lengthOf(start, k) >= 0.75 * length) {
          end = k;
          break;
        }
      }
    }
    ranges.push([start, end]);
    if (end >= units.length) break;

    let next = end;
    let carried = 0;
    while (next - 1 > start) {
      const add =
        units[next - 1]!.text.length + (carried > 0 ? separator(units[next - 1]!).length : 0);
      if (carried + add > overlap) break;
      carried += add;
      next -= 1;
    }
    while (next < end && lengthOf(next, end + 1) > size) next += 1;
    start = next;
  }

  if (ranges.length >= 2) {
    const last = ranges[ranges.length - 1]!;
    const previous = ranges[ranges.length - 2]!;
    if (
      lengthOf(previous[1], last[1]) < CHUNK_MIN_CHARS &&
      lengthOf(previous[0], last[1]) <= size
    ) {
      ranges.splice(ranges.length - 2, 2, [previous[0], last[1]]);
    }
  }

  return ranges.map(([s, e], position) => ({ position, text: textOf(s, e) }));
}
