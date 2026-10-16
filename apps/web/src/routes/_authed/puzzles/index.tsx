import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { RouteFocus } from '~/components/a11y/RouteFocus';
import { EmptyState } from '~/components/states/EmptyState';
import { ErrorState } from '~/components/states/ErrorState';
import { LoadingState } from '~/components/states/LoadingState';
import { PuzzleCard } from '~/features/play/PuzzleCard';
import { PuzzleActions } from '~/features/sharing/PuzzleActions';
import { puzzlesListOptions } from '~/lib/api/gameplay';

export const Route = createFileRoute('/_authed/puzzles/')({
  component: PuzzlesPage,
});

function PuzzlesPage() {
  const { user } = Route.useRouteContext();
  const puzzles = useQuery(puzzlesListOptions());
  return (
    <div className="flex flex-col gap-4">
      <RouteFocus title="Puzzles" />
      <h1 className="text-2xl leading-[30px] font-bold tracking-tight sm:text-[30px] sm:leading-9">
        Puzzles
      </h1>
      {puzzles.isPending && <LoadingState label="Loading puzzles" />}
      {puzzles.isError && (
        <ErrorState error={puzzles.error} onRetry={() => void puzzles.refetch()} />
      )}
      {puzzles.isSuccess && puzzles.data.length === 0 && (
        <EmptyState
          title="No puzzles yet."
          action={
            <div className="flex gap-4">
              <Link
                to={'/sources/new' as never}
                className="font-medium text-primary underline underline-offset-4 hover:text-primary-hover"
              >
                Create a puzzle
              </Link>
              <Link
                to={'/coach' as never}
                className="font-medium text-primary underline underline-offset-4 hover:text-primary-hover"
              >
                Ask the Coach
              </Link>
            </div>
          }
        />
      )}
      {puzzles.isSuccess && puzzles.data.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2" aria-label="Puzzles">
          {puzzles.data.map((puzzle) => (
            <li key={puzzle.id}>
              <PuzzleCard
                puzzle={puzzle}
                actions={<PuzzleActions puzzle={puzzle} role={user.role} ownEmail={user.email} />}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
