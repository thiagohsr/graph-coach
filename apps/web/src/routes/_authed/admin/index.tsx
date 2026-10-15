import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { RouteFocus } from '~/components/a11y/RouteFocus';
import { EmptyState } from '~/components/states/EmptyState';
import { ErrorState } from '~/components/states/ErrorState';
import { LoadingState } from '~/components/states/LoadingState';
import { modelsOptions } from '~/lib/api/admin';

export const Route = createFileRoute('/_authed/admin/')({
  component: AdminHome,
});

function AdminHome() {
  const models = useQuery(modelsOptions());
  const groups = new Map<string, { name: string; label: string }[]>();
  for (const m of models.data ?? []) {
    groups.set(m.group, [...(groups.get(m.group) ?? []), { name: m.name, label: m.label }]);
  }
  return (
    <div className="flex flex-col gap-6">
      <RouteFocus title="Admin" />
      <h1 className="text-2xl font-semibold">Admin</h1>
      {models.isPending && <LoadingState label="Loading models" />}
      {models.isError && <ErrorState error={models.error} onRetry={() => void models.refetch()} />}
      {models.isSuccess && models.data.length === 0 && <EmptyState title="No models are registered." />}
      {[...groups.entries()].map(([group, items]) => (
        <section key={group} aria-labelledby={`group-${group}`} className="flex flex-col gap-2">
          <h2 id={`group-${group}`} className="text-lg font-semibold">
            {group}
          </h2>
          <ul className="flex flex-col gap-1">
            {items.map((m) => (
              <li key={m.name}>
                <Link to="/admin/$model" params={{ model: m.name }} className="underline">
                  {m.label}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
