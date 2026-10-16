import { DraftQuestionDto, ReviewOutcome, type DraftUpdateRequest } from '@coach/types';
import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { keys } from '~/lib/query/keys';
import { apiFetch } from './client';

const id = encodeURIComponent;
const DraftList = z.array(DraftQuestionDto);

/** `GET /review/questions?status=draft[&taskId=]`: the caller's own drafts only. */
export function listDrafts(params: { taskId?: string | undefined } = {}, signal?: AbortSignal) {
  const query = new URLSearchParams({ status: 'draft' });
  if (params.taskId) query.set('taskId', params.taskId);
  return apiFetch(`/review/questions?${query.toString()}`, {
    schema: DraftList,
    ...(signal ? { signal } : {}),
  });
}

/** `PATCH /review/questions/:id` with only the changed fields among the three editable ones; returns the draft. */
export function updateDraft(draftId: string, changes: DraftUpdateRequest) {
  const body: DraftUpdateRequest = {};
  if (changes.sentence !== undefined) body.sentence = changes.sentence;
  if (changes.answers !== undefined) body.answers = changes.answers;
  if (changes.distractors !== undefined) body.distractors = changes.distractors;
  return apiFetch(`/review/questions/${id(draftId)}`, {
    method: 'PATCH',
    body,
    schema: DraftQuestionDto,
  });
}

export function approveDraft(draftId: string) {
  return apiFetch(`/review/questions/${id(draftId)}/approve`, {
    method: 'POST',
    schema: ReviewOutcome,
  });
}

export function rejectDraft(draftId: string, reason?: string) {
  const trimmed = reason?.trim();
  return apiFetch(`/review/questions/${id(draftId)}/reject`, {
    method: 'POST',
    body: trimmed ? { reason: trimmed } : {},
    schema: ReviewOutcome,
  });
}

export const draftsOptions = (params: { taskId?: string | undefined } = {}) =>
  queryOptions({
    queryKey: keys.review.drafts(params),
    queryFn: ({ signal }) => listDrafts(params, signal),
  });
