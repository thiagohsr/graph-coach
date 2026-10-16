import type { ReviewOutcome } from '@coach/types';
import { Link } from '@tanstack/react-router';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { buttonVariants } from '~/components/ui/button';
import { cn } from '~/lib/utils';

/** "2 of the 3 questions needed were approved." */
export function notPublishedSentence(reason: NonNullable<ReviewOutcome['notPublishedReason']>): string {
  return `${reason.approved} of the ${reason.minQuestions} questions needed were approved.`;
}

function PlayLink({ puzzleId }: { puzzleId: string }) {
  return (
    <Link to="/puzzles/$puzzleId/play" params={{ puzzleId }} className={cn(buttonVariants({ size: 'sm' }))}>
      Play
    </Link>
  );
}

/**
 * What happened to the puzzle after a decision (FR-W14). The "Puzzle published" notice appears as soon as the puzzle
 * is published, even before the last draft; the final panel appears when no draft remains. There is no visibility or
 * sharing control here: sharing is done from the puzzle list.
 */
export function ReviewOutcomePanel({ outcome }: { outcome: ReviewOutcome }) {
  const published = outcome.puzzle.status === 'published';

  if (outcome.remainingDrafts === 0) {
    return (
      <section aria-label="Review outcome" className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-xs">
        {published ? (
          <>
            <h2 id="outcome-heading" tabIndex={-1} className="text-lg font-semibold outline-none">
              {`Puzzle published (${outcome.puzzle.visibility})`}
            </h2>
            <div className="flex flex-wrap items-center gap-3">
              <PlayLink puzzleId={outcome.puzzle.id} />
              <Link to="/puzzles" className="text-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover">
                Share it from the puzzle list
              </Link>
            </div>
          </>
        ) : (
          <>
            <h2 id="outcome-heading" tabIndex={-1} className="text-lg font-semibold outline-none">
              Puzzle not published:
            </h2>
            <p>{outcome.notPublishedReason ? notPublishedSentence(outcome.notPublishedReason) : 'No questions were approved.'}</p>
            <Link to="/sources" className="text-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover">
              Back to sources
            </Link>
          </>
        )}
      </section>
    );
  }

  if (published) {
    return (
      <Alert role="status">
        <AlertDescription className="flex flex-wrap items-center gap-3">
          <span>Puzzle published</span>
          <PlayLink puzzleId={outcome.puzzle.id} />
        </AlertDescription>
      </Alert>
    );
  }
  return null;
}
