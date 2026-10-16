import type { MeDto } from '@coach/types';
import { describe, expect, it } from 'vitest';
import { authedBeforeLoad } from './_authed';

// Decision 11: the protected layout checks the session in its server-side beforeLoad.

const user: MeDto = { id: 'u1', name: 'Ada', email: 'ada@example.com', role: 'learner', status: 'active' };

function thrown(fn: () => unknown): { options: Record<string, unknown> } {
  try {
    fn();
  } catch (e) {
    return e as { options: Record<string, unknown> };
  }
  throw new Error('expected a throw');
}

describe('_authed beforeLoad', () => {
  it('signed out: redirects to /login carrying the requested route', () => {
    const e = thrown(() => authedBeforeLoad({ context: { session: null }, location: { pathname: '/puzzles', searchStr: '?q=1' } }));
    expect(e.options).toMatchObject({ to: '/login', search: { redirect: '/puzzles?q=1' } });
  });

  it('signed out, no search: the redirect carries the bare path', () => {
    const e = thrown(() => authedBeforeLoad({ context: { session: null }, location: { pathname: '/puzzles' } }));
    expect(e.options).toMatchObject({ to: '/login', search: { redirect: '/puzzles' } });
  });

  it('blocked account: redirects to /blocked', () => {
    const e = thrown(() => authedBeforeLoad({ context: { session: { blocked: true } }, location: { pathname: '/puzzles' } }));
    expect(e.options).toMatchObject({ to: '/blocked' });
  });

  it('signed in: puts the user in the route context', () => {
    expect(authedBeforeLoad({ context: { session: user }, location: { pathname: '/puzzles' } })).toEqual({ user });
  });
});
