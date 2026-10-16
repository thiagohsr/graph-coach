import {
  SourceCreateResponse,
  SourceDetailDto,
  SourceSummaryDto,
  TaskDto,
  type SourceCreateRequest,
} from '@coach/types';
import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { keys } from '~/lib/query/keys';
import { apiFetch } from './client';

const id = encodeURIComponent;
const opts = (signal?: AbortSignal) => (signal ? { signal } : {});

const SourceList = z.array(SourceSummaryDto);
const RetryResponse = z.object({ taskId: z.string() });

export type SourceCreated = Extract<SourceCreateResponse, { sourceId: string }>;
export type SourceDuplicate = Extract<SourceCreateResponse, { duplicateOf: string }>;

/** `POST /sources`: 202 `{ taskId, sourceId }` for a new run, 200 `{ duplicateOf, taskId? }` for repeated material. */
export function createSource(request: SourceCreateRequest) {
  return apiFetch('/sources', { method: 'POST', body: request, schema: SourceCreateResponse });
}

/** The two success shapes of `POST /sources` are told apart by their keys. */
export function isDuplicate(response: SourceCreateResponse): response is SourceDuplicate {
  return 'duplicateOf' in response;
}

export function listSources(signal?: AbortSignal) {
  return apiFetch('/sources', { schema: SourceList, ...opts(signal) });
}

export function getSource(sourceId: string, signal?: AbortSignal) {
  return apiFetch(`/sources/${id(sourceId)}`, { schema: SourceDetailDto, ...opts(signal) });
}

export function getTask(taskId: string, signal?: AbortSignal) {
  return apiFetch(`/tasks/${id(taskId)}`, { schema: TaskDto, ...opts(signal) });
}

/** `POST /tasks/:id/retry`, no body; 202 `{ taskId }`. */
export function retryTask(taskId: string) {
  return apiFetch(`/tasks/${id(taskId)}/retry`, { method: 'POST', schema: RetryResponse });
}

/** The same-origin address of the task's event stream (the forwarding route relays it). */
export function taskEventsUrl(taskId: string): string {
  return `/api/tasks/${id(taskId)}/events`;
}

export const sourcesListOptions = () =>
  queryOptions({ queryKey: keys.sources.list, queryFn: ({ signal }) => listSources(signal) });

export const sourceOptions = (sourceId: string) =>
  queryOptions({
    queryKey: keys.sources.detail(sourceId),
    queryFn: ({ signal }) => getSource(sourceId, signal),
    retry: false,
  });

export const taskOptions = (taskId: string) =>
  queryOptions({
    queryKey: keys.tasks.detail(taskId),
    queryFn: ({ signal }) => getTask(taskId, signal),
  });
