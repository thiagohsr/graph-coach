import { DecisionDto, DecisionPathDto, RecommendationDto } from '@coach/types';
import { queryOptions } from '@tanstack/react-query';
import { keys } from '~/lib/query/keys';
import { apiFetch } from './client';

const id = encodeURIComponent;

/** `POST /coach/recommendations` with `{}` or `{ goal }` (201 fresh or reused). */
export function requestRecommendation(input: { goal?: string } = {}) {
  const goal = input.goal?.trim();
  return apiFetch('/coach/recommendations', {
    method: 'POST',
    body: goal ? { goal } : {},
    schema: RecommendationDto,
  });
}

export function getDecision(decisionId: string, signal?: AbortSignal) {
  return apiFetch(`/decisions/${id(decisionId)}`, { schema: DecisionDto, ...(signal ? { signal } : {}) });
}

export function getDecisionPath(decisionId: string, signal?: AbortSignal) {
  return apiFetch(`/decisions/${id(decisionId)}/path`, { schema: DecisionPathDto, ...(signal ? { signal } : {}) });
}

/** A stored decision never changes. */
export const decisionOptions = (decisionId: string) =>
  queryOptions({
    queryKey: keys.decisions.detail(decisionId),
    queryFn: ({ signal }) => getDecision(decisionId, signal),
    staleTime: Infinity,
  });

export const decisionPathOptions = (decisionId: string) =>
  queryOptions({
    queryKey: keys.decisions.path(decisionId),
    queryFn: ({ signal }) => getDecisionPath(decisionId, signal),
    staleTime: Infinity,
  });
