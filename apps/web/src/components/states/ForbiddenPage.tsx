import { Link } from '@tanstack/react-router';

/** 403 FORBIDDEN and the role guard only. Ownership never produces this page (it is a 404). */
export function ForbiddenPage() {
  return (
    <section className="mx-auto flex max-w-md flex-col gap-3 p-6">
      <h1 tabIndex={-1} className="text-2xl font-semibold">
        Forbidden
      </h1>
      <p>You do not have access to this page.</p>
      <Link to="/puzzles" className="underline">
        Back to puzzles
      </Link>
    </section>
  );
}
