import { describe, expect, it } from 'vitest';
import { ForbiddenError, NotFoundError } from '../errors/app-error';
import type { AuthUser } from '../auth/auth-user';
import * as access from './access';
import {
  assertCanPlay,
  assertCanPublish,
  assertCanReadSource,
  assertCanReview,
  assertCanShare,
  assertOwner,
  callerParams,
  canPlay,
  canPublish,
  canReadSource,
  canReview,
  canShare,
  ensureVisible,
  publisherParams,
  type PuzzleAccessFacts,
} from './access';

const owner: AuthUser = { id: 'owner', role: 'learner' };
const ownerReviewer: AuthUser = { id: 'owner', role: 'reviewer' };
const ownerAdmin: AuthUser = { id: 'owner', role: 'admin' };
const other: AuthUser = { id: 'other', role: 'learner' };
const reviewer: AuthUser = { id: 'rev', role: 'reviewer' };
const admin: AuthUser = { id: 'adm', role: 'admin' };

const puzzle = (over: Partial<PuzzleAccessFacts> = {}): PuzzleAccessFacts => ({
  status: 'published',
  visibility: 'private',
  ownerId: 'owner',
  sharedWithCaller: false,
  ...over,
});

describe('canPlay truth table', () => {
  const statuses = ['draft', 'published'] as const;
  const visibilities = ['private', 'public'] as const;
  for (const status of statuses) {
    for (const visibility of visibilities) {
      for (const sharedWithCaller of [false, true]) {
        const facts = puzzle({ status, visibility, sharedWithCaller });
        const published = status === 'published';
        it(`${status} ${visibility} shared=${sharedWithCaller}`, () => {
          // Owner: published only (a draft is for the review screens, not for play).
          expect(canPlay(owner, { ...facts, sharedWithCaller: false })).toBe(published);
          // Another learner: published and (public or shared with them).
          expect(canPlay(other, facts)).toBe(
            published && (visibility === 'public' || sharedWithCaller),
          );
          // No staff exception: reviewer and admin are other learners for this purpose.
          expect(canPlay(reviewer, facts)).toBe(
            published && (visibility === 'public' || sharedWithCaller),
          );
          expect(canPlay(admin, facts)).toBe(
            published && (visibility === 'public' || sharedWithCaller),
          );
        });
      }
    }
  }

  it('refuses reviewer and admin on a private unshared puzzle', () => {
    expect(canPlay(reviewer, puzzle())).toBe(false);
    expect(canPlay(admin, puzzle())).toBe(false);
  });
});

describe('canReview', () => {
  it('is true only for the puzzle owner', () => {
    expect(canReview(owner, { puzzleOwnerId: 'owner' })).toBe(true);
    expect(canReview(other, { puzzleOwnerId: 'owner' })).toBe(false);
    expect(canReview(reviewer, { puzzleOwnerId: 'owner' })).toBe(false);
    expect(canReview(admin, { puzzleOwnerId: 'owner' })).toBe(false);
    expect(canReview(owner, { puzzleOwnerId: null })).toBe(false);
  });
});

describe('canShare', () => {
  it('is owner AND published', () => {
    expect(canShare(owner, puzzle())).toBe(true);
    expect(canShare(owner, puzzle({ status: 'draft' }))).toBe(false);
    expect(canShare(other, puzzle({ sharedWithCaller: true, visibility: 'public' }))).toBe(false);
    expect(canShare(reviewer, puzzle())).toBe(false);
    expect(canShare(admin, puzzle())).toBe(false);
    expect(canShare(owner, puzzle({ ownerId: null }))).toBe(false);
  });
});

describe('canPublish', () => {
  it('is owner AND reviewer-or-admin AND published', () => {
    expect(canPublish(ownerReviewer, puzzle())).toBe(true);
    expect(canPublish(ownerAdmin, puzzle())).toBe(true);
    expect(canPublish(owner, puzzle())).toBe(false);
    expect(canPublish(ownerReviewer, puzzle({ status: 'draft' }))).toBe(false);
    expect(canPublish(reviewer, puzzle())).toBe(false);
    expect(canPublish(admin, puzzle())).toBe(false);
  });
});

describe('canReadSource', () => {
  it('is owner or shared-with-source only', () => {
    expect(canReadSource(owner, { ownerId: 'owner', sharedWithCaller: false })).toBe(true);
    expect(canReadSource(other, { ownerId: 'owner', sharedWithCaller: true })).toBe(true);
    expect(canReadSource(other, { ownerId: 'owner', sharedWithCaller: false })).toBe(false);
    expect(canReadSource(reviewer, { ownerId: 'owner', sharedWithCaller: false })).toBe(false);
    expect(canReadSource(admin, { ownerId: 'owner', sharedWithCaller: false })).toBe(false);
    expect(canReadSource(owner, { ownerId: null, sharedWithCaller: false })).toBe(false);
  });
});

