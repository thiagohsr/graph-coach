import { PASSAGE_EXCERPT_MAX } from '@coach/types';

/**
 * Collapses whitespace; returns the text unchanged when it fits in `max`; otherwise cuts at the last word boundary within
 * `max` and appends an ellipsis. (The optional `around` window is a stretch item and not implemented here.)
 */
export function excerpt(text: string, max: number = PASSAGE_EXCERPT_MAX): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(' ');
  const head = space > 0 && flat[max] !== ' ' ? cut.slice(0, space) : cut;
  return `${head.trimEnd()}…`;
}
