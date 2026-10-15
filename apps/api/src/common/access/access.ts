// Access model of reconciliation section G: a user reaches their own content, public puzzles, and what was shared
// with them. There is no staff exception: no role bypass, no "see all" parameter (contracts §5.3).
import type { Role } from '@coach/types';
import { hasRole, type AuthUser } from '../auth/auth-user';
import { ForbiddenError, NotFoundError } from '../errors/app-error';

export interface PuzzleAccessFacts {
  status: 'draft' | 'published';
  visibility: 'private' | 'public';
  ownerId: string | null;
  /** A SHARED_WITH edge from the puzzle to the caller exists. Computed for the calling user, never someone else. */
  sharedWithCaller: boolean;
}

/** ownerId of the puzzle that CONTAINS the question. */
export interface QuestionAccessFacts {
  puzzleOwnerId: string | null;
}

export interface SourceAccessFacts {
  ownerId: string | null;
  /** The puzzle it YIELDED has SHARED_WITH {withSource: true} to the caller. */
  sharedWithCaller: boolean;
}

const isOwner = (user: AuthUser, ownerId: string | null | undefined): boolean =>
  ownerId !== null && ownerId !== undefined && ownerId === user.id;

/** published AND (public OR owned by the caller OR shared with the caller). Listing, play, sessions, and the Coach. */
export function canPlay(user: AuthUser, puzzle: PuzzleAccessFacts): boolean {
  return (
    puzzle.status === 'published' &&
    (puzzle.visibility === 'public' || isOwner(user, puzzle.ownerId) || puzzle.sharedWithCaller)
  );
}

/** The caller owns the puzzle that contains the question. */
export function canReview(user: AuthUser, question: QuestionAccessFacts): boolean {
  return isOwner(user, question.puzzleOwnerId);
}

/** Owner AND published. */
export function canShare(user: AuthUser, puzzle: PuzzleAccessFacts): boolean {
  return isOwner(user, puzzle.ownerId) && puzzle.status === 'published';
}

/** Owner AND role reviewer or admin AND published. */
export function canPublish(user: AuthUser, puzzle: PuzzleAccessFacts): boolean {
  return (
    isOwner(user, puzzle.ownerId) && hasRole(user, 'reviewer', 'admin') && puzzle.status === 'published'
  );
}

/** Owner or shared with source. Source text, chunks, passage excerpts. */
export function canReadSource(user: AuthUser, source: SourceAccessFacts): boolean {
  return isOwner(user, source.ownerId) || source.sharedWithCaller;
}

/** Each throws NotFoundError (`<Resource> not found`) when the record is missing or the caller may not reach it. */
export function assertCanPlay(
  user: AuthUser,
  puzzle: PuzzleAccessFacts | null | undefined,
): asserts puzzle is PuzzleAccessFacts {
  if (!puzzle || !canPlay(user, puzzle)) throw new NotFoundError('Puzzle');
}

export function assertCanReview(
  user: AuthUser,
  question: QuestionAccessFacts | null | undefined,
): asserts question is QuestionAccessFacts {
  if (!question || !canReview(user, question)) throw new NotFoundError('Question');
}

export function assertCanReadSource(
  user: AuthUser,
  source: SourceAccessFacts | null | undefined,
): asserts source is SourceAccessFacts {
  if (!source || !canReadSource(user, source)) throw new NotFoundError('Source');
}

/** 404 when missing or not owned. Does not check `published`: the caller answers 409 for an unpublished puzzle. */
export function assertCanShare(
  user: AuthUser,
  puzzle: PuzzleAccessFacts | null | undefined,
): asserts puzzle is PuzzleAccessFacts {
  if (!puzzle || !isOwner(user, puzzle.ownerId)) throw new NotFoundError('Puzzle');
}

/**
 * 404 when missing or not owned; ForbiddenError (403) when owned but the role is learner. Does not check `published`
 * (409 by the caller).
 */
export function assertCanPublish(
  user: AuthUser,
  puzzle: PuzzleAccessFacts | null | undefined,
): asserts puzzle is PuzzleAccessFacts {
  if (!puzzle || !isOwner(user, puzzle.ownerId)) throw new NotFoundError('Puzzle');
  if (!hasRole(user, 'reviewer', 'admin')) throw new ForbiddenError();
}

/** Owner-only records (session, task, draft puzzle). `adminToo` is only for decisions (reconciliation G8). */
export function assertOwner(
  user: AuthUser,
  ownerId: string | null | undefined,
  resource: string,
  options: { adminToo?: boolean } = {},
): void {
  if (isOwner(user, ownerId)) return;
  if (options.adminToo === true && user.role === 'admin' && ownerId !== null && ownerId !== undefined) return;
  throw new NotFoundError(resource);
}

/** Returns the value when present and visible; otherwise throws NotFoundError. */
export function ensureVisible<T>(
  value: T | null | undefined,
  visible: boolean | ((value: T) => boolean),
  resource: string,
): T {
  if (value === null || value === undefined) throw new NotFoundError(resource);
  const ok = typeof visible === 'function' ? visible(value) : visible;
  if (!ok) throw new NotFoundError(resource);
  return value;
}

/** The only parameters an access-aware query receives about the caller. */
export function callerParams(user: AuthUser): { userId: string } {
  return { userId: user.id };
}

/** For the visibility endpoint, where the role matters. */
export function publisherParams(user: AuthUser): { userId: string; role: Role } {
  return { userId: user.id, role: user.role };
}
