import { Skeleton } from '~/components/ui/skeleton';

/** A skeleton shaped like content, inside a busy region. Never a spinner-only page. */
export function LoadingState({ label = 'Loading', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div aria-busy="true" aria-label={label} role="status" className="flex flex-col gap-3 p-4">
      <span className="sr-only">{label}…</span>
      <Skeleton className="h-8 w-1/3" />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}
