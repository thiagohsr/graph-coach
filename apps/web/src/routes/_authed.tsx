import { Outlet, createFileRoute } from '@tanstack/react-router';
import { AppShell } from '~/components/layout/AppShell';
import { requireSession, type SessionState } from '~/lib/auth/guards';

// Everything below this layout needs a signed-in, unblocked user. The session check runs in `beforeLoad` on the
// server for the first request (so a signed-out request gets a redirect response, not an empty 200 page) and
// in the browser on client navigations. Data is still fetched in the browser only (research R3): one path to
// the API, through the forwarding route; there are no route loaders here.
export const authedBeforeLoad = ({
  context,
  location,
}: {
  context: { session: SessionState };
  location: { pathname: string; searchStr?: string };
}) => ({
  user: requireSession(context.session, {
    pathname: location.pathname,
    search: location.searchStr,
  }),
});

export const Route = createFileRoute('/_authed')({
  beforeLoad: authedBeforeLoad,
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
