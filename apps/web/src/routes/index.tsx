import { createFileRoute, redirect } from '@tanstack/react-router';
import { isBlocked } from '~/lib/auth/guards';

// "/" has no content of its own: signed-in users go to the puzzles, everyone else to the sign-in page.
export const Route = createFileRoute('/')({
  beforeLoad: ({ context }) => {
    if (context.session === null) throw redirect({ to: '/login' });
    if (isBlocked(context.session)) throw redirect({ to: '/blocked' });
    throw redirect({ to: '/puzzles' });
  },
});
