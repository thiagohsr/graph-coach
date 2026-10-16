import { createFileRoute } from '@tanstack/react-router';
import { AccountPage } from '~/features/account/AccountPage';

export const Route = createFileRoute('/_authed/account')({
  component: AccountRoute,
});

function AccountRoute() {
  const { user } = Route.useRouteContext();
  return <AccountPage user={user} />;
}
