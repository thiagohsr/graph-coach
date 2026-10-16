import { Link } from '@tanstack/react-router';
import { RouteFocus } from '~/components/a11y/RouteFocus';

/** 403 FORBIDDEN and the role guard only. Ownership never produces this page (it is a 404). */
export function ForbiddenPage() {
  return (
    <section className="mx-auto flex max-w-md flex-col gap-3 p-6">
      <RouteFocus title="Forbidden" />
      <h1 tabIndex={-1} className="text-2xl leading-[30px] font-bold tracking-tight sm:text-[30px] sm:leading-9">
        Forbidden
      </h1>
      <p>You do not have access to this page.</p>
      <Link to="/puzzles" className="font-medium text-primary underline underline-offset-4 hover:text-primary-hover">
        Back to puzzles
      </Link>
    </section>
  );
}
