import { beforeEach, describe, expect, it, vi } from 'vitest';
import { playPuzzle, submitResult, summaries } from '~/features/play/fixtures';
import { ApiClientError } from './errors';
import {
  createSession,
  getMastery,
  getPlay,
  getSessionResult,
  listPuzzles,
  submitSession,
} from './gameplay';

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

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('gameplay api', () => {
  it('listPuzzles: GET /api/puzzles', async () => {
    respond(200, summaries);
    await expect(listPuzzles()).resolves.toEqual(summaries);
    expect(lastCall()).toMatchObject({ url: '/api/puzzles', method: 'GET' });
  });

  it('getPlay: GET /api/puzzles/:id/play, and drops an extra answers field', async () => {
    respond(200, { ...playPuzzle, answers: ['index', 'writes'] });
    const parsed = await getPlay('pz-db-101');
    expect(lastCall()).toMatchObject({ url: '/api/puzzles/pz-db-101/play', method: 'GET' });
    expect(parsed).toEqual(playPuzzle);
    expect(parsed).not.toHaveProperty('answers');
  });

  it('createSession: POST /api/puzzles/:id/sessions with no body', async () => {
    respond(201, { sessionId: 's-1' });
    await expect(createSession('pz-1')).resolves.toEqual({ sessionId: 's-1' });
    expect(lastCall()).toEqual({
      url: '/api/puzzles/pz-1/sessions',
      method: 'POST',
      body: undefined,
    });
  });

  it('submitSession: POST /api/sessions/:id/submit with the answers, parsed as a SubmitResult', async () => {
    respond(200, submitResult);
    const request = { answers: [{ questionId: 'q-1', blank: 0, word: 'index' }] };
    const result = await submitSession('s-1', request);
    expect(lastCall()).toMatchObject({ url: '/api/sessions/s-1/submit', method: 'POST' });
    expect(JSON.parse(lastCall().body ?? '')).toEqual(request);
    expect(result.sessionId).toBe('s-1');
    expect(result.puzzle).toEqual({ id: 'pz-db-101', name: 'Databases 101', origin: 'upload' });
    expect(result.submittedAt).toBe('2026-10-11T14:03:22.000Z');
    expect(result.questions).toHaveLength(1);
  });

  it('a malformed submit result throws CONTRACT_MISMATCH', async () => {
    const { questions: _dropped, ...withoutQuestions } = submitResult;
    respond(200, withoutQuestions);
    await expect(submitSession('s-1', { answers: [] })).rejects.toMatchObject({
      code: 'CONTRACT_MISMATCH',
    });
    respond(200, { ...submitResult, score: 'ten' });
    const error = await submitSession('s-1', { answers: [] }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({ code: 'CONTRACT_MISMATCH' });
  });

  it('getSessionResult: GET /api/sessions/:id', async () => {
    respond(200, submitResult);
    await getSessionResult('s-1');
    expect(lastCall()).toMatchObject({ url: '/api/sessions/s-1', method: 'GET' });
  });

  it('getSessionResult surfaces 409 SESSION_NOT_SUBMITTED', async () => {
    respond(409, { error: { code: 'SESSION_NOT_SUBMITTED', message: 'not yet' } });
    await expect(getSessionResult('s-1')).rejects.toMatchObject({
      status: 409,
      code: 'SESSION_NOT_SUBMITTED',
    });
  });

  it('getMastery: GET /api/me/mastery', async () => {
    const mastery = [
      {
        conceptId: 'c-index',
        name: 'Indexes',
        score: 0.455,
        attempts: 2,
        lastSeen: '2026-10-11T14:03:22.000Z',
      },
    ];
    respond(200, mastery);
    await expect(getMastery()).resolves.toEqual(mastery);
    expect(lastCall()).toMatchObject({ url: '/api/me/mastery', method: 'GET' });
  });

  it('encodes ids in the path', async () => {
    respond(200, playPuzzle);
    await getPlay('a/b');
    expect(lastCall().url).toBe('/api/puzzles/a%2Fb/play');
  });
});
