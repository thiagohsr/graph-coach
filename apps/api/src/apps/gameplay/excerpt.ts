import { PASSAGE_EXCERPT_MAX } from '@coach/types';

/**
 * Collapses whitespace; returns the text unchanged when it fits in `max`; otherwise cuts at the last word boundary within
 * `max` and appends an ellipsis.
 *
 * With `around`, the window is centred on the first case-insensitive occurrence of that word (when found), cut on word
 * boundaries, with `…` on each cut side. The window body is at most `max - 1` characters, so the result is at most
 * `max + 1` characters even with both ellipses (the schema limit).
 */
export function excerpt(text: string, max: number = PASSAGE_EXCERPT_MAX, around?: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const needle = around?.replace(/\s+/g, ' ').trim();
  if (needle) {
    const found = windowAround(flat, needle, max - 1);
    if (found) return found;
  }
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(' ');
  const head = space > 0 && flat[max] !== ' ' ? cut.slice(0, space) : cut;
  return `${head.trimEnd()}…`;
}

function windowAround(flat: string, needle: string, size: number): string | null {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(escaped, 'i').exec(flat);
  if (!match || match[0].length > size) return null;
  const at = match.index;
  const end0 = at + match[0].length;
  let start = Math.max(0, Math.round(at + match[0].length / 2 - size / 2));
  let end = Math.min(flat.length, start + size);
  start = Math.max(0, end - size);
  // Snap to word boundaries without losing the match.
  if (start > 0 && flat[start - 1] !== ' ') {
    const next = flat.indexOf(' ', start);
    start = next === -1 || next + 1 > at ? Math.min(start, at) : next + 1;
  }
  if (end < flat.length && flat[end] !== ' ') {
    const prev = flat.lastIndexOf(' ', end);
    end = prev < end0 ? Math.max(end, end0) : prev;
  }
  const body = flat.slice(start, end).trim();
  return `${start > 0 ? '…' : ''}${body}${end < flat.length ? '…' : ''}`;
}
