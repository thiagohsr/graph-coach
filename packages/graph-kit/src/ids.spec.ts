import { describe, expect, it } from 'vitest';
import { deterministicId, newId, toEpochMs, toIso } from './ids';

const LAYOUT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('deterministicId', () => {
  it('gives the same id for the same parts', () => {
    expect(deterministicId('concept', 'sql')).toBe(deterministicId('concept', 'sql'));
  });

  it('gives different ids for different parts', () => {
    expect(deterministicId('concept', 'sql')).not.toBe(deterministicId('concept', 'sqm'));
    expect(deterministicId('a', 'b')).not.toBe(deterministicId('b', 'a'));
  });

  it('matches the UUID layout', () => {
    expect(deterministicId('puzzle', 'storage-and-b-trees')).toMatch(LAYOUT);
  });

  it('joins parts with a colon', () => {
    expect(deterministicId('a', 'b')).toBe(deterministicId('a:b'));
  });
});

describe('newId', () => {
  it('returns a fresh UUID each time', () => {
    const a = newId();
    expect(a).toMatch(LAYOUT);
    expect(newId()).not.toBe(a);
  });
});

describe('time helpers', () => {
  it('round-trips toIso(toEpochMs(x))', () => {
    const iso = '2026-10-11T12:34:56.789Z';
    expect(toIso(toEpochMs(iso))).toBe(iso);
  });

  it('accepts Date, ISO string, and number', () => {
    const ms = 1_760_000_000_000;
    expect(toEpochMs(new Date(ms))).toBe(ms);
    expect(toEpochMs(ms)).toBe(ms);
    expect(toEpochMs(new Date(ms).toISOString())).toBe(ms);
  });

  it('rejects an invalid time', () => {
    expect(() => toEpochMs('not a date')).toThrow(RangeError);
  });
});