function thrown(fn: () => unknown): Error {
  try {
    fn();
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected a throw');
}

describe('assert helpers answer 404 with one message for missing and unreachable', () => {
  const actors = [owner, other, reviewer, admin];

  it('assertCanPlay', () => {
    for (const user of actors) {
      const missing = thrown(() => assertCanPlay(user, null));
      expect(missing).toBeInstanceOf(NotFoundError);
      expect(missing.message).toBe('Puzzle not found');
    }
    for (const user of [other, reviewer, admin]) {
      const hidden = thrown(() => assertCanPlay(user, puzzle()));
      expect(hidden).toBeInstanceOf(NotFoundError);
      expect(hidden.message).toBe('Puzzle not found');
    }
    expect(() => assertCanPlay(owner, puzzle())).not.toThrow();
    expect(() => assertCanPlay(other, puzzle({ visibility: 'public' }))).not.toThrow();
  });

  it('assertCanReview', () => {
    for (const user of actors) {
      expect(thrown(() => assertCanReview(user, undefined))).toBeInstanceOf(NotFoundError);
    }
    for (const user of [other, reviewer, admin]) {
      const hidden = thrown(() => assertCanReview(user, { puzzleOwnerId: 'owner' }));
      expect(hidden).toBeInstanceOf(NotFoundError);
      expect(hidden.message).toBe('Question not found');
    }
    expect(() => assertCanReview(owner, { puzzleOwnerId: 'owner' })).not.toThrow();
  });

  it('assertCanShare', () => {
    for (const user of [other, reviewer, admin]) {
      expect(thrown(() => assertCanShare(user, puzzle()))).toBeInstanceOf(NotFoundError);
    }
    expect(thrown(() => assertCanShare(owner, null)).message).toBe('Puzzle not found');
    // Does not check `published`: the caller answers 409 for a draft.
    expect(() => assertCanShare(owner, puzzle({ status: 'draft' }))).not.toThrow();
  });

  it('assertCanReadSource', () => {
    for (const user of [other, reviewer, admin]) {
      const hidden = thrown(() =>
        assertCanReadSource(user, { ownerId: 'owner', sharedWithCaller: false }),
      );
      expect(hidden).toBeInstanceOf(NotFoundError);
      expect(hidden.message).toBe('Source not found');
    }
    expect(thrown(() => assertCanReadSource(owner, null)).message).toBe('Source not found');
    expect(() =>
      assertCanReadSource(other, { ownerId: 'owner', sharedWithCaller: true }),
    ).not.toThrow();
  });

  it('assertCanPublish: 404 for a non-owner of any role, 403 for a learner owner', () => {
    for (const user of [other, reviewer, admin]) {
      expect(thrown(() => assertCanPublish(user, puzzle()))).toBeInstanceOf(NotFoundError);
    }
    expect(thrown(() => assertCanPublish(owner, null))).toBeInstanceOf(NotFoundError);
    expect(thrown(() => assertCanPublish(owner, puzzle()))).toBeInstanceOf(ForbiddenError);
    expect(() => assertCanPublish(ownerReviewer, puzzle())).not.toThrow();
    expect(() => assertCanPublish(ownerAdmin, puzzle({ status: 'draft' }))).not.toThrow();
  });

  it('assertOwner: 404 unless owner; adminToo admits an admin only when asked', () => {
    expect(() => assertOwner(owner, 'owner', 'Task')).not.toThrow();
    for (const user of [other, reviewer, admin]) {
      const error = thrown(() => assertOwner(user, 'owner', 'Task'));
      expect(error).toBeInstanceOf(NotFoundError);
      expect(error.message).toBe('Task not found');
    }
    expect(thrown(() => assertOwner(owner, null, 'Task'))).toBeInstanceOf(NotFoundError);
    expect(thrown(() => assertOwner(owner, undefined, 'Task'))).toBeInstanceOf(NotFoundError);
    expect(() => assertOwner(admin, 'owner', 'Decision', { adminToo: true })).not.toThrow();
    expect(
      thrown(() => assertOwner(reviewer, 'owner', 'Decision', { adminToo: true })),
    ).toBeInstanceOf(NotFoundError);
    expect(
      thrown(() => assertOwner(admin, 'owner', 'Decision', { adminToo: false })),
    ).toBeInstanceOf(NotFoundError);
  });

  it('ensureVisible returns a visible value and throws otherwise', () => {
    const value = { id: 1 };
    expect(ensureVisible(value, true, 'Thing')).toBe(value);
    expect(ensureVisible(value, (v) => v.id === 1, 'Thing')).toBe(value);
    for (const user of actors) {
      void user;
      expect(thrown(() => ensureVisible(null, true, 'Thing')).message).toBe('Thing not found');
      expect(thrown(() => ensureVisible(value, false, 'Thing')).message).toBe('Thing not found');
      expect(thrown(() => ensureVisible(value, () => false, 'Thing'))).toBeInstanceOf(
        NotFoundError,
      );
    }
  });
});

describe('caller parameters', () => {
  it('callerParams returns exactly { userId }', () => {
    expect(callerParams(admin)).toEqual({ userId: 'adm' });
    expect(Object.keys(callerParams(reviewer))).toEqual(['userId']);
  });

  it('publisherParams carries the role', () => {
    expect(publisherParams(reviewer)).toEqual({ userId: 'rev', role: 'reviewer' });
  });

  it('has no staff bypass helpers', () => {
    for (const forbidden of ['isStaff', 'canRecommend', 'recommendParams']) {
      expect(forbidden in access).toBe(false);
    }
  });
});
