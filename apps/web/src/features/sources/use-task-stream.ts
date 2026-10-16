import { AgentEvent, type TaskDto, type TaskStatus } from '@coach/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useReducer, useState } from 'react';
import { sourcesListOptions, taskEventsUrl, taskOptions } from '~/lib/api/curator';
import { keys } from '~/lib/query/keys';
import { initialPipelineState, pipelineReducer } from './pipeline-state';

const TERMINAL: ReadonlySet<TaskStatus> = new Set<TaskStatus>(['awaiting_review', 'done', 'failed']);
const LIVE: ReadonlySet<TaskStatus> = new Set<TaskStatus>(['queued', 'in_progress']);
export const POLL_MS = 3000;
const MAX_FAILURES = 3;

/**
 * Loads the task and keeps the pipeline view up to date (data-model.md §3.4): a stream while the task runs,
 * reconnects after a drop, polling as the last resort, and only a snapshot for a finished task.
 */
export function useTaskStream(taskId: string) {
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(pipelineReducer, initialPipelineState);
  const [generation, setGeneration] = useState(0);

  const task = useQuery({
    ...taskOptions(taskId),
    // Polling is only the fallback after repeated stream failures.
    refetchInterval: state.transport === 'polling' ? POLL_MS : false,
    retry: false,
  });

  const status = task.data?.status;
  const live = status !== undefined && LIVE.has(status);
  const terminal = status !== undefined && TERMINAL.has(status);

  // A finished task, and every poll, are shown from the stored steps.
  useEffect(() => {
    if (!task.data) return;
    if (terminal || state.transport === 'polling') dispatch({ type: 'SNAPSHOT', steps: task.data.steps });
    if (terminal) {
      dispatch({ type: 'CLOSED' });
      void queryClient.invalidateQueries({ queryKey: sourcesListOptions().queryKey });
      if (task.data.status === 'awaiting_review') void queryClient.invalidateQueries({ queryKey: keys.review.all });
    }
    // Deliberately keyed on task.data and terminal only.
  }, [task.data, terminal]);

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let source: EventSource | undefined;
    let sawTerminal = false;

    const finish = (taskStatus: TaskStatus | undefined) => {
      void queryClient.invalidateQueries({ queryKey: keys.tasks.detail(taskId) });
      void queryClient.invalidateQueries({ queryKey: sourcesListOptions().queryKey });
      if (taskStatus === 'awaiting_review') void queryClient.invalidateQueries({ queryKey: keys.review.all });
    };

    const onDrop = async () => {
      let fresh: TaskDto | undefined;
      try {
        fresh = await queryClient.fetchQuery({ ...taskOptions(taskId), staleTime: 0 });
      } catch {
        fresh = undefined;
      }
      if (cancelled) return;
      if (fresh && TERMINAL.has(fresh.status)) return; // the task effect snapshots and closes
      failures += 1;
      dispatch({ type: 'DROPPED' });
      if (failures < MAX_FAILURES) timer = setTimeout(open, 1000 * 2 ** (failures - 1));
      // At MAX_FAILURES the reducer says `polling` and the task query refetches every POLL_MS.
    };

    const open = () => {
      if (cancelled) return;
      dispatch({ type: 'CONNECTING' });
      const es = new EventSource(taskEventsUrl(taskId));
      source = es;
      es.onopen = () => {
        failures = 0;
        dispatch({ type: 'OPENED' });
      };
      es.onmessage = (message: MessageEvent) => {
        let parsed;
        try {
          parsed = AgentEvent.safeParse(JSON.parse(String(message.data)));
        } catch {
          return;
        }
        if (!parsed.success) return;
        const event = parsed.data;
        if (event.node === 'task') {
          sawTerminal = true;
          dispatch({ type: 'TASK_EVENT', event });
          es.close();
          const taskStatus = (event.payload as { taskStatus?: TaskStatus } | undefined)?.taskStatus;
          finish(taskStatus);
          return;
        }
        dispatch({ type: 'STEP_EVENT', event });
      };
      es.onerror = () => {
        if (sawTerminal || cancelled) return;
        es.close();
        void onDrop();
      };
    };

    open();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      source?.close();
    };
  }, [taskId, live, generation, queryClient]);

  /** After a retry: forget the old run's steps and let the effect open a new stream once the task is live again. */
  const reset = useCallback(() => {
    dispatch({ type: 'RESET' });
    setGeneration((g) => g + 1);
  }, []);

  return { task, state, reset };
}
