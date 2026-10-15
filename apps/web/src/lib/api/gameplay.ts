import { queryOptions } from '@tanstack/react-query';
import { keys } from '~/lib/query/keys';
import { apiFetch } from './client';
import {
  MasteryList,
  PlayPuzzle,
  PuzzleSummaryList,
  SessionCreated,
  SubmitResult,
  type SubmitRequest,
} from './gameplay-schemas';

const id = encodeURIComponent;
const opts = (signal?: AbortSignal) => (signal ? { signal } : {});

export function listPuzzles(signal?: AbortSignal) {
  return apiFetch('/puzzles', { schema: PuzzleSummaryList, ...opts(signal) });
}

export function getPlay(puzzleId: string, signal?: AbortSignal) {
  return apiFetch(`/puzzles/${id(puzzleId)}/play`, { schema: PlayPuzzle, ...opts(signal) });
}

/** `POST /puzzles/:id/sessions` (201 `{ sessionId }`). Every call starts a new attempt. */
export function createSession(puzzleId: string) {
  return apiFetch(`/puzzles/${id(puzzleId)}/sessions`, { method: 'POST', schema: SessionCreated });
}

export function submitSession(sessionId: string, request: SubmitRequest) {
  return apiFetch(`/sessions/${id(sessionId)}/submit`, { method: 'POST', body: request, schema: SubmitResult });
}

export function getSessionResult(sessionId: string, signal?: AbortSignal) {
  return apiFetch(`/sessions/${id(sessionId)}`, { schema: SubmitResult, ...opts(signal) });
}

export function getMastery(signal?: AbortSignal) {
  return apiFetch('/me/mastery', { schema: MasteryList, ...opts(signal) });
}

export const puzzlesListOptions = () =>
  queryOptions({ queryKey: keys.puzzles.list, queryFn: ({ signal }) => listPuzzles(signal) });

/** The bank is reshuffled per request, so the payload is fetched once and never refetched (data-model §2). */
export const playOptions = (puzzleId: string) =>
  queryOptions({
    queryKey: keys.puzzles.play(puzzleId),
    queryFn: ({ signal }) => getPlay(puzzleId, signal),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

/** A submitted session is immutable. */
export const sessionResultOptions = (sessionId: string) =>
  queryOptions({
    queryKey: keys.sessions.result(sessionId),
    queryFn: ({ signal }) => getSessionResult(sessionId, signal),
    staleTime: Infinity,
  });

export const masteryOptions = () =>
  queryOptions({ queryKey: keys.mastery, queryFn: ({ signal }) => getMastery(signal) });
