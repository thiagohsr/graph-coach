import {
  AdminDetailResponse,
  AdminListResponse,
  AdminModelMeta,
  AdminUpdateResponse,
} from '@coach/types';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { keys, type AdminListParams } from '~/lib/query/keys';
import { apiFetch } from './client';

const id = encodeURIComponent;
const ModelList = z.array(AdminModelMeta);

export interface ListRecordsParams {
  search?: string;
  page?: number;
  pageSize?: number;
}

export function listModels(signal?: AbortSignal) {
  return apiFetch('/admin/models', { schema: ModelList, ...(signal ? { signal } : {}) });
}

export function listRecords(model: string, params: ListRecordsParams = {}, signal?: AbortSignal) {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.page !== undefined) query.set('page', String(params.page));
  if (params.pageSize !== undefined) query.set('pageSize', String(params.pageSize));
  const qs = query.toString();
  return apiFetch(`/admin/${id(model)}${qs ? `?${qs}` : ''}`, {
    schema: AdminListResponse,
    ...(signal ? { signal } : {}),
  });
}

export function getRecord(model: string, recordId: string, signal?: AbortSignal) {
  return apiFetch(`/admin/${id(model)}/${id(recordId)}`, {
    schema: AdminDetailResponse,
    ...(signal ? { signal } : {}),
  });
}

/** `PATCH` with `{ values }`: only the changed editable fields. */
export function updateRecord(model: string, recordId: string, values: Record<string, unknown>) {
  return apiFetch(`/admin/${id(model)}/${id(recordId)}`, {
    method: 'PATCH',
    body: { values },
    schema: AdminUpdateResponse,
  });
}

export const modelsOptions = () =>
  queryOptions({
    queryKey: keys.admin.models,
    queryFn: ({ signal }) => listModels(signal),
    staleTime: 5 * 60_000,
  });

export const recordsOptions = (model: string, params: AdminListParams) =>
  queryOptions({
    queryKey: keys.admin.list(model, params),
    queryFn: ({ signal }) =>
      listRecords(
        model,
        { search: params.search, page: params.page, pageSize: params.pageSize },
        signal,
      ),
    placeholderData: keepPreviousData,
  });

export const recordOptions = (model: string, recordId: string) =>
  queryOptions({
    queryKey: keys.admin.record(model, recordId),
    queryFn: ({ signal }) => getRecord(model, recordId, signal),
  });
