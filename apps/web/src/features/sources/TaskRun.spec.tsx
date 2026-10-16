import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeEventSource } from '~/test/setup';
import { createTestQueryClient } from '~/test/render';

vi.mock('@tanstack/react-router', async (orig) =>
  (await import('~/test/router-mock')).routerMock(await orig()),
);

import { taskDto } from './fixtures';
import { TaskProgress } from './TaskProgress';
import { HEARTBEAT_MS, useTaskStream } from './use-task-stream';

// The run page's wiring (routes/_authed/tasks/$taskId.tsx) without the router.
function RunPage() {
  const { task, state, reset } = useTaskStream('t-1');
  return task.data ? <TaskProgress task={task.data} state={state} onRetried={reset} /> : null;
}

const T0 = '2026-10-16T10:00:00.000Z';
const step = (node: string, order: number, status: 'active' | 'complete', log?: string) => ({
  node,
  status,
  ...(log ? { log } : {}),
  payload: { stepId: `s-${node}`, order, attempt: 1, startedAt: T0 },
});
const terminal = {
  node: 'task',
  status: 'complete',
  payload: {
    taskId: 't-1',
    taskStatus: 'awaiting_review',
    result: null,
    lastCompletedStep: 'validate',
    error: null,
  },
};

const flush = (ms = 0) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const fetchMock = vi.fn();
let current = taskDto({ kind: 'generate', status: 'in_progress', sourceId: undefined });

beforeEach(() => {
  vi.useFakeTimers();
  current = taskDto({ kind: 'generate', status: 'in_progress', sourceId: undefined });
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(current), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

describe('run page for a prompt (generate) task', () => {
  it.each([false, true])(
    'follows the live stream to Awaiting review without a reload (StrictMode %s)',
    async (strict) => {
      const client = createTestQueryClient();
      const tree = (
        <QueryClientProvider client={client}>
          <RunPage />
        </QueryClientProvider>
      );
      render(strict ? <StrictMode>{tree}</StrictMode> : tree);
      await flush();
      expect(screen.getByText('Run status: Running')).toBeTruthy();
      const es = FakeEventSource.last!;
      expect(es.closed).toBe(false);

      act(() => es.emitOpen());
      act(() => es.emitMessage(step('outline', 1, 'active')));
      await flush(4400);
      act(() => es.emitMessage(step('outline', 1, 'complete', '6 concepts, 7 sentences planned')));
      act(() => es.emitMessage(step('draftQuestions', 2, 'active')));
      expect(screen.getByText(/Plan: 6 concepts/)).toBeTruthy();

      // The task is finished on the server by the time the terminal event arrives.
      current = taskDto({ kind: 'generate', status: 'awaiting_review', sourceId: undefined });
      act(() => es.emitMessage(terminal));
      await flush();
      expect(screen.getByText('Run status: Awaiting review')).toBeTruthy();
      expect(screen.getByText('Drafts are ready')).toBeTruthy();
      expect(screen.queryByText('No log lines yet.')).toBeNull();
    },
  );

  it('still reaches the final state when the stream goes silent after the first event', async () => {
    const client = createTestQueryClient();
    render(
      <QueryClientProvider client={client}>
        <RunPage />
      </QueryClientProvider>,
    );
    await flush();
    const es = FakeEventSource.last!;
    act(() => es.emitOpen());
    act(() => es.emitMessage(step('outline', 1, 'active')));

    // The server finishes the run, but nothing more reaches the browser (no event, no error).
    current = taskDto({
      kind: 'generate',
      status: 'awaiting_review',
      sourceId: undefined,
      steps: [
        {
          stepId: 's-outline',
          order: 1,
          node: 'outline',
          status: 'complete',
          log: '6 concepts, 7 sentences planned',
          startedAt: T0,
        },
        {
          stepId: 's-validate',
          order: 5,
          node: 'validate',
          status: 'complete',
          log: '5 drafts kept',
          startedAt: T0,
        },
      ],
    });
    await flush(HEARTBEAT_MS + 100);
    expect(screen.getByText('Run status: Awaiting review')).toBeTruthy();
    expect(screen.getByText(/Plan: 6 concepts/)).toBeTruthy();
    expect(screen.getByText(/Validate: 5 drafts kept/)).toBeTruthy();
    expect(es.closed).toBe(true);
  });
});
