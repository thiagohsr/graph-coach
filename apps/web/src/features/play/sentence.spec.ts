import { describe, expect, it } from 'vitest';
import { findSentenceMismatch, splitSentence } from './sentence';

describe('splitSentence', () => {
  it('splits on ___ into text and blank segments', () => {
    expect(splitSentence('A ___ speeds up ___.', 2)).toEqual({
      ok: true,
      segments: [
        { kind: 'text', text: 'A ' },
        { kind: 'blank', index: 0 },
        { kind: 'text', text: ' speeds up ' },
        { kind: 'blank', index: 1 },
        { kind: 'text', text: '.' },
      ],
    });
  });

  it('handles blanks at the start and the end', () => {
    expect(splitSentence('___ is ___', 2)).toEqual({
      ok: true,
      segments: [
        { kind: 'blank', index: 0 },
        { kind: 'text', text: ' is ' },
        { kind: 'blank', index: 1 },
      ],
    });
  });

  it('returns an error result when the count does not match', () => {
    const result = splitSentence('Only one ___ here.', 2);
    expect(result.ok).toBe(false);
  });

  it('accepts a sentence with no blank when none are declared', () => {
    expect(splitSentence('No blanks.', 0)).toEqual({ ok: true, segments: [{ kind: 'text', text: 'No blanks.' }] });
  });
});

describe('findSentenceMismatch', () => {
  it('is null when every question matches and a message otherwise', () => {
    expect(findSentenceMismatch([{ id: 'q', order: 1, sentence: 'a ___', blanks: 1 }])).toBeNull();
    expect(findSentenceMismatch([{ id: 'q', order: 1, sentence: 'a ___', blanks: 2 }])).toMatch(/blank/);
  });
});
