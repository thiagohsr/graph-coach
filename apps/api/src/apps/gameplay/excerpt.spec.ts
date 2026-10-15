import { describe, expect, it } from 'vitest';
import { PASSAGE_EXCERPT_MAX } from '@coach/types';
import { excerpt } from './excerpt';

describe('excerpt', () => {
  it('returns short text unchanged', () => {
    expect(excerpt('A short passage.')).toBe('A short passage.');
  });

  it('collapses whitespace runs and newlines', () => {
    expect(excerpt('one  two\n\nthree\t four ')).toBe('one two three four');
  });

  it('cuts long text at a word boundary and ends with an ellipsis', () => {
    const text = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ');
    const out = excerpt(text);
    expect(out.endsWith('…')).toBe(true);
    const body = out.slice(0, -1);
    expect(body.length).toBeLessThanOrEqual(PASSAGE_EXCERPT_MAX);
    expect(text.startsWith(body)).toBe(true);
    expect(text[body.length]).toBe(' ');
  });

  it('hard-cuts a single very long word at the maximum', () => {
    const out = excerpt('x'.repeat(400));
    expect(out).toBe(`${'x'.repeat(PASSAGE_EXCERPT_MAX)}…`);
  });

  it('returns an empty string for empty text', () => {
    expect(excerpt('')).toBe('');
    expect(excerpt('  \n ')).toBe('');
  });
});
