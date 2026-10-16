import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSource } from './curator';
import { getAllowance, redeemCode } from './account';

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

const allowance = {
  upload: { used: 1, allowance: 3, bonus: 0, resetsAt: '2026-11-01T00:00:00.000Z' },
  prompt: { used: 0, allowance: null, bonus: 2, resetsAt: '2026-11-01T00:00:00.000Z' },
  hourly: { used: 1, limit: 4 },
  creationEnabled: true,
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('account api', () => {
  it('getAllowance: GET /api/me/allowance parsed as { upload, prompt, hourly, creationEnabled }', async () => {
    respond(200, allowance);
    await expect(getAllowance()).resolves.toEqual(allowance);
    expect(lastCall()).toMatchObject({ url: '/api/me/allowance', method: 'GET' });
  });

  it('redeemCode: POST /api/me/codes/redeem with { code } returns what was granted', async () => {
    respond(200, { sourceRuns: 2, promptRuns: 0, limitsLiftedUntil: '2026-10-16T00:00:00.000Z' });
    await expect(redeemCode('ABC-123')).resolves.toEqual({ sourceRuns: 2, promptRuns: 0, limitsLiftedUntil: '2026-10-16T00:00:00.000Z' });
    expect(lastCall()).toMatchObject({ url: '/api/me/codes/redeem', method: 'POST' });
    expect(JSON.parse(lastCall().body ?? '')).toEqual({ code: 'ABC-123' });
  });

  it('redeemCode: limitsLiftedUntil is optional', async () => {
    respond(200, { sourceRuns: 0, promptRuns: 3 });
    await expect(redeemCode('X')).resolves.toEqual({ sourceRuns: 0, promptRuns: 3 });
  });

  it('a schema mismatch throws CONTRACT_MISMATCH', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    respond(200, { upload: {} });
    await expect(getAllowance()).rejects.toMatchObject({ code: 'CONTRACT_MISMATCH' });
  });

  it('createSource sends { title, kind: "prompt", brief } with no content key for a prompt', async () => {
    respond(202, { taskId: 't-1', sourceId: 'src-1' });
    await createSource({ title: 'T', kind: 'prompt', brief: { subject: 'B-trees', difficulty: 'easy', sentences: 5 } });
    const sent = JSON.parse(lastCall().body ?? '');
    expect(sent).toEqual({ title: 'T', kind: 'prompt', brief: { subject: 'B-trees', difficulty: 'easy', sentences: 5 } });
    expect('content' in sent).toBe(false);
  });

  it('createSource sends { title, kind, content } with no brief key for an upload', async () => {
    respond(202, { taskId: 't-1', sourceId: 'src-1' });
    await createSource({ title: 'T', kind: 'markdown', content: 'words' });
    const sent = JSON.parse(lastCall().body ?? '');
    expect(sent).toEqual({ title: 'T', kind: 'markdown', content: 'words' });
    expect('brief' in sent).toBe(false);
  });
});
