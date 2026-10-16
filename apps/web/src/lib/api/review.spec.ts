import { beforeEach, describe, expect, it, vi } from 'vitest';
import { drafts, outcome } from '~/features/review/fixtures';
import { approveDraft, listDrafts, rejectDraft, updateDraft } from './review';

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

describe('review api', () => {
  it('listDrafts: GET /api/review/questions?status=draft, with taskId when given', async () => {
    respond(200, drafts);
    await expect(listDrafts()).resolves.toEqual(drafts);
    expect(lastCall()).toMatchObject({ url: '/api/review/questions?status=draft', method: 'GET' });

    respond(200, drafts);
    await listDrafts({ taskId: 't-1' });
    expect(lastCall().url).toBe('/api/review/questions?status=draft&taskId=t-1');
  });

  it('updateDraft: PATCH with only the three editable fields, returns the draft', async () => {
    respond(200, drafts[0]);
    const changes = { sentence: 'A new ___ sentence for the question.', id: 'x', concepts: [] } as never;
    await expect(updateDraft('d-1', changes)).resolves.toEqual(drafts[0]);
    expect(lastCall()).toMatchObject({ url: '/api/review/questions/d-1', method: 'PATCH' });
    expect(JSON.parse(lastCall().body ?? '')).toEqual({ sentence: 'A new ___ sentence for the question.' });

    respond(200, drafts[0]);
    await updateDraft('d-1', { answers: ['a'], distractors: ['b', 'c'] });
    expect(JSON.parse(lastCall().body ?? '')).toEqual({ answers: ['a'], distractors: ['b', 'c'] });
  });

  it('approveDraft: POST /approve parsed as ReviewOutcome', async () => {
    respond(200, outcome());
    await expect(approveDraft('d-1')).resolves.toEqual(outcome());
    expect(lastCall()).toMatchObject({ url: '/api/review/questions/d-1/approve', method: 'POST', body: undefined });
  });

  it('rejectDraft: POST /reject with the trimmed reason, or an empty body; parsed as ReviewOutcome', async () => {
    const below = outcome({
      remainingDrafts: 0,
      notPublishedReason: { code: 'below_minimum', approved: 2, minQuestions: 3 },
    });
    respond(200, below);
    await expect(rejectDraft('d-1', '  too vague ')).resolves.toEqual(below);
    expect(lastCall()).toMatchObject({ url: '/api/review/questions/d-1/reject', method: 'POST' });
    expect(JSON.parse(lastCall().body ?? '')).toEqual({ reason: 'too vague' });

    respond(200, outcome());
    await rejectDraft('d-1');
    expect(JSON.parse(lastCall().body ?? '')).toEqual({});
  });

  it('a body that is not a ReviewOutcome is a contract mismatch', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    respond(200, { puzzle: 'x' });
    await expect(approveDraft('d-1')).rejects.toMatchObject({ code: 'CONTRACT_MISMATCH' });
  });
});
