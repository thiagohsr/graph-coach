import { describe, expect, it } from 'vitest';
import { splitSentences } from '@coach/types';
import { chunkText } from './chunker';
import { LONG_TEXT, SHORT_TEXT } from './testing/fixtures';

const DEFAULTS = { chunkSizeChars: 1200, chunkOverlapChars: 150 };
const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

describe('chunkText', () => {
  it('gives 5 to 10 chunks for the 1,000-word fixture with the default parameters', () => {
    expect(wordCount(LONG_TEXT)).toBeGreaterThan(900);
    const chunks = chunkText(LONG_TEXT, DEFAULTS);
    expect(chunks.length).toBeGreaterThanOrEqual(5);
    expect(chunks.length).toBeLessThanOrEqual(10);
  });

  it('never exceeds chunkSizeChars', () => {
    for (const size of [300, 600, 1200]) {
      for (const chunk of chunkText(LONG_TEXT, { chunkSizeChars: size, chunkOverlapChars: 100 })) {
        expect(chunk.text.length).toBeLessThanOrEqual(size);
      }
    }
  });

  it('numbers positions 0..n-1', () => {
    const chunks = chunkText(LONG_TEXT, DEFAULTS);
    expect(chunks.map((c) => c.position)).toEqual(chunks.map((_, i) => i));
  });

  it('ends every chunk on a sentence boundary when the text has one', () => {
    for (const chunk of chunkText(LONG_TEXT, DEFAULTS)) {
      expect(chunk.text.trimEnd()).toMatch(/[.!?]$/);
    }
  });

  it('shares up to chunkOverlapChars of whole sentences between consecutive chunks', () => {
    const chunks = chunkText(LONG_TEXT, DEFAULTS);
    let overlapping = 0;
    for (let i = 1; i < chunks.length; i += 1) {
      const previous = splitSentences(chunks[i - 1]!.text);
      const current = splitSentences(chunks[i]!.text);
      const shared: string[] = [];
      for (const sentence of current) {
        if (previous.includes(sentence)) shared.push(sentence);
        else break;
      }
      const sharedLength = shared.join(' ').length;
      expect(sharedLength).toBeLessThanOrEqual(DEFAULTS.chunkOverlapChars);
      if (shared.length > 0) overlapping += 1;
      // Whole sentences only: what is shared is a run of complete sentences at the start of the next chunk.
      expect(current.slice(0, shared.length)).toEqual(shared);
    }
    expect(overlapping).toBeGreaterThan(0);
  });

  it('covers every sentence of the text', () => {
    const joined = chunkText(LONG_TEXT, DEFAULTS)
      .map((c) => c.text)
      .join('\n');
    for (const sentence of splitSentences(LONG_TEXT)) expect(joined).toContain(sentence);
  });

  it('gives one chunk for a text that fits', () => {
    const chunks = chunkText('One short sentence. And another one.', DEFAULTS);
    expect(chunks).toEqual([{ position: 0, text: 'One short sentence. And another one.' }]);
  });

  it('gives nothing for an empty text', () => {
    expect(chunkText('  \n\n ', DEFAULTS)).toEqual([]);
  });

  it('merges a short tail into the previous chunk when it fits', () => {
    const sentence = 'This is a sentence of exactly fifty characters!!!!'; // 50 characters
    const body = Array.from({ length: 23 }, () => sentence).join(' '); // 23 * 50 + 22 = 1172
    const tail = 'Tiny tail here.';
    const chunks = chunkText(`${body} ${tail}`, { chunkSizeChars: 1200, chunkOverlapChars: 0 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text.endsWith(tail)).toBe(true);
  });

  it('keeps a short tail as its own chunk when merging would not fit', () => {
    const sentence = 'This is a sentence of exactly fifty characters!!!!';
    const body = Array.from({ length: 24 }, () => sentence).join(' '); // 1223 > 1200 so it needs two chunks
    const chunks = chunkText(`${body} Tiny tail here.`, {
      chunkSizeChars: 1200,
      chunkOverlapChars: 0,
    });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(1200);
  });

  it('splits a single sentence longer than the limit at a space', () => {
    const long = `${'word '.repeat(100).trim()}.`; // 500 characters
    const chunks = chunkText(long, { chunkSizeChars: 120, chunkOverlapChars: 0 });
    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(120);
      expect(chunk.text.startsWith(' ')).toBe(false);
      expect(chunk.text.endsWith(' ')).toBe(false);
    }
    expect(
      chunks
        .map((c) => c.text)
        .join(' ')
        .replace(/\s+/g, ' '),
    ).toBe(long);
  });

  it('prefers a paragraph break that falls in the last quarter of the chunk', () => {
    const para = (n: number, count: number) =>
      Array.from(
        { length: count },
        (_, i) => `Paragraph ${n} sentence number ${i + 1} is here.`,
      ).join(' ');
    // First paragraph ends close to the limit; the second starts right after.
    const first = para(1, 24); // about 1,150 characters
    const second = para(2, 10);
    const chunks = chunkText(`${first}\n\n${second}`, {
      chunkSizeChars: 1200,
      chunkOverlapChars: 0,
    });
    expect(chunks[0]!.text.endsWith('sentence number 24 is here.')).toBe(true);
    expect(chunks[1]!.text.startsWith('Paragraph 2')).toBe(true);
  });

  it('gives identical output for the same input twice', () => {
    expect(chunkText(LONG_TEXT, DEFAULTS)).toEqual(chunkText(LONG_TEXT, DEFAULTS));
  });

  it('honours other parameter values', () => {
    const small = chunkText(LONG_TEXT, { chunkSizeChars: 400, chunkOverlapChars: 0 });
    const large = chunkText(LONG_TEXT, { chunkSizeChars: 3000, chunkOverlapChars: 0 });
    expect(small.length).toBeGreaterThan(large.length);
    expect(large.length).toBeLessThanOrEqual(3);
    expect(
      chunkText(SHORT_TEXT, { chunkSizeChars: 800, chunkOverlapChars: 100 }).length,
    ).toBeGreaterThan(1);
  });

  it('always makes progress, even with an overlap larger than the chunk', () => {
    const chunks = chunkText(LONG_TEXT, { chunkSizeChars: 300, chunkOverlapChars: 5000 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.length).toBeLessThan(1000);
  });
});
