import { createFileRoute } from '@tanstack/react-router';
import { SourceView } from '~/features/sources/SourceView';

// Access is decided by the API: the owner, or a user the puzzle was shared with including the source; else 404.
export const Route = createFileRoute('/_authed/sources/$sourceId')({
  component: SourcePage,
});

function SourcePage() {
  const { sourceId } = Route.useParams();
  return <SourceView sourceId={sourceId} />;
}
