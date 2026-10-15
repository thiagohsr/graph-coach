import { describe, expect, it } from 'vitest';
import { isProbableDuplicate, slugify } from './slug';

describe('slugify', () => {
  it('lower-cases and joins words with hyphens', () => {
    expect(slugify('B-Tree Index')).toBe('b-tree-index');
  });

  it('turns & into and', () => {
    expect(slugify('Pages & Buffer Pool')).toBe('pages-and-buffer-pool');
  });

  it('strips diacritics', () => {
    expect(slugify('Índices Compostos')).toBe('indices-compostos');
    expect(slugify('naïve café')).toBe('naive-cafe');
  });

  it('collapses punctuation and trims hyphens', () => {
    expect(slugify('  --What is (a) join?!--  ')).toBe('what-is-a-join');
  });

  it('cuts to 64 characters without a trailing hyphen', () => {
    const slug = slugify('a '.repeat(60) + 'end');
    expect(slug.length).toBeLessThanOrEqual(64);
    expect(slug.endsWith('-')).toBe(false);
    expect(slugify('x'.repeat(100))).toHaveLength(64);
  });

  it('gives an empty string when nothing is left', () => {
    expect(slugify('???')).toBe('');
    expect(slugify('')).toBe('');
    expect(slugify('日本語')).toBe('');
  });
});

describe('isProbableDuplicate', () => {
  it('is true for plural and singular', () => {
    expect(isProbableDuplicate('b-tree-index', 'b-tree-indexes')).toBe(true);
    expect(isProbableDuplicate('table', 'tables')).toBe(true);
    expect(isProbableDuplicate('foreign-key', 'foreign-keys')).toBe(true);
  });

  it('is true for the same words in another order', () => {
    expect(isProbableDuplicate('index-b-tree', 'b-tree-index')).toBe(true);
    expect(isProbableDuplicate('buffer-pool', 'pool-buffer')).toBe(true);
  });

  it('is true for near-identical long slugs', () => {
    expect(isProbableDuplicate('transaction-isolation-levels', 'transaction-isolation-level')).toBe(
      true,
    );
    expect(isProbableDuplicate('write-ahead-logging', 'write-ahead-loging')).toBe(true);
  });

  it('is true for equal slugs', () => {
    expect(isProbableDuplicate('index', 'index')).toBe(true);
  });

  it('is false for unrelated slugs', () => {
    expect(isProbableDuplicate('b-tree', 'hash-index')).toBe(false);
    expect(isProbableDuplicate('replication', 'sharding')).toBe(false);
    expect(isProbableDuplicate('primary-key', 'foreign-key')).toBe(false);
  });

  it('does not use edit similarity for short slugs', () => {
    expect(isProbableDuplicate('sql', 'sqk')).toBe(false);
    expect(isProbableDuplicate('index', 'indez')).toBe(false);
  });

  it('is false for empty slugs', () => {
    expect(isProbableDuplicate('', 'index')).toBe(false);
  });
});
