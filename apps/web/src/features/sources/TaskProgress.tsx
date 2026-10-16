import { PROMPT_ORIGIN_NOTICE, type TaskDto, type TaskStatus } from '@coach/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { LiveRegion } from '~/components/a11y/LiveRegion';
import { describeError } from '~/components/states/error-messages';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Badge } from '~/components/ui/badge';
import { Button, buttonVariants } from '~/components/ui/button';
import { retryTask } from '~/lib/api/curator';
import { isCode } from '~/lib/api/errors';
import { keys } from '~/lib/query/keys';
import { cn } from '~/lib/utils';
import { PipelineDiagram } from './PipelineDiagram';
import { StepLog } from './StepLog';
import type { PipelineState } from './pipeline-state';

const STATUS_LABEL: Record<TaskStatus, string> = {
  queued: 'Queued',
  in_progress: 'Running',
  awaiting_review: 'Awaiting review',
  done: 'Done',
  failed: 'Failed',
};

export interface TaskProgressProps {
  task: TaskDto;
  state: PipelineState;
  /** Puzzle ids that appear in the playable list; the "Play" link needs one. */
  playablePuzzleIds?: ReadonlySet<string>;
  /** Called after a retry was accepted, to forget the old run's view state. */
  onRetried?: () => void;
}

function TransportLine({ transport }: { transport: PipelineState['transport'] }) {
  if (transport === 'live') return <p className="text-sm text-muted-foreground">Live</p>;
  if (transport === 'reconnecting') return <p className="text-sm text-muted-foreground">Reconnecting…</p>;
  if (transport === 'polling') {
    return <p className="text-sm text-muted-foreground">Live updates unavailable. Refreshing every 3 seconds.</p>;
  }
  return null;
}

export function TaskProgress({ task, state, playablePuzzleIds, onRetried }: TaskProgressProps) {
  const queryClient = useQueryClient();
  const retry = useMutation({
    mutationFn: () => retryTask(task.id),
    onSuccess: () => {
      onRetried?.();
      void queryClient.invalidateQueries({ queryKey: keys.tasks.detail(task.id) });
    },
    onError: (error) => {
      if (isCode(error, 'TASK_NOT_FAILED')) void queryClient.invalidateQueries({ queryKey: keys.tasks.detail(task.id) });
    },
  });

  const statusLabel = STATUS_LABEL[task.status];
  const noSteps = task.steps.length === 0 && Object.keys(state.steps).length === 0;
  const puzzleId = task.produced.puzzleId;

  return (
    <section aria-label="Run progress" className="flex flex-col gap-4">
      <LiveRegion message={`Run status: ${statusLabel}`} />
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={task.status === 'failed' ? 'destructive' : 'secondary'}>{statusLabel}</Badge>
        <p className="text-sm text-muted-foreground">
          {task.produced.concepts} concepts · {task.produced.questions} questions
        </p>
      </div>

      {task.kind !== 'ingest' && <p className="text-sm text-muted-foreground">{PROMPT_ORIGIN_NOTICE}</p>}

      <TransportLine transport={state.transport} />

      {task.status === 'queued' && noSteps && <p>Waiting to start</p>}
      <PipelineDiagram kind={task.kind} state={state} />
      <StepLog kind={task.kind} state={state} />

      {task.status === 'awaiting_review' && (
        <Alert role="status">
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>Drafts are ready</span>
            <Link
              to="/review"
              search={{ taskId: task.id }}
              className={cn(buttonVariants({ size: 'sm' }))}
            >
              Review drafts
            </Link>
          </AlertDescription>
        </Alert>
      )}

      {task.status === 'failed' && (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-col gap-3">
            <p>{task.error ?? 'The run failed.'}</p>
            {retry.isError && !isCode(retry.error, 'TASK_NOT_FAILED') && <p>{describeError(retry.error).message}</p>}
            <div>
              <Button type="button" variant="outline" size="sm" disabled={retry.isPending} onClick={() => retry.mutate()}>
                Retry
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {task.status === 'done' && (
        <div className="flex flex-col gap-2" role="status">
          {task.result === 'nothing_usable' && <p>Nothing usable was found in this source.</p>}
          {task.result === 'below_minimum' && (
            <p>Review finished with too few approved questions, so no puzzle was published.</p>
          )}
          {task.result === 'ok' && (
            <p>
              The run is finished.{' '}
              {puzzleId && playablePuzzleIds?.has(puzzleId) && (
                <Link to="/puzzles/$puzzleId/play" params={{ puzzleId }} className="underline">
                  Play
                </Link>
              )}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
