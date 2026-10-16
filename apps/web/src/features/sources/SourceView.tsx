import { PROMPT_ORIGIN_NOTICE } from '@coach/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect } from 'react';
import { RouteFocus } from '~/components/a11y/RouteFocus';
import { describeError } from '~/components/states/error-messages';
import { ErrorState } from '~/components/states/ErrorState';
import { LoadingState } from '~/components/states/LoadingState';
import { NotFoundPage } from '~/components/states/NotFoundPage';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { buttonVariants } from '~/components/ui/button';
import { sourceOptions } from '~/lib/api/curator';
import { puzzlesListOptions } from '~/lib/api/gameplay';
import { keys } from '~/lib/query/keys';
import { cn } from '~/lib/utils';
import { formatDate, kindLabel, ownerMarker } from './source-labels';

const DIFFICULTY: Record<string, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

/** `/sources/:id`: read-only. A 404 is also what a revoked share looks like. */
export function SourceView({ sourceId }: { sourceId: string }) {
  const queryClient = useQueryClient();
  const source = useQuery(sourceOptions(sourceId));
  const puzzles = useQuery(puzzlesListOptions());

  const notFound = source.isError && describeError(source.error).kind === 'not-found';
  useEffect(() => {
    if (!notFound) return;
    void queryClient.invalidateQueries({ queryKey: keys.sources.list });
    queryClient.removeQueries({ queryKey: keys.sources.detail(sourceId) });
  }, [notFound, queryClient, sourceId]);

  if (notFound) return <NotFoundPage />;

  const data = source.data;
  const playable = data?.puzzleId !== undefined && (puzzles.data ?? []).some((p) => p.id === data.puzzleId);
  const hasBody = data !== undefined && (data.content !== undefined || data.brief !== undefined);

  return (
    <div className="flex flex-col gap-4">
      <RouteFocus title={data?.title ?? 'Source'} />
      <p className="text-sm">
        <Link to="/sources" className="font-medium text-primary underline underline-offset-4 hover:text-primary-hover">
          Back to sources
        </Link>
      </p>
      {source.isPending && (
        <>
          <h1 className="text-2xl leading-[30px] font-bold tracking-tight sm:text-[30px] sm:leading-9">Source</h1>
          <LoadingState label="Loading source" rows={2} />
        </>
      )}
      {source.isError && (
        <>
          <h1 className="text-2xl leading-[30px] font-bold tracking-tight sm:text-[30px] sm:leading-9">Source</h1>
          <ErrorState error={source.error} onRetry={() => void source.refetch()} />
        </>
      )}
      {data && (
        <article className="flex flex-col gap-3" aria-labelledby="source-title">
          <h1 id="source-title" className="text-2xl leading-[30px] font-bold tracking-tight sm:text-[30px] sm:leading-9 break-words">
            {data.title}
          </h1>
          <p className="text-sm text-muted-foreground">
            {ownerMarker(data)} · {kindLabel(data.kind)} · <time dateTime={data.createdAt}>{formatDate(data.createdAt)}</time>
          </p>
          {!hasBody && (
            <Alert variant="destructive">
              <AlertDescription>Unexpected response from the server: the source has no text and no brief.</AlertDescription>
            </Alert>
          )}
          {data.content !== undefined && (
            <pre className="font-sans text-sm break-words whitespace-pre-wrap" aria-label="Source text">
              {data.content}
            </pre>
          )}
          {data.brief && (
            <section aria-labelledby="source-brief">
              <h2 id="source-brief" className="mb-2 text-lg font-semibold">
                What was asked for
              </h2>
              <p className="mb-2 text-sm text-muted-foreground">{PROMPT_ORIGIN_NOTICE}</p>
              <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="font-medium">Subject</dt>
                <dd>{data.brief.subject}</dd>
                {data.brief.focus && (
                  <>
                    <dt className="font-medium">Focus</dt>
                    <dd>{data.brief.focus}</dd>
                  </>
                )}
                <dt className="font-medium">Difficulty</dt>
                <dd>{DIFFICULTY[data.brief.difficulty] ?? data.brief.difficulty}</dd>
                <dt className="font-medium">Number of sentences</dt>
                <dd>{data.brief.sentences}</dd>
              </dl>
            </section>
          )}
          {playable && data.puzzleId && (
            <div>
              <Link
                to="/puzzles/$puzzleId/play"
                params={{ puzzleId: data.puzzleId }}
                className={cn(buttonVariants({ size: 'sm' }))}
              >
                Play
              </Link>
            </div>
          )}
        </article>
      )}
    </div>
  );
}
