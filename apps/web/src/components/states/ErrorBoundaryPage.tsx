import { useRouter } from '@tanstack/react-router';
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
    <div className="mx-auto max-w-xl p-6">
      <ErrorState error={error} onRetry={() => void router.invalidate()} />
    </div>
  );
}
