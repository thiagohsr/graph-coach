import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useRef, useState, type Dispatch } from 'react';
import { ApiClientError, isCode, isStatus } from '~/lib/api/errors';
import { createSession, submitSession } from '~/lib/api/gameplay';
import type { SubmitResult } from '~/lib/api/gameplay-schemas';
import { keys } from '~/lib/query/keys';
import { toSubmitRequest, type Action, type BoardState } from './board-state';

/** Thrown out of the mutation so the caller knows which session the failed attempt belonged to. */
class SubmitFlowError extends Error {
  constructor(
    readonly original: unknown,
    readonly sessionId: string | null,
  ) {
    super('submit failed');
  }
}

/**
 * The submit flow of data-model.md §1.5: create the session once (and reuse it on retry), submit the
 * placements, seed the result cache, and leave the page. The client never grades anything. It runs as a
 * mutation so that a 401 or a blocked account reaches the global handlers of the query client.
 */
export function useSubmitSession(state: BoardState, dispatch: Dispatch<Action>) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [notFound, setNotFound] = useState(false);
  // Always the latest state, so a retry sees the session id created by the earlier attempt.
  const latest = useRef(state);
  latest.current = state;
  const inFlight = useRef(false);

  const goToResult = useCallback(
    (sessionId: string) => navigate({ to: '/sessions/$sessionId/result', params: { sessionId }, replace: true }),
    [navigate],
  );

  const mutation = useMutation({
    mutationFn: async (current: BoardState): Promise<{ sessionId: string; result: SubmitResult }> => {
      let sessionId = current.sessionId;
      try {
        if (!sessionId) {
          sessionId = (await createSession(current.puzzleId)).sessionId;
          dispatch({ type: 'SESSION_CREATED', sessionId });
        }
        return { sessionId, result: await submitSession(sessionId, toSubmitRequest(current)) };
      } catch (error) {
        throw new SubmitFlowError(error, sessionId);
      }
    },
  });

  const submit = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    dispatch({ type: 'SUBMIT_START' });
    try {
      const { sessionId, result } = await mutation.mutateAsync(latest.current);
      queryClient.setQueryData(keys.sessions.result(sessionId), result);
      void queryClient.invalidateQueries({ queryKey: keys.mastery });
      queryClient.removeQueries({ queryKey: keys.coach.latest });
      await goToResult(sessionId);
    } catch (thrown) {
      const error = thrown instanceof SubmitFlowError ? thrown.original : thrown;
      const sessionId = thrown instanceof SubmitFlowError ? thrown.sessionId : null;
      if (sessionId && isCode(error, 'SESSION_ALREADY_SUBMITTED')) {
        // The earlier attempt was recorded: its result is the answer.
        await goToResult(sessionId);
      } else if (isStatus(error, 404)) {
        setNotFound(true);
      } else if (isStatus(error, 401) || isCode(error, 'ACCOUNT_BLOCKED')) {
        // The global handler is already navigating away; keep the placements in case sign-in returns here.
        dispatch({ type: 'SUBMIT_FAIL', error: error as ApiClientError });
      } else {
        dispatch({
          type: 'SUBMIT_FAIL',
          error: error instanceof ApiClientError ? error : new ApiClientError({ status: 0, code: 'UNKNOWN', message: 'Service unavailable.' }),
        });
      }
    } finally {
      inFlight.current = false;
    }
  }, [dispatch, goToResult, mutation, queryClient]);

  return { submit, notFound };
}
