import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { isApiClientError } from '../api/errors';
import { keys } from './keys';

export interface QueryClientHandlers {
  /** A 401 reached the browser: the session is gone. */
  onUnauthenticated: () => void;
  /** A 403 ACCOUNT_BLOCKED came back from any call. */
  onBlocked: () => void;
}

/** Retry once on network or 5xx errors, never on 4xx or a contract mismatch. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false;
  if (!isApiClientError(error)) return true;
  return error.status === 0 || error.status >= 500;
}

export function createQueryClient({ onUnauthenticated, onBlocked }: QueryClientHandlers): QueryClient {
  const handle = (error: unknown) => {
    if (!isApiClientError(error)) return;
    if (error.status === 401) {
      client.clear();
      onUnauthenticated();
    } else if (error.status === 403 && error.code === 'ACCOUNT_BLOCKED') {
      client.clear();
      client.setQueryData(keys.session, { blocked: true });
      onBlocked();
    }
  };

  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: handle }),
    mutationCache: new MutationCache({ onError: handle }),
    defaultOptions: {
      queries: { staleTime: 30_000, retry: shouldRetry },
      mutations: { retry: false },
    },
  });
  return client;
}
