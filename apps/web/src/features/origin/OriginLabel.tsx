import { FileTextIcon, SproutIcon, TriangleAlertIcon } from 'lucide-react';
import type { Origin } from '~/lib/api/gameplay-schemas';
import { cn } from '~/lib/utils';
import { originLabel } from './origin';

/** Where a puzzle came from, always as visible text (never a tooltip only). The prompt origin is a wrapping notice. */
export function OriginLabel({ origin, access, className }: { origin: Origin; access?: 'owner' | 'shared' | 'public'; className?: string }) {
  const Icon = origin === 'prompt' ? TriangleAlertIcon : origin === 'seed' ? SproutIcon : FileTextIcon;
  return (
    <p
      data-origin={origin}
      className={cn(
        'flex w-fit max-w-full items-start gap-1.5 text-[13px] leading-[18px] font-semibold',
        origin === 'prompt' ? 'rounded-md bg-warning-soft px-2.5 py-1.5 text-warning' : 'rounded-full border bg-card px-2.5 py-1 text-text-secondary',
        className,
      )}
    >
      <Icon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
      <span>{originLabel(origin, access)}</span>
    </p>
  );
}
