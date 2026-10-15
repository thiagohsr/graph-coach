import { describe, expect, it } from 'vitest';
import { fingerprint } from './fingerprint';

describe('fingerprint', () => {
  const text = 'A database index speeds up lookups.\nIt keeps keys sorted.';

  it('is 64 hex characters', () => {
    expect(fingerprint(text)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is the same text twice', () => {
    expect(fingerprint(text)).toBe(fingerprint(text));
  });

  it('ignores whitespace differences: CRLF, tabs, runs of spaces, ends', () => {
    const noisy = '  A database index   speeds up\tlookups.\r\nIt keeps keys sorted.  \n';
    expect(fingerprint(noisy)).toBe(fingerprint(text));
  });

  it('changes with one word', () => {
    expect(fingerprint(text.replace('sorted', 'ordered'))).not.toBe(fingerprint(text));
  });

  it('changes with one letter of case', () => {
    expect(fingerprint(text.replace('A database', 'a database'))).not.toBe(fingerprint(text));
  });
});
