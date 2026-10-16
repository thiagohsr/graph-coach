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

  describe('around', () => {
    const words = Array.from({ length: 300 }, (_, i) => `w${i}`);
    const make = (at: number) => words.map((w, i) => (i === at ? 'Mitochondria' : w)).join(' ');

    it('centres on the first case-insensitive occurrence, with an ellipsis on both cut sides', () => {
      const text = make(150);
      const out = excerpt(text, PASSAGE_EXCERPT_MAX, 'mitochondria');
      expect(out.startsWith('…')).toBe(true);
      expect(out.endsWith('…')).toBe(true);
      expect(out).toContain('Mitochondria');
      expect(out.length).toBeLessThanOrEqual(PASSAGE_EXCERPT_MAX + 1);
      const body = out.slice(1, -1);
      expect(text).toContain(body);
      const centre = body.indexOf('Mitochondria') + 6;
      expect(Math.abs(centre - body.length / 2)).toBeLessThan(40);
    });

    it('only adds the ellipsis on the cut side when the match is near the start', () => {
      const out = excerpt(make(1), PASSAGE_EXCERPT_MAX, 'MITOCHONDRIA');
      expect(out.startsWith('…')).toBe(false);
      expect(out.startsWith('w0 Mitochondria w2')).toBe(true);
      expect(out.endsWith('…')).toBe(true);
    });

    it('only adds the ellipsis on the cut side when the match is near the end', () => {
      const out = excerpt(make(298), PASSAGE_EXCERPT_MAX, 'mitochondria');
      expect(out.startsWith('…')).toBe(true);
      expect(out.endsWith('…')).toBe(false);
      expect(out.endsWith('w299')).toBe(true);
    });

    it('falls back to the head when the word is absent or empty', () => {
      const text = make(150);
      expect(excerpt(text, PASSAGE_EXCERPT_MAX, 'zzz')).toBe(excerpt(text));
      expect(excerpt(text, PASSAGE_EXCERPT_MAX, '')).toBe(excerpt(text));
    });

    it('returns short text unchanged and treats regex characters literally', () => {
      expect(excerpt('a b c', PASSAGE_EXCERPT_MAX, 'b')).toBe('a b c');
      expect(excerpt(make(150), PASSAGE_EXCERPT_MAX, '.*')).toBe(excerpt(make(150)));
    });
  });

  it('returns an empty string for empty text', () => {
    expect(excerpt('')).toBe('');
    expect(excerpt('  \n ')).toBe('');
  });
});
