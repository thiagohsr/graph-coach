import type { TaskKind } from '@coach/types';
import { Badge } from '~/components/ui/badge';
import { cn } from '~/lib/utils';
import { diagramSteps, type DiagramStatus, type PipelineState } from './pipeline-state';

const STATUS_TEXT: Record<DiagramStatus, string> = {
  pending: 'pending',
  active: 'active',
  complete: 'complete',
  error: 'error',
};

/**
 * The run's steps as an ordered list, horizontal from 640 px and vertical below. Each item's text carries its
 * status; the active one has `aria-current="step"`. No pulsing under reduced motion (the global rule disables it).
 */
export function PipelineDiagram({ kind, state }: { kind: TaskKind; state: PipelineState }) {
  const items = diagramSteps(kind, state);
  return (
    <ol aria-label="Pipeline steps" className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      {items.map((item) => (
        <li
          key={`${item.node}`}
          data-status={item.status}
          {...(item.status === 'active' ? { 'aria-current': 'step' as const } : {})}
          className={cn(
            'flex flex-1 items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm sm:min-w-32 sm:flex-col sm:items-start',
            item.status === 'active' && 'border-primary',
            item.status === 'error' && 'border-destructive',
          )}
        >
          <span className="font-medium">{item.label}</span>
          <span className="sr-only">: </span>
          <Badge
            variant={item.status === 'error' ? 'destructive' : item.status === 'complete' ? 'default' : 'secondary'}
            className={item.status === 'active' ? 'motion-safe:animate-pulse' : undefined}
          >
            {STATUS_TEXT[item.status]}
          </Badge>
        </li>
      ))}
    </ol>
  );
}
