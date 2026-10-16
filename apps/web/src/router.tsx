import { QueryClientProvider } from '@tanstack/react-query';
import { createRouter, type AnyRouter } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { ErrorBoundaryPage } from '~/components/states/ErrorBoundaryPage';
import { LoadingState } from '~/components/states/LoadingState';
import { NotFoundPage } from '~/components/states/NotFoundPage';
import { safeRedirect } from '~/lib/auth/guards';
import { createQueryClient } from '~/lib/query/client';
import { routeTree } from './routeTree.gen';

/** Start calls this once per request on the server and once in the browser. */
export function getRouter() {
  const ref: { router?: AnyRouter } = {};

  const queryClient = createQueryClient({
    // A 401 reached the browser: the session is gone. Sign in again and come back here (FR-W12).
    onUnauthenticated: () => {
      const router = ref.router;
      if (!router || router.state.location.pathname.startsWith('/login')) return;
      void router.navigate({
        to: '/login',
        search: { redirect: safeRedirect(router.state.location.href) },
      });
    },
    // A 403 ACCOUNT_BLOCKED from any call (FR-W25).
    onBlocked: () => {
      const router = ref.router;
      if (!router || router.state.location.pathname.startsWith('/blocked')) return;
      void router.navigate({ to: '/blocked' });
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    scrollRestoration: true,
    defaultPendingComponent: () => <LoadingState />,
    defaultNotFoundComponent: () => <NotFoundPage />,
    defaultErrorComponent: ErrorBoundaryPage,
    Wrap: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
  ref.router = router;
  return router;
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
