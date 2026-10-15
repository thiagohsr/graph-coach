import { Outlet, createFileRoute } from '@tanstack/react-router';
import { requireRole } from '~/lib/auth/guards';

// The role guard: other roles get the Forbidden page (the root error component renders it).
// A 403 FORBIDDEN from the API on the admin queries is honoured the same way.
export const Route = createFileRoute('/_authed/admin')({
  beforeLoad: ({ context }) => {
    requireRole(context.user, 'admin');
  },
  component: () => <Outlet />,
});
