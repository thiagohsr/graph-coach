import { ShareDto, VisibilityResponse, type ShareRequest, type VisibilityRequest } from '@coach/types';
import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { keys } from '~/lib/query/keys';
import { apiFetch } from './client';

const id = encodeURIComponent;
const ShareList = z.array(ShareDto);

/** `GET /puzzles/:id/shares`: owner only. */
export function listShares(puzzleId: string, signal?: AbortSignal) {
  return apiFetch(`/puzzles/${id(puzzleId)}/shares`, { schema: ShareList, ...(signal ? { signal } : {}) });
}

/** `PUT /puzzles/:id/shares`: adds a share, or changes the source option of an existing one. */
export function putShare(puzzleId: string, request: Pick<ShareRequest, 'email' | 'withSource'>) {
  return apiFetch(`/puzzles/${id(puzzleId)}/shares`, {
    method: 'PUT',
    body: { email: request.email, withSource: request.withSource },
    schema: ShareDto,
  });
}

/** `DELETE /puzzles/:id/shares/:userId`: 204, no body. */
export function deleteShare(puzzleId: string, userId: string) {
  return apiFetch(`/puzzles/${id(puzzleId)}/shares/${id(userId)}`, { method: 'DELETE' });
}

/** `POST /puzzles/:id/visibility`: owner who is a reviewer or admin. */
export function setVisibility(puzzleId: string, visibility: VisibilityRequest['visibility']) {
  return apiFetch(`/puzzles/${id(puzzleId)}/visibility`, {
    method: 'POST',
    body: { visibility },
    schema: VisibilityResponse,
  });
}

/** Fetched when the dialog opens; always fresh (data-model §2). */
export const sharesOptions = (puzzleId: string) =>
  queryOptions({
    queryKey: keys.puzzles.shares(puzzleId),
    queryFn: ({ signal }) => listShares(puzzleId, signal),
    staleTime: 0,
  });
