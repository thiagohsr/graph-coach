import type { Role, ShareDto } from '@coach/types';
import { describeError } from '~/components/states/error-messages';
import { isApiClientError } from '~/lib/api/errors';
import { roleAtLeast } from '~/lib/auth/guards';

// Pure sharing rules (data-model.md §6). The server decides; these are conveniences.

export const NO_SOURCE_MESSAGE = 'This puzzle has no source to share.';
export const UNKNOWN_ADDRESS_MESSAGE =
  'Nobody has signed in with that address yet. Ask them to sign in once.';
export const NOT_PUBLISHED_MESSAGE = 'This puzzle is not published yet, so it cannot be shared.';
export const GONE_MESSAGE = 'This puzzle is no longer available.';

interface PuzzleAccess {
  access: 'owner' | 'shared' | 'public';
}

export function canShare(puzzle: PuzzleAccess): boolean {
  return puzzle.access === 'owner';
}

export function canChangeVisibility(puzzle: PuzzleAccess, role: Role): boolean {
  return puzzle.access === 'owner' && roleAtLeast(role, 'reviewer');
}

/** For an owner, `sourceShared` means the puzzle has a source (seeded puzzles have none). */
export function canOfferSource(puzzle: { sourceShared: boolean }): boolean {
  return puzzle.sourceShared;
}

export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type AddressCheck = { ok: true; email: string } | { ok: false; message: string };

/** Checks run before any request. The address is trimmed and lower-cased first. */
export function checkShareAddress(input: {
  email: string;
  ownEmail: string;
  shares: readonly ShareDto[];
}): AddressCheck {
  const email = normaliseEmail(input.email);
  if (email === '' || !EMAIL_SHAPE.test(email))
    return { ok: false, message: 'Enter an e-mail address.' };
  if (email === normaliseEmail(input.ownEmail))
    return { ok: false, message: 'You already own this puzzle.' };
  const existing = input.shares.find((share) => normaliseEmail(share.email) === email);
  if (existing) {
    return {
      ok: false,
      message: `Already shared with ${existing.name}. Change the source option in the list below.`,
    };
  }
  return { ok: true, email };
}

export function sortShares(shares: readonly ShareDto[]): ShareDto[] {
  return [...shares].sort((a, b) => a.name.localeCompare(b.name));
}

export type ShareErrorTarget = 'email' | 'withSource' | 'form' | { row: string };

export interface ShareErrorView {
  target: ShareErrorTarget;
  message: string;
  retryAt?: Date;
  /** The puzzle is gone for this user: the caller refreshes `puzzles.list`. */
  refreshPuzzles?: boolean;
}

/** The action that failed decides where a generic error is shown (the row for a toggle or revoke). */
export function mapShareError(
  error: unknown,
  action: 'add' | 'toggle' | 'revoke',
  userId?: string,
): ShareErrorView {
  const rowOrForm: ShareErrorTarget = action !== 'add' && userId ? { row: userId } : 'form';
  if (isApiClientError(error)) {
    if (error.status === 422) {
      if (error.issues.some((i) => i.path === 'email'))
        return { target: 'email', message: UNKNOWN_ADDRESS_MESSAGE };
      if (error.issues.some((i) => i.path === 'withSource')) {
        return {
          target: action === 'toggle' && userId ? { row: userId } : 'withSource',
          message: NO_SOURCE_MESSAGE,
        };
      }
      return { target: 'form', message: error.message };
    }
    if (error.status === 409 && error.code === 'CONFLICT')
      return { target: 'form', message: NOT_PUBLISHED_MESSAGE };
    if (error.status === 429) {
      return {
        target: 'form',
        message: 'You are sharing too fast.',
        ...(error.retryAt ? { retryAt: error.retryAt } : {}),
      };
    }
    if (error.status === 404)
      return { target: 'form', message: GONE_MESSAGE, refreshPuzzles: true };
  }
  return { target: rowOrForm, message: describeError(error).message };
}
