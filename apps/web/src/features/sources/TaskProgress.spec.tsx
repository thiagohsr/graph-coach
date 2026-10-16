import { PROMPT_ORIGIN_NOTICE } from '@coach/types';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithQuery } from '~/test/render';

vi.mock('@tanstack/react-router', async (orig) => (await import('~/test/router-mock')).routerMock(await orig()));

import { taskDto } from './fixtures';
import { initialPipelineState, pipelineReducer, type PipelineState } from './pipeline-state';
import { TaskProgress } from './TaskProgress';

const fetchMock = vi.fn();

const T0 = '2026-10-15T10:00:00.000Z';
function stateWith(...events: { node: string; stepId: string; order: number; status: 'active' | 'complete' | 'error'; log?: string }[]): PipelineState {
  return events.reduce(
    (state, e) =>
      pipelineReducer(state, {
        type: 'STEP_EVENT',
        event: {
          node: e.node,
          status: e.status,
          ...(e.log ? { log: e.log } : {}),
          payload: { stepId: e.stepId, order: e.order, attempt: 1, startedAt: T0 },
        },
      }),
    initialPipelineState,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('TaskProgress', () => {
  it('renders the seven steps in order as a list with the status in each item, aria-current on the active one', () => {
    const state = stateWith(
      { node: 'chunk', stepId: 's1', order: 1, status: 'complete' },
      { node: 'embed', stepId: 's2', order: 2, status: 'active' },
    );
    renderWithQuery(<TaskProgress task={taskDto()} state={state} />);
    const items = within(screen.getByRole('list', { name: 'Pipeline steps' })).getAllByRole('listitem');
    expect(items.map((li) => li.textContent?.replace(/\s+/g, ' '))).toEqual([
      'Chunk: complete',
      'Embed: active',
      'Extract concepts: pending',
      'Link prerequisites: pending',
      'Draft questions: pending',
      'Validate: pending',
      'Publish: pending',
    ]);
    expect(items.filter((li) => li.getAttribute('aria-current') === 'step')).toEqual([items[1]]);
  });

  it('shows the six generate steps with their labels and the prompt notice', () => {
    renderWithQuery(<TaskProgress task={taskDto({ kind: 'generate' })} state={initialPipelineState} />);
    const items = within(screen.getByRole('list', { name: 'Pipeline steps' })).getAllByRole('listitem');
    expect(items).toHaveLength(6);
    expect(items[0]).toHaveTextContent('Plan');
    expect(items[3]).toHaveTextContent('Rewrite');
    expect(screen.getByText(PROMPT_ORIGIN_NOTICE)).toBeInTheDocument();
  });

  it('has a log region with the lines prefixed by the step label', () => {
    const state = stateWith({ node: 'chunk', stepId: 's1', order: 1, status: 'active', log: 'splitting text' });
    renderWithQuery(<TaskProgress task={taskDto()} state={state} />);
    expect(within(screen.getByRole('log')).getByText('Chunk: splitting text')).toBeInTheDocument();
  });

  it('says "Waiting to start" for a queued task with no steps', () => {
    renderWithQuery(<TaskProgress task={taskDto({ status: 'queued' })} state={initialPipelineState} />);
    expect(screen.getByText('Waiting to start')).toBeInTheDocument();
  });

  it('links to the review of this task when drafts are ready', () => {
    renderWithQuery(<TaskProgress task={taskDto({ id: 't-7', status: 'awaiting_review' })} state={initialPipelineState} />);
    expect(screen.getByText('Drafts are ready')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review drafts' })).toHaveAttribute('href', '/review?taskId=t-7');
  });

  it('shows the error and Retry for a failed task; retry sends no body and resets the view', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ taskId: 't-1' }), { status: 202 }));
    const onRetried = vi.fn();
    const { queryClient } = renderWithQuery(
      <TaskProgress task={taskDto({ status: 'failed', error: 'The model timed out' })} state={initialPipelineState} onRetried={onRetried} />,
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    expect(screen.getByText('The model timed out')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(onRetried).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/tasks/t-1/retry');
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tasks', 't-1'] });
  });

  it('refreshes the task when the retry answers 409 TASK_NOT_FAILED', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'TASK_NOT_FAILED', message: 'not failed' } }), { status: 409 }),
    );
    const onRetried = vi.fn();
    const { queryClient } = renderWithQuery(
      <TaskProgress task={taskDto({ status: 'failed', error: 'x' })} state={initialPipelineState} onRetried={onRetried} />,
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tasks', 't-1'] }));
    expect(onRetried).not.toHaveBeenCalled();
  });

  it.each([
    ['nothing_usable', 'Nothing usable was found in this source.'],
    ['below_minimum', 'Review finished with too few approved questions, so no puzzle was published.'],
  ] as const)('done with result %s shows its message', (result, text) => {
    renderWithQuery(<TaskProgress task={taskDto({ status: 'done', result })} state={initialPipelineState} />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('done with result ok links to the puzzle only when it is playable', () => {
    const task = taskDto({ status: 'done', result: 'ok', produced: { concepts: 3, questions: 5, puzzleId: 'pz-1' } });
    const { unmount } = renderWithQuery(
      <TaskProgress task={task} state={initialPipelineState} playablePuzzleIds={new Set(['pz-1'])} />,
    );
    expect(screen.getByRole('link', { name: 'Play' })).toHaveAttribute('href', '/puzzles/pz-1/play');
    unmount();
    renderWithQuery(<TaskProgress task={task} state={initialPipelineState} playablePuzzleIds={new Set()} />);
    expect(screen.queryByRole('link', { name: 'Play' })).not.toBeInTheDocument();
  });

  it('shows the polling notice in fallback mode and a reconnecting line while reconnecting', () => {
    const { unmount } = renderWithQuery(
      <TaskProgress task={taskDto()} state={{ ...initialPipelineState, transport: 'polling', failures: 3 }} />,
    );
    expect(screen.getByText('Live updates unavailable. Refreshing every 3 seconds.')).toBeInTheDocument();
    unmount();
    renderWithQuery(<TaskProgress task={taskDto()} state={{ ...initialPipelineState, transport: 'reconnecting' }} />);
    expect(screen.getByText('Reconnecting…')).toBeInTheDocument();
  });
});
