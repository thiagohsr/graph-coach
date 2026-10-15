import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CODE_ALPHABET, generateCode, hashCode, normalizeCode } from './code-format';

describe('generateCode', () => {
  it('returns GC- plus four groups of five symbols from the alphabet', () => {
    const code = generateCode();
    expect(code).toMatch(/^GC-([0-9A-Z]{5}-){3}[0-9A-Z]{5}$/);
    for (const char of code.slice(3).replaceAll('-', '')) expect(CODE_ALPHABET).toContain(char);
    expect(CODE_ALPHABET).toHaveLength(32);
    expect(new Set(CODE_ALPHABET).size).toBe(32);
    for (const banned of 'ILOU') expect(CODE_ALPHABET).not.toContain(banned);
  });

  it('differs on each call', () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateCode()));
    expect(codes.size).toBe(200);
  });
});

describe('normalizeCode', () => {
  const plain = '0123456789ABCDEFGHJK';

  it('upper-cases and strips spaces, hyphens, and the GC prefix', () => {
    expect(normalizeCode('GC-01234-56789-ABCDE-FGHJK')).toBe(plain);
    expect(normalizeCode('gc 01234 56789 abcde fghjk')).toBe(plain);
    expect(normalizeCode('0123456789abcdefghjk')).toBe(plain);
    expect(normalizeCode('  gc-0123456789ABCDEFGHJK ')).toBe(plain);
  });

  it('keeps a first pair of symbols that spells GC when there is no prefix', () => {
    expect(normalizeCode('GC234567890ABCDEFGHJ')).toBe('GC234567890ABCDEFGHJ');
  });

  it('maps O to 0 and I or L to 1', () => {
    expect(normalizeCode('GC-O1234-56789-ABCDE-FGHJK')).toBe(plain);
    expect(normalizeCode('GC-0I234-56789-ABCDE-FGHJK')).toBe('01234' + '56789ABCDEFGHJK');
    expect(normalizeCode('GC-0L234-56789-ABCDE-FGHJK')).toBe('01234' + '56789ABCDEFGHJK');
  });

  it('rejects other lengths and symbols', () => {
    expect(normalizeCode('')).toBeNull();
    expect(normalizeCode('GC-01234-56789-ABCDE-FGHJ')).toBeNull();
    expect(normalizeCode('GC-01234-56789-ABCDE-FGHJKM')).toBeNull();
    expect(normalizeCode('GC-01234-56789-ABCDE-FGHJU')).toBeNull();
    expect(normalizeCode('GC-01234-56789-ABCDE-FGHJ!')).toBeNull();
  });

  it('round-trips a generated code', () => {
    const code = generateCode();
    expect(normalizeCode(code)).toBe(code.slice(3).replaceAll('-', ''));
    expect(normalizeCode(code.toLowerCase())).toBe(normalizeCode(code));
  });
});

describe('hashCode', () => {
  it('is the lower-case hex SHA-256 of the normalised code', () => {
    const normalized = normalizeCode('GC-01234-56789-ABCDE-FGHJK')!;
    expect(hashCode(normalized)).toBe(createHash('sha256').update(normalized).digest('hex'));
    expect(hashCode(normalized)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is equal for differently typed forms of one code and different for different codes', () => {
    const a = hashCode(normalizeCode('GC-01234-56789-ABCDE-FGHJK')!);
    const b = hashCode(normalizeCode('gc o1234 56789 abcde fghjk')!);
    const c = hashCode(normalizeCode('GC-01234-56789-ABCDE-FGHJM')!);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
