import { describe, expect, it } from 'vitest';
import { isNearDuplicate, sentenceSimilarity } from './similarity';

describe('sentence similarity', () => {
  it('treats the same sentence, with other case, punctuation, or blank marker, as a duplicate', () => {
    expect(
      isNearDuplicate(
        'A call number is the ___ on a spine.',
        'a call number is the code on a spine',
      ),
    ).toBe(true);
  });

  it('treats a one-word rephrase of a short sentence as a duplicate', () => {
    expect(
      isNearDuplicate(
        'Each ___ lists the date and the price of an item',
        'Each ___ lists the date and the cost of an item',
      ),
    ).toBe(true);
  });

  it('keeps two different facts apart', () => {
    const a = 'A call number is the short code printed on the spine of a book.';
    const b = 'The accession register is the ledger in which every new item is written down.';
    expect(sentenceSimilarity(a, b)).toBeLessThan(0.3);
    expect(isNearDuplicate(a, b)).toBe(false);
  });
});
