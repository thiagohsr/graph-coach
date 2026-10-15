import { describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../api/errors';
import { createQueryClient, shouldRetry } from './client';
import { keys } from './keys';

function err(status: number, code: ApiClientError['code']) {
  return new ApiClientError({ status, code, message: code });
}

function setup() {
  const onUnauthenticated = vi.fn();
  const onBlocked = vi.fn();
  const client = createQueryClient({ onUnauthenticated, onBlocked });
  client.setQueryData(['puzzles', 'list'], [1, 2, 3]);
  return { client, onUnauthenticated, onBlocked };
}

async function failingQuery(client: ReturnType<typeof setup>['client'], error: unknown) {
  await client.fetchQuery({ queryKey: ['x'], queryFn: () => Promise.reject(error), retry: false }).catch(() => undefined);
}

async function failingMutation(client: ReturnType<typeof setup>['client'], error: unknown) {
  await client
    .getMutationCache()
    .build(client, { mutationFn: () => Promise.reject(error) })
    .execute(undefined)
    .catch(() => undefined);
}

describe('createQueryClient global handler', () => {
  it('on a 401 from a query clears the cache and calls onUnauthenticated', async () => {
    const { client, onUnauthenticated, onBlocked } = setup();
    await failingQuery(client, err(401, 'UNAUTHENTICATED'));
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
    expect(onBlocked).not.toHaveBeenCalled();
    expect(client.getQueryData(['puzzles', 'list'])).toBeUndefined();
  });

  it('on a 401 from a mutation does the same', async () => {
    const { client, onUnauthenticated } = setup();
    await failingMutation(client, err(401, 'UNAUTHENTICATED'));
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(['puzzles', 'list'])).toBeUndefined();
  });

  it('on a 403 ACCOUNT_BLOCKED from a query or a mutation calls onBlocked and marks the session blocked', async () => {
    const q = setup();
    await failingQuery(q.client, err(403, 'ACCOUNT_BLOCKED'));
    expect(q.onBlocked).toHaveBeenCalledTimes(1);
    expect(q.onUnauthenticated).not.toHaveBeenCalled();
    expect(q.client.getQueryData(keys.session)).toEqual({ blocked: true });
    expect(q.client.getQueryData(['puzzles', 'list'])).toBeUndefined();

    const m = setup();
    await failingMutation(m.client, err(403, 'ACCOUNT_BLOCKED'));
    expect(m.onBlocked).toHaveBeenCalledTimes(1);
  });

  it('does neither on a 403 FORBIDDEN or other errors', async () => {
    const { client, onUnauthenticated, onBlocked } = setup();
    await failingQuery(client, err(403, 'FORBIDDEN'));
    await failingMutation(client, err(404, 'NOT_FOUND'));
    await failingQuery(client, new Error('boom'));
    expect(onUnauthenticated).not.toHaveBeenCalled();
    expect(onBlocked).not.toHaveBeenCalled();
    expect(client.getQueryData(['puzzles', 'list'])).toEqual([1, 2, 3]);
  });
});

describe('defaults', () => {
  it('uses a 30 s stale time and never retries mutations', () => {
    const { client } = setup();
    expect(client.getDefaultOptions().queries?.staleTime).toBe(30_000);
    expect(client.getDefaultOptions().mutations?.retry).toBe(false);
  });

  it('retries once on network or 5xx and never on 4xx', () => {
    expect(shouldRetry(0, err(0, 'NETWORK'))).toBe(true);
    expect(shouldRetry(0, err(503, 'GRAPH_UNAVAILABLE'))).toBe(true);
    expect(shouldRetry(1, err(503, 'GRAPH_UNAVAILABLE'))).toBe(false);
    expect(shouldRetry(0, err(404, 'NOT_FOUND'))).toBe(false);
    expect(shouldRetry(0, err(422, 'VALIDATION_FAILED'))).toBe(false);
    expect(shouldRetry(0, err(200, 'CONTRACT_MISMATCH'))).toBe(false);
  });
});
