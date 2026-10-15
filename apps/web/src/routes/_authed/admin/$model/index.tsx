import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { RouteFocus } from '~/components/a11y/RouteFocus';
import { describeError } from '~/components/states/error-messages';
import { ErrorState } from '~/components/states/ErrorState';
import { LoadingState } from '~/components/states/LoadingState';
import { NotFoundPage } from '~/components/states/NotFoundPage';
import { AdminTable } from '~/features/admin/AdminTable';
import { modelsOptions, recordsOptions } from '~/lib/api/admin';

interface AdminListSearch {
  search?: string;
  page?: number;
  pageSize?: number;
}

function positiveInt(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 ? n : undefined;
}

export const Route = createFileRoute('/_authed/admin/$model/')({
  validateSearch: (raw: Record<string, unknown>): AdminListSearch => {
    const out: AdminListSearch = {};
    if (typeof raw.search === 'string' && raw.search.trim() !== '') out.search = raw.search.trim();
    const page = positiveInt(raw.page);
    if (page !== undefined) out.page = page;
    const pageSize = positiveInt(raw.pageSize);
    if (pageSize !== undefined) out.pageSize = pageSize;
    return out;
  },
  component: AdminListPage,
});

function AdminListPage() {
  const { model: modelName } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const models = useQuery(modelsOptions());
  const model = models.data?.find((m) => m.name === modelName);

  const params = { search: search.search ?? '', page: search.page ?? 1, pageSize: search.pageSize ?? model?.pageSize ?? 25 };
  const records = useQuery({ ...recordsOptions(modelName, params), enabled: model !== undefined });

  if (models.isSuccess && !model) return <NotFoundPage />;
  if (records.isError && describeError(records.error).kind === 'not-found') return <NotFoundPage />;

  return (
    <div className="flex flex-col gap-4">
      <RouteFocus title={model?.label ?? 'Admin'} />
      <p className="text-sm">
        <Link to="/admin" className="underline">
          Admin
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">{model?.label ?? 'Records'}</h1>
      {(models.isPending || (model && records.isPending)) && <LoadingState label="Loading records" />}
      {models.isError && <ErrorState error={models.error} onRetry={() => void models.refetch()} />}
      {records.isError && <ErrorState error={records.error} onRetry={() => void records.refetch()} />}
      {model && records.data && (
        <AdminTable
          model={model}
          items={records.data.items}
          total={records.data.total}
          page={records.data.page}
          pageSize={records.data.pageSize}
          search={params.search}
          onSearch={(term) => void navigate({ search: (prev) => ({ ...prev, search: term === '' ? undefined : term, page: undefined }) })}
          onPage={(page) => void navigate({ search: (prev) => ({ ...prev, page }) })}
        />
      )}
    </div>
  );
}
