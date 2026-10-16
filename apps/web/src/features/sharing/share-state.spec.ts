import { describe, expect, it } from 'vitest';
import { ApiClientError } from '~/lib/api/errors';
import {
  canChangeVisibility,
  canOfferSource,
  canShare,
  checkShareAddress,
  mapShareError,
  normaliseEmail,
  sortShares,
} from './share-state';

const owner = { access: 'owner', sourceShared: true } as const;
const shared = { access: 'shared', sourceShared: true } as const;
const publicPz = { access: 'public', sourceShared: false } as const;

const bea = {
  userId: 'u-2',
  name: 'Bea Souza',
  email: 'bea@example.com',
  withSource: false,
  sharedAt: '2026-10-12T10:00:00.000Z',
};

const err = (init: ConstructorParameters<typeof ApiClientError>[0]) => new ApiClientError(init);

describe('canShare / canChangeVisibility / canOfferSource', () => {
  it('canShare is true only for the owner', () => {
    expect(canShare(owner)).toBe(true);
    expect(canShare(shared)).toBe(false);
    expect(canShare(publicPz)).toBe(false);
  });

  it('canChangeVisibility needs ownership and a reviewer or admin role', () => {
    expect(canChangeVisibility(owner, 'learner')).toBe(false);
    expect(canChangeVisibility(owner, 'reviewer')).toBe(true);
    expect(canChangeVisibility(owner, 'admin')).toBe(true);
    for (const role of ['learner', 'reviewer', 'admin'] as const) {
      expect(canChangeVisibility(shared, role)).toBe(false);
      expect(canChangeVisibility(publicPz, role)).toBe(false);
    }
  });

  it('canOfferSource follows sourceShared', () => {
    expect(canOfferSource({ sourceShared: true })).toBe(true);
    expect(canOfferSource({ sourceShared: false })).toBe(false);
  });
});

describe('checkShareAddress', () => {
  const base = { ownEmail: 'me@example.com', shares: [bea] };

  it('trims and lower-cases the address', () => {
    expect(normaliseEmail('  Carl@Example.COM ')).toBe('carl@example.com');
    expect(checkShareAddress({ ...base, email: '  Carl@Example.COM ' })).toEqual({
      ok: true,
      email: 'carl@example.com',
    });
  });

  it('rejects an empty or malformed address', () => {
    for (const email of ['', '   ', 'plain', 'a@b', 'a b@c.de']) {
      expect(checkShareAddress({ ...base, email })).toEqual({
        ok: false,
        message: 'Enter an e-mail address.',
      });
    }
  });

  it('rejects the signed-in user own address, ignoring case', () => {
    expect(checkShareAddress({ ...base, email: 'ME@example.com' })).toEqual({
      ok: false,
      message: 'You already own this puzzle.',
    });
  });

  it('rejects an address already in the list, naming the person', () => {
    expect(checkShareAddress({ ...base, email: 'Bea@example.com' })).toEqual({
      ok: false,
      message: 'Already shared with Bea Souza. Change the source option in the list below.',
    });
  });
});

describe('sortShares', () => {
  it('sorts by name without changing the input', () => {
    const list = [
      { ...bea, name: 'Zed' },
      { ...bea, userId: 'u-3', name: 'Ana' },
    ];
    expect(sortShares(list).map((s) => s.name)).toEqual(['Ana', 'Zed']);
    expect(list[0]!.name).toBe('Zed');
  });
});

describe('mapShareError', () => {
  it('maps a 422 email issue to the address field', () => {
    const e = err({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Invalid',
      issues: [{ path: 'email', message: 'x' }],
    });
    expect(mapShareError(e, 'add')).toMatchObject({
      target: 'email',
      message: 'Nobody has signed in with that address yet. Ask them to sign in once.',
    });
  });

  it('maps a 422 withSource issue to the control, or to the row for a toggle', () => {
    const e = err({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Invalid',
      issues: [{ path: 'withSource', message: 'x' }],
    });
    expect(mapShareError(e, 'add')).toMatchObject({
      target: 'withSource',
      message: 'This puzzle has no source to share.',
    });
    expect(mapShareError(e, 'toggle', 'u-2')).toMatchObject({
      target: { row: 'u-2' },
      message: 'This puzzle has no source to share.',
    });
  });

  it('maps another 422 to the form with the error message', () => {
    const e = err({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Something is off',
      issues: [],
    });
    expect(mapShareError(e, 'add')).toMatchObject({ target: 'form', message: 'Something is off' });
  });

  it('maps 409 CONFLICT to the not-published message', () => {
    const e = err({ status: 409, code: 'CONFLICT', message: 'The puzzle is not published' });
    expect(mapShareError(e, 'add')).toMatchObject({
      target: 'form',
      message: 'This puzzle is not published yet, so it cannot be shared.',
    });
  });

  it('maps 429 to the retry notice with the time', () => {
    const retryAt = new Date('2026-10-12T10:30:00.000Z');
    const e = err({ status: 429, code: 'RATE_LIMITED', message: 'Too many', retryAt });
    expect(mapShareError(e, 'add')).toMatchObject({
      target: 'form',
      message: 'You are sharing too fast.',
      retryAt,
    });
  });

  it('maps 404 to "no longer available" and asks for the list to be refreshed', () => {
    const e = err({ status: 404, code: 'NOT_FOUND', message: 'Puzzle not found' });
    expect(mapShareError(e, 'revoke', 'u-2')).toMatchObject({
      target: 'form',
      message: 'This puzzle is no longer available.',
      refreshPuzzles: true,
    });
  });

  it('maps anything else to the form, or to the row for a toggle or revoke', () => {
    const e = err({ status: 503, code: 'SQL_UNAVAILABLE', message: 'down' });
    expect(mapShareError(e, 'add')).toMatchObject({
      target: 'form',
      message: 'Accounts are unavailable.',
    });
    expect(mapShareError(e, 'revoke', 'u-2')).toMatchObject({ target: { row: 'u-2' } });
    expect(mapShareError(new Error('boom'), 'add')).toMatchObject({
      target: 'form',
      message: 'Service unavailable.',
    });
  });
});
