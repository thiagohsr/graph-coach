import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { RouteFocus } from '~/components/a11y/RouteFocus';
import { describeError } from '~/components/states/error-messages';
import { EmptyState } from '~/components/states/EmptyState';
import { ErrorState } from '~/components/states/ErrorState';
import { LoadingState } from '~/components/states/LoadingState';
import { NotFoundPage } from '~/components/states/NotFoundPage';
import { ResultView } from '~/features/play/ResultView';
import { isCode } from '~/lib/api/errors';
import { sessionResultOptions } from '~/lib/api/gameplay';

export const Route = createFileRoute('/_authed/sessions/$sessionId/result')({
  component: ResultPage,
});

function ResultPage() {
  const { sessionId } = Route.useParams();
  const result = useQuery(sessionResultOptions(sessionId));

  if (result.isError && describeError(result.error).kind === 'not-found') return <NotFoundPage />;

  return (
    <div className="flex flex-col gap-4">
      <RouteFocus title={result.data ? `Result: ${result.data.puzzle.name}` : 'Result'} />
      {result.isPending && (
        <>
          <h1 className="text-2xl leading-[30px] font-bold tracking-tight sm:text-[30px] sm:leading-9">
            Result
          </h1>
          <LoadingState label="Loading result" rows={4} />
        </>
      )}
      {result.isError && isCode(result.error, 'SESSION_NOT_SUBMITTED') && (
        <>
          <h1 className="text-2xl leading-[30px] font-bold tracking-tight sm:text-[30px] sm:leading-9">
            Result
          </h1>
          <EmptyState
            title="This session has not been submitted yet."
            action={
              <Link
                to={'/puzzles' as never}
                className="font-medium text-primary underline underline-offset-4 hover:text-primary-hover"
              >
                Back to puzzles
              </Link>
            }
          />
        </>
      )}
      {result.isError && !isCode(result.error, 'SESSION_NOT_SUBMITTED') && (
        <>
          <h1 className="text-2xl leading-[30px] font-bold tracking-tight sm:text-[30px] sm:leading-9">
            Result
          </h1>
          <ErrorState error={result.error} onRetry={() => void result.refetch()} />
        </>
      )}
      {result.isSuccess && <ResultView result={result.data} />}
    </div>
  );
}
