import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteShare, listShares, putShare, setVisibility } from './sharing';

const fetchMock = vi.fn();

function respond(status: number, body?: unknown) {
  fetchMock.mockResolvedValueOnce(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

function lastCall() {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, method: init.method, body: init.body as string | undefined };
}

const share = {
  userId: 'u-2',
  name: 'Bea Souza',
  email: 'bea@example.com',
  withSource: true,
  sharedAt: '2026-10-12T10:00:00.000Z',
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('sharing api', () => {
  it('listShares: GET /api/puzzles/:id/shares', async () => {
    respond(200, [share]);
    await expect(listShares('pz-1')).resolves.toEqual([share]);
    expect(lastCall()).toMatchObject({ url: '/api/puzzles/pz-1/shares', method: 'GET' });
  });

  it('putShare: PUT with { email, withSource }, returns the row', async () => {
    respond(200, share);
    await expect(putShare('pz-1', { email: 'bea@example.com', withSource: true })).resolves.toEqual(
      share,
    );
    expect(lastCall()).toMatchObject({ url: '/api/puzzles/pz-1/shares', method: 'PUT' });
    expect(JSON.parse(lastCall().body ?? '')).toEqual({
      email: 'bea@example.com',
      withSource: true,
    });
  });

  it('deleteShare: DELETE /shares/:userId resolves on 204 with no body', async () => {
    respond(204);
    await expect(deleteShare('pz-1', 'u-2')).resolves.toBeUndefined();
    expect(lastCall()).toMatchObject({
      url: '/api/puzzles/pz-1/shares/u-2',
      method: 'DELETE',
      body: undefined,
    });
  });

  it('setVisibility: POST /visibility returns { id, visibility }', async () => {
    respond(200, { id: 'pz-1', visibility: 'public', origin: 'upload' });
    await expect(setVisibility('pz-1', 'public')).resolves.toMatchObject({
      id: 'pz-1',
      visibility: 'public',
    });
    expect(lastCall()).toMatchObject({ url: '/api/puzzles/pz-1/visibility', method: 'POST' });
    expect(JSON.parse(lastCall().body ?? '')).toEqual({ visibility: 'public' });
  });

  it('a schema mismatch throws CONTRACT_MISMATCH', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    respond(200, [{ userId: 'u-2' }]);
    await expect(listShares('pz-1')).rejects.toMatchObject({ code: 'CONTRACT_MISMATCH' });
    respond(200, { id: 'pz-1' });
    await expect(setVisibility('pz-1', 'private')).rejects.toMatchObject({
      code: 'CONTRACT_MISMATCH',
    });
  });

  it('rejects with the API error for a 422', async () => {
    respond(422, {
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Invalid',
        details: { issues: [{ path: 'email', message: 'unknown' }] },
      },
    });
    await expect(putShare('pz-1', { email: 'x@y.co', withSource: false })).rejects.toMatchObject({
      status: 422,
      issues: [{ path: 'email', message: 'unknown' }],
    });
  });
});
