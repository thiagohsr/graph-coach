import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { keys } from '~/lib/query/keys';
import { FakeEventSource } from '~/test/setup';
import { createTestQueryClient } from '~/test/render';
import { taskDto } from './fixtures';
import { useTaskStream } from './use-task-stream';

const fetchMock = vi.fn();
let current = taskDto();

function setup(task = taskDto()) {
  current = task;
  const queryClient = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  const view = renderHook(() => useTaskStream('t-1'), { wrapper });
  return { queryClient, ...view };
}

const flush = (ms = 0) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

const stepMessage = (stepId: string, order: number, status = 'active', log?: string) => ({
  node: 'chunk',
  status,
  ...(log ? { log } : {}),
  payload: { stepId, order, attempt: 1, startedAt: '2026-10-15T10:00:00.000Z' },
});

const terminalMessage = (taskStatus: string) => ({
  node: 'task',
  status: taskStatus === 'failed' ? 'error' : 'complete',
  payload: { taskId: 't-1', taskStatus, result: null, lastCompletedStep: null, error: null },
});

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(current), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

describe('useTaskStream', () => {
  it('opens no stream for a terminal task and shows its stored steps', async () => {
    setup(
      taskDto({
        status: 'done',
        result: 'ok',
        steps: [
          { stepId: 's1', order: 1, node: 'chunk', status: 'complete', log: 'chunked', startedAt: '2026-10-15T10:00:00.000Z' },
        ],
      }),
    );
    await flush();
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it.each(['queued', 'in_progress'] as const)('opens a stream for a %s task', async (status) => {
    setup(taskDto({ status }));
    await flush();
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.last?.url).toBe('/api/tasks/t-1/events');
  });

  it('dispatches step events and ignores a message that fails the AgentEvent schema', async () => {
    const { result } = setup();
    await flush();
    act(() => FakeEventSource.last?.emitOpen());
    act(() => FakeEventSource.last?.emitMessage(stepMessage('s1', 1, 'active', 'splitting')));
    act(() => FakeEventSource.last?.emitMessage({ nope: true }));
    act(() => FakeEventSource.last?.emitMessage('not json'));
    expect(result.current.state.transport).toBe('live');
    expect(Object.keys(result.current.state.steps)).toEqual(['s1']);
  });

  it('closes on the terminal task event, invalidates the task query, and does not reconnect', async () => {
    const { queryClient } = setup();
    await flush();
    const es = FakeEventSource.last!;
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    act(() => es.emitMessage(terminalMessage('awaiting_review')));
    expect(es.closed).toBe(true);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.tasks.detail('t-1') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.review.all });
    act(() => es.emitError());
    await flush(10_000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('on error without a terminal event closes, refetches the task, and stops when it is terminal', async () => {
    const { result } = setup();
    await flush();
    const es = FakeEventSource.last!;
    current = taskDto({ status: 'awaiting_review' });
    const calls = fetchMock.mock.calls.length;
    act(() => es.emitError());
    await flush();
    expect(es.closed).toBe(true);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(calls);
    await flush(10_000);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(result.current.state.transport).toBe('closed');
  });

  it('reconnects after 1 s, then 2 s, then falls back to polling every 3 s', async () => {
    const { result } = setup();
    await flush();
    act(() => FakeEventSource.last?.emitError());
    await flush();
    expect(FakeEventSource.instances).toHaveLength(1);
    await flush(999);
    expect(FakeEventSource.instances).toHaveLength(1);
    await flush(1);
    expect(FakeEventSource.instances).toHaveLength(2);

    act(() => FakeEventSource.last?.emitError());
    await flush();
    await flush(1999);
    expect(FakeEventSource.instances).toHaveLength(2);
    await flush(1);
    expect(FakeEventSource.instances).toHaveLength(3);

    act(() => FakeEventSource.last?.emitError());
    await flush();
    expect(result.current.state.transport).toBe('polling');
    await flush(10_000);
    expect(FakeEventSource.instances).toHaveLength(3);
    const before = fetchMock.mock.calls.length;
    await flush(3000);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(before);

    // The poll finds the task finished: polling ends.
    current = taskDto({ status: 'done', result: 'ok' });
    await flush(3000);
    expect(result.current.state.transport).toBe('closed');
    const settled = fetchMock.mock.calls.length;
    await flush(9000);
    expect(fetchMock.mock.calls.length).toBe(settled);
  });

  it('closes the stream and clears timers on unmount', async () => {
    const { unmount } = setup();
    await flush();
    const es = FakeEventSource.last!;
    act(() => es.emitError());
    await flush();
    unmount();
    await flush(10_000);
    expect(FakeEventSource.instances).toHaveLength(1);
    const open = setup();
    await flush();
    const second = FakeEventSource.last!;
    open.unmount();
    expect(second.closed).toBe(true);
  });
});
