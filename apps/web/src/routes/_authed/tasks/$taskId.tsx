import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { RouteFocus } from '~/components/a11y/RouteFocus';
import { describeError } from '~/components/states/error-messages';
import { ErrorState } from '~/components/states/ErrorState';
import { LoadingState } from '~/components/states/LoadingState';
import { NotFoundPage } from '~/components/states/NotFoundPage';
import { TaskProgress } from '~/features/sources/TaskProgress';
import { useTaskStream } from '~/features/sources/use-task-stream';
import { taskOptions } from '~/lib/api/curator';
import { puzzlesListOptions } from '~/lib/api/gameplay';

// Tasks are own-only for every role: the API answers 404 to anyone else.
export const Route = createFileRoute('/_authed/tasks/$taskId')({
  // Warm the cache; a failure is shown by the page itself.
  loader: ({ context, params }) => context.queryClient.prefetchQuery(taskOptions(params.taskId)),
  component: TaskPage,
});

function TaskPage() {
  const { taskId } = Route.useParams();
  const { task, state, reset } = useTaskStream(taskId);
  const puzzles = useQuery(puzzlesListOptions());

  if (task.isError && describeError(task.error).kind === 'not-found') return <NotFoundPage />;

  const playable = new Set((puzzles.data ?? []).map((p) => p.id));
  return (
    <div className="flex flex-col gap-4">
      <RouteFocus title="Run" />
      <p className="text-sm">
        <Link
          to="/sources"
          className="font-medium text-primary underline underline-offset-4 hover:text-primary-hover"
        >
          Back to sources
        </Link>
      </p>
      <h1 className="text-2xl leading-[30px] font-bold tracking-tight sm:text-[30px] sm:leading-9">
        Run
      </h1>
      {task.isPending && <LoadingState label="Loading run" rows={3} />}
      {task.isError && <ErrorState error={task.error} onRetry={() => void task.refetch()} />}
      {task.data && (
        <TaskProgress
          task={task.data}
          state={state}
          playablePuzzleIds={playable}
          onRetried={reset}
        />
      )}
    </div>
  );
}
