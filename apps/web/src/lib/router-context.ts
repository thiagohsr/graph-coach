import type { QueryClient } from '@tanstack/react-query';

/** Context every route receives. `session` and `user` are added by the root and `_authed` layouts. */
export interface RouterContext {
  queryClient: QueryClient;
}
