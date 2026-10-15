import { Link } from '@tanstack/react-router';
import { EmptyState } from '~/components/states/EmptyState';
import type { MasteryItem } from '~/lib/api/gameplay-schemas';

/** Weakest first. The values are the server's; this only orders and formats them. */
export function weakestFirst(items: MasteryItem[]): MasteryItem[] {
  return [...items].sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

export function MasteryList({ items }: { items: MasteryItem[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="Play a puzzle to start building your mastery."
        action={
          <Link to={'/puzzles' as never} className="underline">
            Go to puzzles
          </Link>
        }
      />
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {weakestFirst(items).map((item) => {
        const percent = `${Math.round(item.score * 100)}%`;
        const labelId = `mastery-${item.conceptId}`;
        return (
          <li key={item.conceptId} className="flex flex-col gap-1 rounded-lg border p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span id={labelId} className="font-medium">
                {item.name}
              </span>
              <span className="text-sm text-muted-foreground">
                {item.attempts} {item.attempts === 1 ? 'attempt' : 'attempts'} · last seen {formatDate(item.lastSeen)}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div
                role="meter"
                aria-labelledby={labelId}
                aria-valuemin={0}
                aria-valuemax={1}
                aria-valuenow={item.score}
                aria-valuetext={percent}
                className="h-3 flex-1 overflow-hidden rounded-full bg-muted"
              >
                <div className="h-full bg-primary" style={{ width: percent }} />
              </div>
              <span className="w-12 text-right text-sm font-medium">{percent}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
