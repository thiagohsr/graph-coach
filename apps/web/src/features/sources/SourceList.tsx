import type { SourceSummaryDto } from '@coach/types';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { EmptyState } from '~/components/states/EmptyState';
import { ErrorState } from '~/components/states/ErrorState';
import { LoadingState } from '~/components/states/LoadingState';
import { buttonVariants } from '~/components/ui/button';
import { sourcesListOptions } from '~/lib/api/curator';
import { puzzlesListOptions } from '~/lib/api/gameplay';
import { cn } from '~/lib/utils';
import { formatDate, kindLabel, ownerMarker, TASK_STATUS_TEXT } from './source-labels';

function CreateLink() {
  return (
    <Link to="/sources/new" className={cn(buttonVariants())}>
      Create a puzzle
    </Link>
  );
}

function SourceRow({ source, playable }: { source: SourceSummaryDto; playable: boolean }) {
  const owner = source.access === 'owner';
  return (
    <li className="flex flex-col gap-1 rounded-lg border bg-card p-4 shadow-xs">
      <h2 className="text-lg font-semibold break-words">
        <Link
          to="/sources/$sourceId"
          params={{ sourceId: source.id }}
          className="font-medium text-primary underline underline-offset-4 hover:text-primary-hover"
        >
          {source.title}
        </Link>
      </h2>
      <p className="text-sm">
        {ownerMarker(source)} · {kindLabel(source.kind)} ·{' '}
        <time dateTime={source.createdAt}>{formatDate(source.createdAt)}</time>
      </p>
      {source.kind !== 'prompt' && (
        <p className="text-sm text-muted-foreground">
          {source.conceptCount} concepts · {source.chunkCount} passages
        </p>
      )}
      {source.kind === 'prompt' && (
        <p className="text-sm text-muted-foreground">{source.conceptCount} concepts</p>
      )}
      {owner && source.taskStatus && (
        <p className="text-sm">Run: {TASK_STATUS_TEXT[source.taskStatus]}</p>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-3 text-sm">
        {owner && source.taskId && (
          <Link
            to="/tasks/$taskId"
            params={{ taskId: source.taskId }}
            className="font-medium text-primary underline underline-offset-4 hover:text-primary-hover"
          >
            View run
          </Link>
        )}
        {owner && source.taskId && source.taskStatus === 'awaiting_review' && (
          <Link
            to="/review"
            search={{ taskId: source.taskId }}
            className="font-medium text-primary underline underline-offset-4 hover:text-primary-hover"
          >
            Review drafts
          </Link>
        )}
        {playable && source.puzzleId && (
          <Link
            to="/puzzles/$puzzleId/play"
            params={{ puzzleId: source.puzzleId }}
            className="font-medium text-primary underline underline-offset-4 hover:text-primary-hover"
          >
            Play
          </Link>
        )}
      </div>
    </li>
  );
}

/** `/sources`: newest first. Run and review links only for items the caller owns. */
export function SourceList() {
  const sources = useQuery(sourcesListOptions());
  const puzzles = useQuery(puzzlesListOptions());
  const playableIds = new Set((puzzles.data ?? []).map((p) => p.id));

  if (sources.isPending) return <LoadingState label="Loading sources" />;
  if (sources.isError)
    return <ErrorState error={sources.error} onRetry={() => void sources.refetch()} />;
  if (sources.data.length === 0) {
    return <EmptyState title="You have not created anything yet." action={<CreateLink />} />;
  }
  const sorted = [...sources.data].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <>
      <div>
        <CreateLink />
      </div>
      <ul className="flex flex-col gap-3" aria-label="Sources">
        {sorted.map((source) => (
          <SourceRow
            key={source.id}
            source={source}
            playable={source.puzzleId !== undefined && playableIds.has(source.puzzleId)}
          />
        ))}
      </ul>
    </>
  );
}
