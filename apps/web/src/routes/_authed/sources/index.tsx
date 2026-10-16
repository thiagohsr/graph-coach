import { createFileRoute } from '@tanstack/react-router';
import { RouteFocus } from '~/components/a11y/RouteFocus';
import { SourceList } from '~/features/sources/SourceList';

export const Route = createFileRoute('/_authed/sources/')({
  component: SourcesPage,
});

function SourcesPage() {
  return (
    <div className="flex flex-col gap-4">
      <RouteFocus title="Sources" />
      <h1 className="text-2xl font-semibold">Sources</h1>
      <SourceList />
    </div>
  );
}
