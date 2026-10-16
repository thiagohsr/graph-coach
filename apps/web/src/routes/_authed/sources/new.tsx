import { createFileRoute } from '@tanstack/react-router';
import { CreatePage } from '~/features/create/CreatePage';

// `kind` lets a link open one of the two choices.
export const Route = createFileRoute('/_authed/sources/new')({
  validateSearch: (search: Record<string, unknown>): { kind?: 'prompt' | 'upload' } =>
    search.kind === 'prompt' || search.kind === 'upload' ? { kind: search.kind } : {},
  component: NewSourcePage,
});

function NewSourcePage() {
  const { kind } = Route.useSearch();
  return <CreatePage initialChoice={kind ?? null} />;
}
