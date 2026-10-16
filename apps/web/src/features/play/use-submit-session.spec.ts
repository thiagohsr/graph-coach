import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, useReducer, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '~/lib/api/errors';
import { keys } from '~/lib/query/keys';
import { navigateMock } from '~/test/router-mock';
import { createTestQueryClient } from '~/test/render';

vi.mock('@tanstack/react-router', async (orig) =>
  (await import('~/test/router-mock')).routerMock(await orig()),
);

const createSession = vi.fn();
const submitSession = vi.fn();
vi.mock('~/lib/api/gameplay', () => ({
  createSession: (...a: unknown[]) => createSession(...a),
  submitSession: (...a: unknown[]) => submitSession(...a),
}));

import { boardReducer, createInitialState, slotWord } from './board-state';
import { playPuzzle, submitResult } from './fixtures';
import { useSubmitSession } from './use-submit-session';

function setup() {
  const queryClient = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  const hook = renderHook(
    () => {
      const [state, dispatch] = useReducer(boardReducer, playPuzzle, createInitialState);
      return { state, dispatch, ...useSubmitSession(state, dispatch) };
    },
    { wrapper },
  );
  act(() =>
    hook.result.current.dispatch({ type: 'PLACE', wordId: 'w2', slotId: 'q-1:0', via: 'pointer' }),
  );
  return { ...hook, queryClient };
}

const network = () =>
  new ApiClientError({ status: 0, code: 'NETWORK', message: 'Service unavailable.' });

beforeEach(() => {
  createSession.mockReset().mockResolvedValue({ sessionId: 's-1' });
  submitSession.mockReset().mockResolvedValue(submitResult);
  navigateMock.mockReset();
});

describe('useSubmitSession', () => {
  it('creates the session, submits the placements as slot entries, and navigates to the result with replace', async () => {
    const { result } = setup();
    await act(() => result.current.submit());
    expect(createSession).toHaveBeenCalledWith('pz-db-101');
    expect(submitSession).toHaveBeenCalledWith('s-1', {
      answers: [
        { questionId: 'q-1', blank: 0, word: 'index' },
        { questionId: 'q-1', blank: 1, word: null },
        { questionId: 'q-2', blank: 0, word: null },
      ],
    });
    expect(navigateMock).toHaveBeenCalledWith({
      to: '/sessions/$sessionId/result',
      params: { sessionId: 's-1' },
      replace: true,
    });
  });

  it('seeds sessions.result, invalidates mastery, and removes coach.latest', async () => {
    const { result, queryClient } = setup();
    queryClient.setQueryData(keys.coach.latest, { old: true });
    queryClient.setQueryData(keys.mastery, []);
    await act(() => result.current.submit());
    expect(queryClient.getQueryData(keys.sessions.result('s-1'))).toEqual(submitResult);
    expect(queryClient.getQueryData(keys.coach.latest)).toBeUndefined();
    expect(queryClient.getQueryState(keys.mastery)?.isInvalidated).toBe(true);
  });

  it('leaves the board in submit_failed with placements intact on a network failure, and reuses the session on retry', async () => {
    submitSession.mockRejectedValueOnce(network());
    const { result } = setup();
    await act(() => result.current.submit());
    await waitFor(() => expect(result.current.state.status).toBe('submit_failed'));
    expect(slotWord(result.current.state, 'q-1:0')?.text).toBe('index');
    expect(result.current.state.sessionId).toBe('s-1');
    expect(navigateMock).not.toHaveBeenCalled();

    await act(() => result.current.submit());
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(submitSession).toHaveBeenCalledTimes(2);
    expect(navigateMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the board editable when the session cannot be created', async () => {
    createSession.mockRejectedValueOnce(network());
    const { result } = setup();
    await act(() => result.current.submit());
    expect(result.current.state.status).toBe('submit_failed');
    expect(result.current.state.sessionId).toBeNull();
    expect(submitSession).not.toHaveBeenCalled();
  });

  it('goes to the result on a 409 SESSION_ALREADY_SUBMITTED', async () => {
    submitSession.mockRejectedValueOnce(
      new ApiClientError({ status: 409, code: 'SESSION_ALREADY_SUBMITTED', message: 'done' }),
    );
    const { result } = setup();
    await act(() => result.current.submit());
    expect(navigateMock).toHaveBeenCalledWith({
      to: '/sessions/$sessionId/result',
      params: { sessionId: 's-1' },
      replace: true,
    });
    expect(result.current.state.status).not.toBe('submit_failed');
  });

  it('reports not found on a 404', async () => {
    submitSession.mockRejectedValueOnce(
      new ApiClientError({ status: 404, code: 'NOT_FOUND', message: 'gone' }),
    );
    const { result } = setup();
    await act(() => result.current.submit());
    expect(result.current.notFound).toBe(true);
  });

  it('shows a 422 as a failure and keeps the placements', async () => {
    submitSession.mockRejectedValueOnce(
      new ApiClientError({
        status: 422,
        code: 'VALIDATION_FAILED',
        message: 'Answers do not match the puzzle',
      }),
    );
    const { result } = setup();
    await act(() => result.current.submit());
    expect(result.current.state.status).toBe('submit_failed');
    expect(result.current.state.error?.message).toBe('Answers do not match the puzzle');
    expect(slotWord(result.current.state, 'q-1:0')?.text).toBe('index');
  });
});
