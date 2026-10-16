import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { RouteFocus } from '~/components/a11y/RouteFocus';
import { ErrorState } from '~/components/states/ErrorState';
import { LoadingState } from '~/components/states/LoadingState';
import { MasteryList } from '~/features/play/MasteryList';
import { masteryOptions } from '~/lib/api/gameplay';

export const Route = createFileRoute('/_authed/mastery')({
  component: MasteryPage,
});

function MasteryPage() {
  const mastery = useQuery(masteryOptions());
  return (
    <div className="flex flex-col gap-4">
      <RouteFocus title="Mastery" />
      <h1 className="text-2xl leading-[30px] font-bold tracking-tight sm:text-[30px] sm:leading-9">Mastery</h1>
      {mastery.isPending && <LoadingState label="Loading mastery" />}
      {mastery.isError && <ErrorState error={mastery.error} onRetry={() => void mastery.refetch()} />}
      {mastery.isSuccess && <MasteryList items={mastery.data} />}
    </div>
  );
}
