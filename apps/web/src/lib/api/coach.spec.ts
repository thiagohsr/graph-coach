import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decision, path, recommendation } from '~/features/coach/fixtures';
import { getDecision, getDecisionPath, requestRecommendation } from './coach';

const fetchMock = vi.fn();

function respond(status: number, body?: unknown) {
  fetchMock.mockResolvedValueOnce(
    new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
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

describe('coach api', () => {
  it('requestRecommendation: POST /api/coach/recommendations with {} when there is no goal', async () => {
    respond(201, recommendation);
    await expect(requestRecommendation()).resolves.toEqual(recommendation);
    expect(lastCall()).toMatchObject({ url: '/api/coach/recommendations', method: 'POST' });
    expect(JSON.parse(lastCall().body ?? '')).toEqual({});
  });

  it('sends the trimmed goal when given', async () => {
    respond(201, recommendation);
    await requestRecommendation({ goal: '  learn joins ' });
    expect(JSON.parse(lastCall().body ?? '')).toEqual({ goal: 'learn joins' });
  });

  it('flags are required', async () => {
    const { flags: _f, ...withoutFlags } = recommendation;
    respond(201, withoutFlags);
    await expect(requestRecommendation()).rejects.toMatchObject({ code: 'CONTRACT_MISMATCH' });
  });

  it('surfaces 409 NO_PLAYABLE_CONTENT', async () => {
    respond(409, { error: { code: 'NO_PLAYABLE_CONTENT', message: 'nothing' } });
    await expect(requestRecommendation()).rejects.toMatchObject({ status: 409, code: 'NO_PLAYABLE_CONTENT' });
  });

  it('getDecision and getDecisionPath use the canonical paths', async () => {
    respond(200, decision);
    await expect(getDecision('dec-1')).resolves.toEqual(decision);
    expect(lastCall()).toMatchObject({ url: '/api/decisions/dec-1', method: 'GET' });
    respond(200, path);
    await expect(getDecisionPath('dec-1')).resolves.toEqual(path);
    expect(lastCall()).toMatchObject({ url: '/api/decisions/dec-1/path', method: 'GET' });
  });

  it('a malformed path throws CONTRACT_MISMATCH', async () => {
    respond(200, { nodes: [], edges: [] });
    await expect(getDecisionPath('dec-1')).rejects.toMatchObject({ code: 'CONTRACT_MISMATCH' });
  });
});
