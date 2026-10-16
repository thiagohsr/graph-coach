import { Link } from '@tanstack/react-router';
import { CircleDotIcon, GlobeIcon, Share2Icon } from 'lucide-react';
import type { ReactNode } from 'react';
import { buttonVariants } from '~/components/ui/button';
import { OriginLabel } from '~/features/origin/OriginLabel';
import type { PuzzleSummary } from '~/lib/api/gameplay-schemas';
import { cn } from '~/lib/utils';

/** "Yours" (plus "· Public"), "Shared by …", or "Public" (FR-W13). Text, never colour only. */
export function accessLabel(
  puzzle: Pick<PuzzleSummary, 'access' | 'visibility' | 'ownerName'>,
): string {
  if (puzzle.access === 'owner') return puzzle.visibility === 'public' ? 'Yours · Public' : 'Yours';
  if (puzzle.access === 'shared') return `Shared by ${puzzle.ownerName}`;
  return 'Public';
}

function AccessBadge({ puzzle }: { puzzle: PuzzleSummary }) {
  const Icon =
    puzzle.access === 'owner' ? CircleDotIcon : puzzle.access === 'shared' ? Share2Icon : GlobeIcon;
  const tone =
    puzzle.access === 'owner'
      ? 'border-transparent bg-primary-soft text-primary'
      : puzzle.access === 'shared'
        ? 'border-transparent bg-graph-soft text-graph'
        : 'border-input bg-card text-text-secondary';
  return (
    <p
      className={cn(
        'inline-flex w-fit items-center gap-1.5 rounded-full border px-[9px] py-1 text-xs leading-4 font-semibold',
        tone,
      )}
    >
      <Icon aria-hidden="true" className="size-3" />
      {accessLabel(puzzle)}
    </p>
  );
}

function SourceInfo({ puzzle }: { puzzle: PuzzleSummary }) {
  // A source link is built only from a `sourceId` the API sent (it sends one only when the caller may read the source).
  const href = puzzle.sourceId ? `/sources/${puzzle.sourceId}` : null;
  if (puzzle.access === 'shared') {
    const text = puzzle.sourceShared ? 'Source available' : 'Source not shared';
    return href ? (
      <Link
        to={href as never}
        className="relative z-10 text-[13px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        {text}
      </Link>
    ) : (
      <span className="text-[13px] text-muted-foreground">{text}</span>
    );
  }
  if (puzzle.access === 'owner' && href) {
    return (
      <Link
        to={href as never}
        className="relative z-10 text-[13px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        Source
      </Link>
    );
  }
  return null;
}

/**
 * One puzzle of the list. Sharing and visibility controls arrive only through `actions`.
 * The whole card opens the puzzle: the Play link's ::after covers the card (one link, so screen readers and the
 * keyboard still meet a single "Play" control); the source link and `actions` sit above it and keep working.
 */
export function PuzzleCard({ puzzle, actions }: { puzzle: PuzzleSummary; actions?: ReactNode }) {
  return (
    <article
      className="relative flex h-full cursor-pointer flex-col justify-between gap-4 rounded-lg border bg-card p-5 shadow-xs transition-[box-shadow,border-color] duration-(--duration-fast) hover:border-primary/40 hover:shadow-sm"
      aria-labelledby={`puzzle-${puzzle.id}`}
    >
      <div className="flex flex-col items-start gap-2">
        <h2 id={`puzzle-${puzzle.id}`} className="text-lg leading-6 font-semibold">
          {puzzle.name}
        </h2>
        <AccessBadge puzzle={puzzle} />
        <OriginLabel origin={puzzle.origin} access={puzzle.access} />
        <p className="text-sm text-muted-foreground">
          {puzzle.questionCount} {puzzle.questionCount === 1 ? 'question' : 'questions'}
        </p>
        {puzzle.concepts.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Concepts: {puzzle.concepts.map((c) => c.name).join(', ')}
          </p>
        )}
        <SourceInfo puzzle={puzzle} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to="/puzzles/$puzzleId/play"
          params={{ puzzleId: puzzle.id }}
          aria-label={`Play ${puzzle.name}`}
          className={cn(
            buttonVariants({ size: 'sm' }),
            // No press-shift here: any `translate` other than `none` (Tailwind v4's translate-y-* sets the CSS
            // `translate` property, even translate-y-0) makes the link the containing block of its ::after, which
            // then shrinks to the button mid-click, so the release lands on the card and the click is lost.
            'after:absolute after:inset-0 after:rounded-lg after:content-[""] active:translate-none',
          )}
        >
          Play
        </Link>
        {actions && (
          <div className="relative z-10 flex flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
    </article>
  );
}
