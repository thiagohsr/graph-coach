import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { RouteFocus } from '~/components/a11y/RouteFocus';
import { describeError } from '~/components/states/error-messages';
import { ErrorState } from '~/components/states/ErrorState';
import { ForbiddenPage } from '~/components/states/ForbiddenPage';
import { LoadingState } from '~/components/states/LoadingState';
import { NotFoundPage } from '~/components/states/NotFoundPage';
import { AdminForm } from '~/features/admin/AdminForm';
import { modelsOptions, recordOptions, updateRecord } from '~/lib/api/admin';
import { keys } from '~/lib/query/keys';

export const Route = createFileRoute('/_authed/admin/$model/$id')({
  component: AdminRecordPage,
});

function AdminRecordPage() {
  const { model: modelName, id } = Route.useParams();
  const queryClient = useQueryClient();
  const models = useQuery(modelsOptions());
  const model = models.data?.find((m) => m.name === modelName);
  const record = useQuery({ ...recordOptions(modelName, id), enabled: model !== undefined });

  const save = useMutation({
    mutationFn: (values: Record<string, unknown>) => updateRecord(modelName, id, values),
    onSuccess: (response) => {
      queryClient.setQueryData(keys.admin.record(modelName, id), (old: typeof record.data) =>
        old ? { ...old, record: response.record } : old,
      );
      // Quick actions and links can change with the record, so it is read again.
      void queryClient.invalidateQueries({ queryKey: keys.admin.record(modelName, id) });
      void queryClient.invalidateQueries({ queryKey: keys.admin.lists(modelName) });
    },
  });

  const failed = models.error ?? record.error;
  if (failed && describeError(failed).kind === 'forbidden') return <ForbiddenPage />;
  if (models.isSuccess && !model) return <NotFoundPage />;
  if (record.isError && describeError(record.error).kind === 'not-found') return <NotFoundPage />;

  const title = record.data?.record.title ?? 'Record';
  return (
    <div className="flex flex-col gap-4">
      <RouteFocus title={title} />
      <p className="text-sm">
        <Link to="/admin/$model" params={{ model: modelName }} className="font-medium text-primary underline underline-offset-4 hover:text-primary-hover">
          {model?.label ?? 'Back to the list'}
        </Link>
      </p>
      <h1 className="text-2xl leading-[30px] font-bold tracking-tight sm:text-[30px] sm:leading-9">{title}</h1>
      {(models.isPending || (model && record.isPending)) && <LoadingState label="Loading record" />}
      {models.isError && <ErrorState error={models.error} onRetry={() => void models.refetch()} />}
      {record.isError && <ErrorState error={record.error} onRetry={() => void record.refetch()} />}
      {model && record.data && (
        <AdminForm model={model} detail={record.data} onSave={(values) => save.mutateAsync(values)} />
      )}
    </div>
  );
}
