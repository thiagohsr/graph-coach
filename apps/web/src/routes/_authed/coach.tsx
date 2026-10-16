import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { LiveRegion } from '~/components/a11y/LiveRegion';
import { RouteFocus } from '~/components/a11y/RouteFocus';
import { LoadingState } from '~/components/states/LoadingState';
import { Button } from '~/components/ui/button';
import { GoalInput, goalProblem } from '~/features/coach/GoalInput';
import { CoachError, RecommendationCard } from '~/features/coach/RecommendationCard';
import { requestRecommendation } from '~/lib/api/coach';
import { keys } from '~/lib/query/keys';
import type { RecommendationDto } from '@coach/types';

export const Route = createFileRoute('/_authed/coach')({
  component: CoachPage,
});

function CoachPage() {
  const queryClient = useQueryClient();
  const [announcement, setAnnouncement] = useState({ message: '', seq: 0 });
  const [goal, setGoal] = useState('');

  // `coach.latest` is client-only: the last recommendation of this browser session (data-model §2).
  const latest = useQuery({
    queryKey: keys.coach.latest,
    queryFn: () => Promise.resolve<RecommendationDto | null>(null),
    enabled: false,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const ask = useMutation({
    mutationFn: () => requestRecommendation(goal.trim() ? { goal: goal.trim() } : {}),
    onSuccess: (recommendation) => {
      queryClient.setQueryData(keys.coach.latest, recommendation);
      setAnnouncement((a) => ({
        message: `Recommendation ready: ${recommendation.target?.name ?? 'no specific concept'}`,
        seq: a.seq + 1,
      }));
    },
  });

  const recommendation = ask.isError ? undefined : (ask.data ?? latest.data ?? undefined);

  return (
    <div className="flex flex-col gap-4">
      <RouteFocus title="What next?" />
      <h1 className="text-2xl leading-[30px] font-bold tracking-tight sm:text-[30px] sm:leading-9">What next?</h1>
      <LiveRegion message={announcement.message} seq={announcement.seq} />

      {!recommendation && !ask.isPending && !ask.isError && (
        <p>
          The Coach looks at what you have practised, finds the concept that needs work most, and recommends a puzzle
          for it. It also shows the evidence behind its choice.
        </p>
      )}

      <GoalInput value={goal} onChange={setGoal} />

      <div>
        <Button type="button" onClick={() => ask.mutate()} disabled={ask.isPending || goalProblem(goal) !== null}>
          {ask.isPending ? 'Thinking…' : 'What next?'}
        </Button>
      </div>

      {ask.isPending && <LoadingState label="Asking the Coach" rows={2} />}
      {ask.isError && <CoachError error={ask.error} onRetry={() => ask.mutate()} />}
      {recommendation && !ask.isPending && <RecommendationCard recommendation={recommendation} />}
    </div>
  );
}
