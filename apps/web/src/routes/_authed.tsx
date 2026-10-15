import { Outlet, createFileRoute } from '@tanstack/react-router';
import { AppShell } from '~/components/layout/AppShell';
import { requireSession } from '~/lib/auth/guards';

// Everything below this layout needs a signed-in, unblocked user. Its data is fetched in the browser only
// (research R3): one path to the API, through the forwarding route.
export const Route = createFileRoute('/_authed')({
  ssr: false,
  beforeLoad: ({ context, location }) => ({
    user: requireSession(context.session, { pathname: location.pathname, search: location.searchStr }),
  }),
  component: AuthedLayout,
});

function AuthedLayout() {
  const { user } = Route.useRouteContext();
  return (
    <AppShell user={user}>
      <Outlet />
    </AppShell>
  );
}
