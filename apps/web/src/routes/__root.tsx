import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { ErrorBoundaryPage } from '~/components/states/ErrorBoundaryPage';
import { NotFoundPage } from '~/components/states/NotFoundPage';
import { getSessionFn } from '~/lib/auth/session.functions';
import { keys } from '~/lib/query/keys';
import type { RouterContext } from '~/lib/router-context';
import { themeInitScript } from '~/lib/theme/theme';
import appCss from '~/styles/app.css?url';

export const Route = createRootRouteWithContext<RouterContext>()({
  // The session is resolved on the server for the first request, then reused from the query cache
  // (stale after 5 minutes) on client navigations.
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData({
      queryKey: keys.session,
      queryFn: () => getSessionFn(),
      staleTime: 5 * 60_000,
    });
    return { session };
  },
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Graph Coach' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
    // Before first paint: the stored or system theme, so dark never flashes light.
    scripts: [{ children: themeInitScript }],
  }),
  shellComponent: RootDocument,
  component: () => <Outlet />,
  errorComponent: ErrorBoundaryPage,
  notFoundComponent: () => <NotFoundPage />,
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    // The theme script sets data-theme on <html> before React hydrates it.
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
