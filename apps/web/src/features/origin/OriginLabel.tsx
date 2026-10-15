import type { Origin } from '~/lib/api/gameplay-schemas';
import { originLabel } from './origin';

/** Where a puzzle came from, always as visible text (never a tooltip only). */
export function OriginLabel({ origin, access, className }: { origin: Origin; access?: 'owner' | 'shared' | 'public'; className?: string }) {
  return (
    <p data-origin={origin} className={className ?? 'text-sm text-muted-foreground'}>
      {originLabel(origin, access)}
    </p>
  );
}
