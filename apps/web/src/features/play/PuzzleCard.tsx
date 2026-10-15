import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { buttonVariants } from '~/components/ui/button';
import { OriginLabel } from '~/features/origin/OriginLabel';
import type { PuzzleSummary } from '~/lib/api/gameplay-schemas';
import { cn } from '~/lib/utils';

/** "Yours" (plus "· Public"), "Shared by …", or "Public" (FR-W13). Text, never colour only. */
export function accessLabel(puzzle: Pick<PuzzleSummary, 'access' | 'visibility' | 'ownerName'>): string {
  if (puzzle.access === 'owner') return puzzle.visibility === 'public' ? 'Yours · Public' : 'Yours';
  if (puzzle.access === 'shared') return `Shared by ${puzzle.ownerName}`;
  return 'Public';
}

function SourceInfo({ puzzle }: { puzzle: PuzzleSummary }) {
  // A source link is built only from a `sourceId` the API sent (it sends one only when the caller may read the source).
  const href = puzzle.sourceId ? `/sources/${puzzle.sourceId}` : null;
  if (puzzle.access === 'shared') {
    const text = puzzle.sourceShared ? 'Source available' : 'Source not shared';
    return href ? (
      <Link to={href as never} className="text-sm underline">
        {text}
      </Link>
    ) : (
      <span className="text-sm">{text}</span>
    );
  }
  if (puzzle.access === 'owner' && href) {
    return (
      <Link to={href as never} className="text-sm underline">
        Source
      </Link>
    );
  }
  return null;
}

/** One puzzle of the list. Sharing and visibility controls arrive only through `actions`. */
export function PuzzleCard({ puzzle, actions }: { puzzle: PuzzleSummary; actions?: ReactNode }) {
  return (
    <article className="flex flex-col gap-3 rounded-lg border p-4" aria-labelledby={`puzzle-${puzzle.id}`}>
      <div className="flex flex-col gap-1">
        <h2 id={`puzzle-${puzzle.id}`} className="text-lg font-semibold">
          {puzzle.name}
        </h2>
        <p className="text-sm font-medium">{accessLabel(puzzle)}</p>
        <OriginLabel origin={puzzle.origin} access={puzzle.access} />
        <p className="text-sm text-muted-foreground">
          {puzzle.questionCount} {puzzle.questionCount === 1 ? 'question' : 'questions'}
        </p>
        {puzzle.concepts.length > 0 && (
          <p className="text-sm text-muted-foreground">Concepts: {puzzle.concepts.map((c) => c.name).join(', ')}</p>
        )}
        <SourceInfo puzzle={puzzle} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to="/puzzles/$puzzleId/play"
          params={{ puzzleId: puzzle.id }}
          aria-label={`Play ${puzzle.name}`}
          className={cn(buttonVariants({ size: 'sm' }))}
        >
          Play
        </Link>
        {actions}
      </div>
    </article>
  );
}
