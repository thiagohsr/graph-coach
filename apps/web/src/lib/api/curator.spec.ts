import { beforeEach, describe, expect, it, vi } from 'vitest';
import { promptDetail, sourceSummaries, taskDto, uploadDetail } from '~/features/sources/fixtures';
import { ApiClientError } from './errors';
import { createSource, getSource, getTask, isDuplicate, listSources, retryTask, taskEventsUrl } from './curator';

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

describe('curator api', () => {
  it('createSource: POST /api/sources with the request body; tells the 202 shape from the 200 duplicate', async () => {
    respond(202, { taskId: 't-1', sourceId: 'src-1' });
    const created = await createSource({ title: 'T', kind: 'text', content: 'x' });
    expect(lastCall()).toMatchObject({ url: '/api/sources', method: 'POST' });
    expect(JSON.parse(lastCall().body ?? '')).toEqual({ title: 'T', kind: 'text', content: 'x' });
    expect(isDuplicate(created)).toBe(false);

    respond(200, { duplicateOf: 'src-1', taskId: 't-1' });
    const duplicate = await createSource({ title: 'T', kind: 'text', content: 'x' });
    expect(isDuplicate(duplicate)).toBe(true);
  });

  it('listSources: GET /api/sources', async () => {
    respond(200, sourceSummaries);
    await expect(listSources()).resolves.toEqual(sourceSummaries);
    expect(lastCall()).toMatchObject({ url: '/api/sources', method: 'GET' });
  });

  it('getSource: GET /api/sources/:id for an upload and for a prompt', async () => {
    respond(200, uploadDetail);
    await expect(getSource('src-1')).resolves.toEqual(uploadDetail);
    expect(lastCall()).toMatchObject({ url: '/api/sources/src-1', method: 'GET' });
    respond(200, promptDetail);
    await expect(getSource('src-3')).resolves.toEqual(promptDetail);
  });

  it('getTask: GET /api/tasks/:id', async () => {
    const task = taskDto();
    respond(200, task);
    await expect(getTask('t-1')).resolves.toEqual(task);
    expect(lastCall()).toMatchObject({ url: '/api/tasks/t-1', method: 'GET' });
  });

  it('retryTask: POST /api/tasks/:id/retry with no body', async () => {
    respond(202, { taskId: 't-1' });
    await expect(retryTask('t-1')).resolves.toEqual({ taskId: 't-1' });
    expect(lastCall()).toMatchObject({ url: '/api/tasks/t-1/retry', method: 'POST', body: undefined });
  });

  it('taskEventsUrl is the same-origin stream address', () => {
    expect(taskEventsUrl('t-1')).toBe('/api/tasks/t-1/events');
  });

  it('a schema mismatch throws CONTRACT_MISMATCH', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    respond(200, { id: 't-1' });
    await expect(getTask('t-1')).rejects.toMatchObject({ code: 'CONTRACT_MISMATCH' });
    respond(200, [{ id: 'x' }]);
    await expect(listSources()).rejects.toBeInstanceOf(ApiClientError);
  });
});
