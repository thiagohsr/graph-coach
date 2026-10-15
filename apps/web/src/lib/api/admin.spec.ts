import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRecord, listModels, listRecords, updateRecord } from './admin';

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

describe('admin api', () => {
  it('listModels: GET /api/admin/models', async () => {
    respond(200, []);
    await expect(listModels()).resolves.toEqual([]);
    expect(lastCall()).toMatchObject({ url: '/api/admin/models', method: 'GET' });
  });

  it('listRecords builds the query string and omits an empty search', async () => {
    respond(200, { items: [], total: 0, page: 2, pageSize: 10 });
    await listRecords('widget', { search: 'ab c', page: 2, pageSize: 10 });
    expect(lastCall().url).toBe('/api/admin/widget?search=ab+c&page=2&pageSize=10');
    respond(200, { items: [], total: 0, page: 1, pageSize: 25 });
    await listRecords('widget', { search: '', page: 1 });
    expect(lastCall().url).toBe('/api/admin/widget?page=1');
  });

  it('getRecord and updateRecord use the canonical paths; update sends { values }', async () => {
    const record = { id: 'w-1', title: 'W', values: { name: 'W' } };
    respond(200, { record, links: [], actions: [] });
    await getRecord('widget', 'w-1');
    expect(lastCall()).toMatchObject({ url: '/api/admin/widget/w-1', method: 'GET' });
    respond(200, { record });
    await updateRecord('widget', 'w-1', { name: 'X' });
    expect(lastCall()).toMatchObject({ url: '/api/admin/widget/w-1', method: 'PATCH' });
    expect(JSON.parse(lastCall().body ?? '')).toEqual({ values: { name: 'X' } });
  });

  it('a malformed model list throws CONTRACT_MISMATCH', async () => {
    respond(200, [{ name: 'x' }]);
    await expect(listModels()).rejects.toMatchObject({ code: 'CONTRACT_MISMATCH' });
  });
});
