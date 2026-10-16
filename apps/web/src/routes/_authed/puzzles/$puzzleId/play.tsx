import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { RouteFocus } from '~/components/a11y/RouteFocus';
import { describeError } from '~/components/states/error-messages';
import { ErrorState } from '~/components/states/ErrorState';
import { LoadingState } from '~/components/states/LoadingState';
import { NotFoundPage } from '~/components/states/NotFoundPage';
import { PlayBoard, PlayHeader } from '~/features/play/PlayBoard';
import { playOptions } from '~/lib/api/gameplay';

// Data decision: no `loader` prefetch. The play query has `gcTime: 0` (the bank is reshuffled per request),
// so a prefetched entry with no observer could be discarded before this component mounts. The component
// fetches it once through `useQuery` with the same options.
export const Route = createFileRoute('/_authed/puzzles/$puzzleId/play')({
  component: PlayPage,
});

function PlayPage() {
  const { puzzleId } = Route.useParams();
  const play = useQuery(playOptions(puzzleId));

  if (play.isError && describeError(play.error).kind === 'not-found') return <NotFoundPage />;

  return (
    <div className="flex flex-col gap-4">
      <RouteFocus title={play.data ? `Play ${play.data.name}` : 'Play'} />
      {play.isPending && (
        <>
          <h1 className="text-2xl leading-[30px] font-bold tracking-tight sm:text-[30px] sm:leading-9">Play</h1>
          <LoadingState label="Loading puzzle" rows={4} />
        </>
      )}
      {play.isError && (
        <>
          <h1 className="text-2xl leading-[30px] font-bold tracking-tight sm:text-[30px] sm:leading-9">Play</h1>
          <ErrorState error={play.error} onRetry={() => void play.refetch()} />
        </>
      )}
      {play.isSuccess && (
        <>
          <PlayHeader puzzle={play.data} />
          <PlayBoard key={play.data.id} puzzle={play.data} />
        </>
      )}
    </div>
  );
}
