import { describe, expect, it } from 'vitest';
import { buildWordBank } from './word-bank';

const zero = () => 0;

describe('buildWordBank', () => {
  it('is a permutation of the deduplicated input', () => {
    const bank = buildWordBank(['b', 'a', 'c', 'a']);
    expect([...bank].sort()).toEqual(['a', 'b', 'c']);
  });

  it('trims and drops empty strings', () => {
    expect([...buildWordBank(['  x ', '', '   ', 'y'])].sort()).toEqual(['x', 'y']);
  });

  it('dedupes on normaliseWord', () => {
    const bank = buildWordBank(['Index', 'index', ' INDEX ']);
    expect(bank).toHaveLength(1);
  });

  it('gives the expected Fisher-Yates order for a fixed rng', () => {
    // sorted: a b c d ; rng always 0: i=3 swap(3,0) -> d b c a ; i=2 swap(2,0) -> c b d a ; i=1 swap(1,0) -> b c d a
    expect(buildWordBank(['d', 'c', 'b', 'a'], zero)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('different rng sequences give different orders', () => {
    const words = ['a', 'b', 'c', 'd', 'e'];
    const last = (n: number) => n - 1;
    expect(buildWordBank(words, zero)).not.toEqual(buildWordBank(words, last));
  });

  it('does not depend on input order', () => {
    expect(buildWordBank(['c', 'a', 'b'], zero)).toEqual(buildWordBank(['a', 'b', 'c'], zero));
  });

  it('lists a word given three times once (words are reusable, no counts)', () => {
    const bank = buildWordBank(['index', 'index', 'index', 'heap']);
    expect(bank.filter((w) => w === 'index')).toHaveLength(1);
    expect(bank).toHaveLength(2);
    expect(bank.every((w) => typeof w === 'string')).toBe(true);
  });
});
