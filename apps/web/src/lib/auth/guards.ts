import type { MeDto, Role } from '@coach/types';
import { redirect } from '@tanstack/react-router';

/** What `getSessionFn` returns: the user, a blocked marker, or nothing. */
export type SessionState = MeDto | { blocked: true } | null;

export const DEFAULT_REDIRECT = '/puzzles';

const ROLE_ORDER: Record<Role, number> = { learner: 0, reviewer: 1, admin: 2 };

export function roleAtLeast(role: Role, minimum: Role): boolean {
  return ROLE_ORDER[role] >= ROLE_ORDER[minimum];
}

/**
 * A same-site relative path or the fallback. Rejects absolute URLs, protocol-relative `//host`, backslash
 * tricks, and control characters.
 */
export function safeRedirect(value: string | null | undefined, fallback: string = DEFAULT_REDIRECT): string {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return fallback;
  return value;
}

export function isBlocked(session: SessionState): session is { blocked: true } {
  return session !== null && 'blocked' in session;
}

export type GuardResult =
  | { kind: 'ok'; user: MeDto }
  | { kind: 'redirect'; to: '/login'; search: { redirect: string } }
  | { kind: 'redirect'; to: '/blocked' };

/** Pure decision behind `requireSession`. */
export function guardSession(session: SessionState, location: { pathname: string; search?: string }): GuardResult {
  if (session === null) {
    return { kind: 'redirect', to: '/login', search: { redirect: safeRedirect(`${location.pathname}${location.search ?? ''}`, DEFAULT_REDIRECT) } };
  }
  if (isBlocked(session)) return { kind: 'redirect', to: '/blocked' };
  return { kind: 'ok', user: session };
}

/** For `beforeLoad`: returns the user or throws a router redirect. */
export function requireSession(session: SessionState, location: { pathname: string; search?: string }): MeDto {
  const result = guardSession(session, location);
  if (result.kind === 'ok') return result.user;
  if (result.to === '/login') throw redirect({ to: '/login', search: result.search });
  throw redirect({ to: '/blocked' });
}

/** Thrown by `requireRole`; the root error component renders the Forbidden page for it. */
export class ForbiddenError extends Error {
  constructor(message = 'You do not have access to this page.') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export function requireRole(user: Pick<MeDto, 'role'>, minimum: Role): void {
  if (!roleAtLeast(user.role, minimum)) throw new ForbiddenError();
}
