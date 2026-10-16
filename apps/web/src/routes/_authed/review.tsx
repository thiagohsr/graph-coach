import { createFileRoute } from '@tanstack/react-router';
import { RouteFocus } from '~/components/a11y/RouteFocus';
import { ReviewScreen } from '~/features/review/ReviewScreen';

interface ReviewSearch {
  taskId?: string;
}

// Drafts are the caller's own for every role: the API answers with an empty list or 404 for anything else.
export const Route = createFileRoute('/_authed/review')({
  validateSearch: (raw: Record<string, unknown>): ReviewSearch => {
    const taskId = typeof raw.taskId === 'string' ? raw.taskId.trim() : '';
    return taskId !== '' && taskId.length <= 100 ? { taskId } : {};
  },
  component: ReviewPage,
});

function ReviewPage() {
  const { taskId } = Route.useSearch();
  return (
    <div className="flex flex-col gap-4">
      <RouteFocus title="Review" />
      <h1 className="text-2xl font-semibold">Review drafts</h1>
      <ReviewScreen taskId={taskId} />
    </div>
  );
}
