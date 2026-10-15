import { describe, expect, it } from 'vitest';
import {
  assertIdentifier,
  isForbiddenLabel,
  isSensitiveName,
  isValidHref,
  isValidLabel,
  isValidProperty,
  isValidRelType,
  isValidSlug,
  isValidSqlName,
  queryNameSegment,
} from './identifiers';

const HOSTILE = ['a b', "a'b", 'a`b', 'a;b', 'a:b', 'a.b', '', '1abc', 'a"b', 'a\nb', 'a)b'];

describe('identifier patterns', () => {
  it('accept the canonical names', () => {
    expect(isValidLabel('Concept')).toBe(true);
    expect(isValidProperty('createdAt')).toBe(true);
    expect(isValidRelType('PREREQUISITE_OF')).toBe(true);
    expect(isValidSqlName('admin_settings')).toBe(true);
    expect(isValidSlug('admin-setting')).toBe(true);
    expect(isValidHref('/decisions/:id')).toBe(true);
  });

  it.each(HOSTILE)('reject %j everywhere', (value) => {
    for (const check of [isValidLabel, isValidProperty, isValidRelType, isValidSqlName, isValidSlug, isValidHref]) {
      expect(check(value)).toBe(false);
    }
  });

  it('reject a hyphen where it is not allowed and a 64-character name', () => {
    expect(isValidLabel('Con-cept')).toBe(false);
    expect(isValidProperty('created-at')).toBe(false);
    expect(isValidSqlName('admin-settings')).toBe(false);
    expect(isValidProperty('a'.repeat(64))).toBe(false);
    expect(isValidProperty('a'.repeat(63))).toBe(true);
    expect(isValidSlug('a'.repeat(41))).toBe(false);
  });

  it('slug pattern rejects malformed slugs', () => {
    for (const slug of ['a--b', 'a-', '-a', 'a_b', 'Admin']) expect(isValidSlug(slug)).toBe(false);
  });

  it('href needs exactly one :id', () => {
    expect(isValidHref('/decisions')).toBe(false);
    expect(isValidHref('/:id/x/:id')).toBe(false);
    expect(isValidHref('/a/:id/b')).toBe(true);
    expect(isValidHref('/a?x=1/:id')).toBe(false);
  });

  it('assertIdentifier throws on an invalid value and returns a valid one', () => {
    expect(assertIdentifier('label', 'Concept')).toBe('Concept');
    expect(() => assertIdentifier('property', 'n) DETACH DELETE n //')).toThrow();
  });
});

describe('queryNameSegment', () => {
  it('converts slugs and camelCase names', () => {
    expect(queryNameSegment('producedConcepts')).toBe('produced_concepts');
    expect(queryNameSegment('admin-setting')).toBe('admin_setting');
    expect(queryNameSegment('concept')).toBe('concept');
  });
});

describe('isSensitiveName', () => {
  it.each([
    'cognito_sub',
    'cognitoSub',
    'code_hash',
    'codeHash',
    'code',
    'brief',
    'outline',
    'password_hash',
    'PASSWORD-HASH',
    'embedding',
    'content',
    'answers',
    'distractors',
    'token',
  ])('flags %s', (name) => expect(isSensitiveName(name)).toBe(true));

  it.each(['name', 'description', 'email', 'displayName', 'title', 'status'])('allows %s', (name) =>
    expect(isSensitiveName(name)).toBe(false),
  );
});

describe('isForbiddenLabel', () => {
  it('is true for Chunk and Question only', () => {
    expect(isForbiddenLabel('Chunk')).toBe(true);
    expect(isForbiddenLabel('Question')).toBe(true);
    for (const label of ['Concept', 'Source', 'Puzzle', 'Task', 'Decision', 'Learner']) {
      expect(isForbiddenLabel(label)).toBe(false);
    }
  });
});
