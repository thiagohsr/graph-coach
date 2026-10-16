import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '~/lib/utils';

/**
 * A static, hand-written excerpt of a real "Why this?" path, in the visual language of
 * features/coach/WhyPathGraph (puzzle = teal square, concept = violet pill, evidence = dashed).
 * No API call: signed-out visitors see the same kind of explanation a learner gets.
 */
function Node({ kind, label, children }: { kind: string; label: string; children: ReactNode }) {
  const shape =
    kind === 'Puzzle'
      ? 'rounded-md border-[1.5px] border-primary bg-primary-soft'
      : kind === 'Target concept'
        ? 'rounded-3xl border-2 border-graph bg-graph-soft'
        : kind === 'Concept'
          ? 'rounded-3xl border-[1.5px] border-graph bg-graph-soft'
          : 'rounded-md border border-dashed border-input bg-muted';
  const tone =
    kind === 'Puzzle'
      ? 'text-primary'
      : kind.includes('oncept')
        ? 'text-graph'
        : 'text-muted-foreground';
  return (
    <li className={cn('flex min-w-0 flex-col justify-center px-4 py-3', shape)}>
      <span className={cn('font-mono text-[11px] font-medium tracking-[0.04em] uppercase', tone)}>
        {kind}
      </span>
      <span className="text-sm font-semibold text-foreground">{children}</span>
      <span className="sr-only">{label}</span>
    </li>
  );
}

function Link({ children }: { children: string }) {
  return (
    <li
      aria-hidden="true"
      className="flex items-center justify-center gap-1 text-xs text-muted-foreground max-lg:flex-col"
    >
      <span className="max-lg:order-2">{children}</span>
      <ArrowRight className="size-4 text-graph max-lg:order-1 max-lg:rotate-90" />
    </li>
  );
}

export function WhyShowcase() {
  return (
    <figure className="rounded-xl border bg-card p-4 shadow-xs sm:p-6">
      <figcaption className="mb-4 text-sm text-text-secondary">
        Example: the Coach picked a puzzle about B-trees. Here is the reason, step by step.
      </figcaption>
      <ol className="grid items-stretch gap-2 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]">
        <Node kind="Evidence" label="You missed it four times">
          Missed &ldquo;Indexes&rdquo; 4 times
        </Node>
        <Link>weak concept</Link>
        <Node kind="Concept" label="Weak concept">
          Indexes
        </Node>
        <Link>prerequisite of</Link>
        <Node kind="Target concept" label="Practise this first">
          B-trees
        </Node>
        <Link>practised in</Link>
        <Node kind="Puzzle" label="Next puzzle">
          Databases 101: Storage and B-trees
        </Node>
      </ol>
      <div
        role="group"
        aria-label="Legend"
        className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground"
      >
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-3 w-5 rounded-sm border-[1.5px] border-primary bg-primary-soft"
          />
          Puzzle
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-3 w-5 rounded-full border-[1.5px] border-graph bg-graph-soft"
          />
          Concept
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-3 w-5 rounded-sm border border-dashed border-input bg-muted"
          />
          Evidence
        </span>
      </div>
    </figure>
  );
}
