import type { TaskKind } from '@coach/types';
import { CheckIcon } from 'lucide-react';
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
    <ol aria-label="Pipeline steps" className="flex flex-col gap-4 [counter-reset:step] sm:flex-row sm:gap-0">
      {items.map((item) => (
        <li
          key={`${item.node}`}
          data-status={item.status}
          {...(item.status === 'active' ? { 'aria-current': 'step' as const } : {})}
          className={cn(
            'relative flex items-center gap-3 sm:flex-1 sm:flex-col sm:gap-2 sm:text-center',
            // Connector edge to the next node: vertical below 640 px, horizontal from it.
            'after:absolute after:border-border last:after:hidden max-sm:after:top-8 max-sm:after:left-3.5 max-sm:after:h-4 max-sm:after:border-l-2 max-sm:after:border-dashed',
            'sm:after:top-3.5 sm:after:right-[calc(-50%+22px)] sm:after:left-[calc(50%+22px)] sm:after:border-t-2 sm:after:border-dashed',
            item.status === 'active' && 'after:border-input',
            item.status === 'complete' && 'after:border-solid after:border-primary',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'relative grid size-7 shrink-0 [counter-increment:step] before:content-[counter(step)] place-items-center rounded-full border-[1.5px] font-mono text-xs leading-none font-medium',
              item.status === 'pending' && 'border-input bg-card text-muted-foreground',
              item.status === 'active' && 'border-2 border-primary bg-primary-soft text-primary',
              item.status === 'complete' && 'border-primary bg-primary text-primary-foreground before:invisible',
              item.status === 'error' && 'border-2 border-danger bg-danger-soft text-danger before:content-["!"]',
            )}
          >
            {item.status === 'complete' && <CheckIcon className="absolute size-4" />}
            {item.status === 'active' && (
              <span className="absolute -inset-1 rounded-full border-2 border-primary/40 motion-safe:animate-pulse [animation-duration:1.6s]" />
            )}
          </span>
          <span className="flex flex-1 flex-wrap items-center justify-between gap-2 sm:flex-col sm:justify-start sm:gap-1">
            <span className={cn('text-sm font-semibold', item.status === 'error' && 'text-danger')}>{item.label}</span>
            <span className="sr-only">: </span>
            <Badge
              variant={item.status === 'error' ? 'destructive' : item.status === 'complete' ? 'default' : 'secondary'}
              className="font-mono"
            >
              {STATUS_TEXT[item.status]}
            </Badge>
          </span>
        </li>
      ))}
    </ol>
  );
}
