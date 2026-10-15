import type { RecommendationDto } from '@coach/types';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { ErrorState } from '~/components/states/ErrorState';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Badge } from '~/components/ui/badge';
import { buttonVariants } from '~/components/ui/button';
import { isCode } from '~/lib/api/errors';
import { cn } from '~/lib/utils';
import { flagNotices } from './flags';

export function RecommendationCard({ recommendation: r }: { recommendation: RecommendationDto }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [r.decisionId]);

  const notices = flagNotices(r.flags);
  return (
    <article className="flex flex-col gap-4 rounded-lg border p-4" aria-labelledby="coach-card-heading">
      <div className="flex flex-col gap-1">
        <h2 id="coach-card-heading" ref={heading} tabIndex={-1} className="text-xl font-semibold">
          {r.target ? r.target.name : 'No specific concept'}
        </h2>
        {r.reused && <p className="text-sm text-muted-foreground">Reused from a recent decision</p>}
      </div>

      <p>{r.summary}</p>

      {notices.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Notes">
          {notices.map((text) => (
            <li key={text}>
              <Badge variant="secondary" className="whitespace-normal">
                {text}
              </Badge>
            </li>
          ))}
        </ul>
      )}

      {r.coverageGap && (
        <div className="text-sm">
          <p>Not enough content yet for:</p>
          <ul className="list-disc pl-6">
            {r.coverageGap.concepts.map((c) => (
              <li key={c.conceptId}>{c.name}</li>
            ))}
          </ul>
          {r.coverageTaskId && (
            // The task page is built in a later phase, so its route is not in the typed tree yet.
            <Link to={`/tasks/${encodeURIComponent(r.coverageTaskId)}` as never} className="underline">
              Follow the content request
            </Link>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {r.puzzle ? (
          <>
            <span>
              Recommended puzzle: <strong>{r.puzzle.name}</strong>
            </span>
            <Link
              to="/puzzles/$puzzleId/play"
              params={{ puzzleId: r.puzzle.id }}
              aria-label={`Play ${r.puzzle.name}`}
              className={cn(buttonVariants({ size: 'sm' }))}
            >
              Play
            </Link>
          </>
        ) : (
          <span>No puzzle is available for this yet</span>
        )}
      </div>

      <div className="text-sm">
        <h3 className="font-medium">Alternatives</h3>
        {r.alternatives.length > 0 ? (
          <ul className="list-disc pl-6">
            {r.alternatives.map((a) => (
              <li key={a.conceptId}>{a.name}</li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">No alternatives were considered</p>
        )}
      </div>

      <Link to="/decisions/$decisionId" params={{ decisionId: r.decisionId }} className="w-fit underline">
        Why this?
      </Link>
    </article>
  );
}

/** A failed "What next?" request. No card and no substitute recommendation is ever shown. */
export function CoachError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (isCode(error, 'NO_PLAYABLE_CONTENT')) {
    return (
      <Alert>
        <AlertDescription className="flex flex-col gap-2">
          <span>There is nothing to practise yet.</span>
          <span className="flex gap-4">
            <Link to={'/sources/new' as never} className="underline">
              Create a puzzle
            </Link>
            <Link to="/puzzles" className="underline">
              Browse puzzles
            </Link>
          </span>
        </AlertDescription>
      </Alert>
    );
  }
  if (isCode(error, 'GRAPH_UNAVAILABLE')) {
    return (
      <Alert variant="destructive">
        <AlertDescription className="flex flex-col items-start gap-2">
          The Coach needs the knowledge graph, which is unavailable. No recommendation was made.
          {onRetry && <RetryButton onRetry={onRetry} />}
        </AlertDescription>
      </Alert>
    );
  }
  return <ErrorState error={error} {...(onRetry ? { onRetry } : {})} />;
}

function RetryButton({ onRetry }: { onRetry: () => void }) {
  return (
    <button type="button" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))} onClick={onRetry}>
      Retry
    </button>
  );
}
