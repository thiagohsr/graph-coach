import { Link } from '@tanstack/react-router';
import { RouteFocus } from '~/components/a11y/RouteFocus';

/** Unknown route, or a 404 on primary data (missing, or not visible to this user). */
export function NotFoundPage() {
  return (
    <section className="mx-auto flex max-w-md flex-col gap-3 p-6">
      <RouteFocus title="Not found" />
      <h1 tabIndex={-1} className="text-2xl font-semibold">
        Not found
      </h1>
      <p>Not found.</p>
      <Link to="/puzzles" className="underline">
        Back to puzzles
      </Link>
    </section>
  );
}
