import { createFileRoute, redirect } from '@tanstack/react-router';
import { LandingPage } from '~/features/landing/LandingPage';
import { getAuthModeFn } from '~/lib/auth/session.functions';
import { isBlocked } from '~/lib/auth/guards';

const TITLE = 'Graph Coach: a study coach that remembers what you know';
const DESCRIPTION =
  'Play fill-in-the-blank puzzles. An AI coach tracks your mastery in a knowledge graph, picks your next puzzle, and shows why. Turn your notes into puzzles, free.';

// Signed-out visitors get the landing page; signed-in users go to the puzzles (or the blocked page).
export const Route = createFileRoute('/')({
  beforeLoad: ({ context }) => {
    if (context.session === null) return;
    if (isBlocked(context.session)) throw redirect({ to: '/blocked' });
    throw redirect({ to: '/puzzles' });
  },
  loader: () => getAuthModeFn(),
  head: () => ({
    meta: [
      { title: TITLE },
      { name: 'description', content: DESCRIPTION },
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: 'Graph Coach' },
      { property: 'og:title', content: TITLE },
      { property: 'og:description', content: DESCRIPTION },
      { name: 'twitter:card', content: 'summary' },
      { name: 'twitter:title', content: TITLE },
      { name: 'twitter:description', content: DESCRIPTION },
    ],
  }),
  component: Landing,
});

function Landing() {
  return <LandingPage mode={Route.useLoaderData()} />;
}
