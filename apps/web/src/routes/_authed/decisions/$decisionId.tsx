import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { RouteFocus } from '~/components/a11y/RouteFocus';
import { describeError } from '~/components/states/error-messages';
import { ErrorState } from '~/components/states/ErrorState';
import { LoadingState } from '~/components/states/LoadingState';
import { NotFoundPage } from '~/components/states/NotFoundPage';
import { Badge } from '~/components/ui/badge';
import { buttonVariants } from '~/components/ui/button';
import { flagNotices } from '~/features/coach/flags';
import { WhyPath } from '~/features/coach/WhyPath';
import { decisionOptions, decisionPathOptions } from '~/lib/api/coach';
import { cn } from '~/lib/utils';

// The decision and its path are requested in parallel. There is no client-side owner check: the API answers
// 404 for anyone who may not see the decision, and an admin may open any (reconciliation C4/G8).
export const Route = createFileRoute('/_authed/decisions/$decisionId')({
  component: DecisionPage,
});

function DecisionPage() {
  const { decisionId } = Route.useParams();
  const decision = useQuery(decisionOptions(decisionId));
  const path = useQuery(decisionPathOptions(decisionId));

  const failed = decision.error ?? path.error;
  if (failed && describeError(failed).kind === 'not-found') return <NotFoundPage />;

  return (
    <div className="flex flex-col gap-6">
      <RouteFocus title="Why this?" />
      <h1 className="text-2xl leading-[30px] font-bold tracking-tight sm:text-[30px] sm:leading-9">Why this?</h1>

      {decision.isPending && <LoadingState label="Loading decision" rows={1} />}
      {decision.isError && <ErrorState error={decision.error} onRetry={() => void decision.refetch()} />}
      {decision.isSuccess && (
        <section className="flex flex-col gap-2 rounded-lg border bg-card p-5 shadow-xs" aria-label="Decision">
          <p>{decision.data.summary}</p>
          <p className="text-sm text-muted-foreground">
            {decision.data.target ? `Target: ${decision.data.target.name} · ` : ''}
            <time dateTime={decision.data.createdAt}>{new Date(decision.data.createdAt).toLocaleString()}</time>
          </p>
          {flagNotices(decision.data.flags).length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="Notes">
              {flagNotices(decision.data.flags).map((text) => (
                <li key={text}>
                  <Badge variant="warning" className="rounded-md whitespace-normal">
                    {text}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          {decision.data.puzzle && (
            <div className="flex flex-wrap items-center gap-3">
              <span>
                Puzzle: <strong>{decision.data.puzzle.name}</strong>
              </span>
              <Link
                to="/puzzles/$puzzleId/play"
                params={{ puzzleId: decision.data.puzzle.id }}
                aria-label={`Play ${decision.data.puzzle.name}`}
                className={cn(buttonVariants({ size: 'sm' }))}
              >
                Play
              </Link>
            </div>
          )}
        </section>
      )}

      {path.isPending && <LoadingState label="Loading evidence" rows={2} />}
      {path.isError && <ErrorState error={path.error} onRetry={() => void path.refetch()} />}
      {path.isSuccess && <WhyPath path={path.data} />}
    </div>
  );
}
