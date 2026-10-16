import type { MeDto } from '@coach/types';
import { describe, expect, it } from 'vitest';
import {
  ForbiddenError,
  guardSession,
  requireRole,
  requireSession,
  roleAtLeast,
  safeRedirect,
} from './guards';

const user: MeDto = {
  id: 'u1',
  name: 'Ada',
  email: 'ada@example.com',
  role: 'learner',
  status: 'active',
};

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error('expected a throw');
}

describe('roleAtLeast', () => {
  it('orders learner < reviewer < admin', () => {
    expect(roleAtLeast('learner', 'learner')).toBe(true);
    expect(roleAtLeast('learner', 'reviewer')).toBe(false);
    expect(roleAtLeast('learner', 'admin')).toBe(false);
    expect(roleAtLeast('reviewer', 'learner')).toBe(true);
    expect(roleAtLeast('reviewer', 'reviewer')).toBe(true);
    expect(roleAtLeast('reviewer', 'admin')).toBe(false);
    expect(roleAtLeast('admin', 'learner')).toBe(true);
    expect(roleAtLeast('admin', 'reviewer')).toBe(true);
    expect(roleAtLeast('admin', 'admin')).toBe(true);
  });
});

describe('safeRedirect', () => {
  it('accepts a same-site relative path with a query', () => {
    expect(safeRedirect('/coach?x=1')).toBe('/coach?x=1');
    expect(safeRedirect('/puzzles/abc/play')).toBe('/puzzles/abc/play');
  });

  it('rejects protocol-relative, absolute, and non-slash paths, falling back to /puzzles', () => {
    expect(safeRedirect('//evil')).toBe('/puzzles');
    expect(safeRedirect('https://evil')).toBe('/puzzles');
    expect(safeRedirect('coach')).toBe('/puzzles');
    expect(safeRedirect('/\\evil')).toBe('/puzzles');
    expect(safeRedirect('/ok\nSet-Cookie: x=1')).toBe('/puzzles');
    expect(safeRedirect('')).toBe('/puzzles');
    expect(safeRedirect(null)).toBe('/puzzles');
    expect(safeRedirect(undefined)).toBe('/puzzles');
  });

  it('accepts a custom fallback', () => {
    expect(safeRedirect('//evil', '/login')).toBe('/login');
  });
});

describe('requireSession', () => {
  it('returns the user for a signed-in session', () => {
    expect(requireSession(user, { pathname: '/coach' })).toBe(user);
  });

  it('redirects to /login carrying the current path and search', () => {
    expect(guardSession(null, { pathname: '/admin/user', search: '?page=2' })).toEqual({
      kind: 'redirect',
      to: '/login',
      search: { redirect: '/admin/user?page=2' },
    });
    const e = thrown(() => requireSession(null, { pathname: '/coach', search: '?goal=x' })) as {
      options: unknown;
    };
    expect(e.options).toMatchObject({ to: '/login', search: { redirect: '/coach?goal=x' } });
  });

  it('redirects to /blocked when the session says the account is blocked', () => {
    expect(guardSession({ blocked: true }, { pathname: '/coach' })).toEqual({
      kind: 'redirect',
      to: '/blocked',
    });
    const e = thrown(() => requireSession({ blocked: true }, { pathname: '/coach' })) as {
      options: unknown;
    };
    expect(e.options).toMatchObject({ to: '/blocked' });
  });
});

describe('requireRole', () => {
  it('passes for an equal or higher role and signals forbidden for a lower one', () => {
    expect(() => requireRole({ role: 'admin' }, 'admin')).not.toThrow();
    expect(() => requireRole({ role: 'admin' }, 'reviewer')).not.toThrow();
    expect(thrown(() => requireRole({ role: 'reviewer' }, 'admin'))).toBeInstanceOf(ForbiddenError);
    expect(thrown(() => requireRole({ role: 'learner' }, 'reviewer'))).toBeInstanceOf(
      ForbiddenError,
    );
  });
});
