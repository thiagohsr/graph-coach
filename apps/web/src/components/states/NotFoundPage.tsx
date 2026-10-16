import { Link } from '@tanstack/react-router';
import { RouteFocus } from '~/components/a11y/RouteFocus';

/** Unknown route, or a 404 on primary data (missing, or not visible to this user). */
export function NotFoundPage() {
  return (
    <section className="mx-auto flex max-w-md flex-col gap-3 p-6">
      <RouteFocus title="Not found" />
      <h1
        tabIndex={-1}
        className="text-2xl leading-[30px] font-bold tracking-tight sm:text-[30px] sm:leading-9"
      >
        Not found
      </h1>
      <p>Not found.</p>
      <Link
        to="/puzzles"
        className="font-medium text-primary underline underline-offset-4 hover:text-primary-hover"
      >
        Back to puzzles
      </Link>
    </section>
  );
}
