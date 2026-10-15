import { createFileRoute, redirect } from '@tanstack/react-router';
import { RouteFocus } from '~/components/a11y/RouteFocus';
import { BlockedNotice } from '~/features/auth/BlockedNotice';
import { isBlocked } from '~/lib/auth/guards';
import { useSignOut } from '~/lib/auth/use-sign-out';

export const Route = createFileRoute('/blocked')({
  // Public route, meaningful only for a blocked account.
  beforeLoad: ({ context }) => {
    if (context.session === null) throw redirect({ to: '/login' });
    if (!isBlocked(context.session)) throw redirect({ to: '/puzzles' });
  },
  component: BlockedPage,
});

function BlockedPage() {
  const signOut = useSignOut();
  return (
    <main id="main">
      <RouteFocus title="Account blocked" />
      <BlockedNotice onSignOut={() => void signOut()} />
    </main>
  );
}
