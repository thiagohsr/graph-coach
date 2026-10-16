import { useRouter } from '@tanstack/react-router';
import { RouteFocus } from '~/components/a11y/RouteFocus';
import { ForbiddenError } from '~/lib/auth/guards';
import { isApiClientError } from '~/lib/api/errors';
import { ErrorState } from './ErrorState';
import { ForbiddenPage } from './ForbiddenPage';
import { NotFoundPage } from './NotFoundPage';

/** Route-level error component: Forbidden for the role guard and 403 FORBIDDEN, Not found for 404, else the error state. */
export function ErrorBoundaryPage({ error }: { error: unknown }) {
  const router = useRouter();
  if (error instanceof ForbiddenError) return <ForbiddenPage />;
  if (isApiClientError(error)) {
    if (error.status === 404) return <NotFoundPage />;
    if (error.status === 403 && error.code === 'FORBIDDEN') return <ForbiddenPage />;
  }
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-3 p-6">
      <RouteFocus title="Error" />
      <h1 tabIndex={-1} className="sr-only">
        Error
      </h1>
      <ErrorState error={error} onRetry={() => void router.invalidate()} />
    </div>
  );
}
