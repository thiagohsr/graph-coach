import { Inject, Injectable } from '@nestjs/common';
import {
  ALL_TASK_STATUSES,
  stepId as makeStepId,
  type CuratorStepError,
  type StepName,
  type StepRecord,
  type StepRecorder,
  type TaskPatch,
  type TaskStatusName,
  type TaskUpdate,
  type Usage,
} from '@coach/agents/curator';
import { toIso } from '@coach/graph-kit';
import type { StepEventPayload, TaskEventPayload } from '@coach/types';
import { CLOCK, type Clock } from '../../common/clock';
import { CuratorGraph } from './curator.graph-port';
import { TaskEventBus, type TaskBusEvent } from './task-events.bus';

const TERMINAL_STATUSES: readonly TaskStatusName[] = ['awaiting_review', 'done', 'failed'];

/**
 * The only writer of Step nodes and the only publisher on the TaskEventBus. It writes to the graph first and publishes
 * second, so an event is never delivered for a state that was not stored (events-sse.md "Event bus").
 */
@Injectable()
export class TaskRecorder implements StepRecorder {
  /** Progress counters per step, for the `<order>:a:<n>` event ids. */
  private readonly progressCount = new Map<string, number>();

  constructor(
    @Inject(CuratorGraph) private readonly graph: CuratorGraph,
    @Inject(TaskEventBus) private readonly bus: TaskEventBus,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private now(): number {
    return this.clock.now().getTime();
  }

  /**
   * The attempt is the number of stored `error` steps of this node plus one. A stored step of that attempt that is
   * `active` or `complete` (left by a crash or a re-run) is reused and set back to `active`; otherwise a new step is
   * added at position (existing steps + 1).
   */
  async begin(taskId: string, node: StepName): Promise<StepRecord> {
    const task = await this.graph.loadTask(taskId);
    if (!task) throw new Error(`Task ${taskId} does not exist`);
    const attempt = task.steps.filter((s) => s.node === node && s.status === 'error').length + 1;
    const id = makeStepId(taskId, node, attempt);
    const existing = task.steps.find((s) => s.stepId === id);
    const order = existing?.order ?? task.steps.length + 1;
    const startedAt = existing?.startedAt ?? this.now();

    await this.graph.addStep({
      taskId,
      id,
      node,
      status: 'active',
      log: '',
      order,
      startedAt,
      finishedAt: null,
      usage: { modelCalls: 0, inputTokens: 0, outputTokens: 0, embeddingTokens: 0 },
    });
    this.progressCount.delete(id);
    const handle: StepRecord = { taskId, stepId: id, node, order, attempt, startedAt };
    this.bus.publish(taskId, {
      id: `${order}:a`,
      node,
      status: 'active',
      payload: this.payload(handle),
    });
    return handle;
  }

  /** A live event only; nothing is stored. */
  progress(handle: StepRecord, log: string): void {
    const n = (this.progressCount.get(handle.stepId) ?? 0) + 1;
    this.progressCount.set(handle.stepId, n);
    this.bus.publish(handle.taskId, {
      id: `${handle.order}:a:${n}`,
      node: handle.node,
      status: 'active',
      log,
      payload: this.payload(handle),
    });
  }

  async complete(
    handle: StepRecord,
    log: string,
    usage: Usage,
    counts?: Record<string, number>,
  ): Promise<void> {
    const finishedAt = this.now();
    await this.graph.addStep({
      taskId: handle.taskId,
      id: handle.stepId,
      node: handle.node,
      status: 'complete',
      log,
      order: handle.order,
      startedAt: handle.startedAt,
      finishedAt,
      usage,
    });
    await this.graph.updateTask(
      handle.taskId,
      ALL_TASK_STATUSES,
      { lastCompletedStep: handle.node },
      finishedAt,
    );
    this.progressCount.delete(handle.stepId);
    this.bus.publish(handle.taskId, {
      id: `${handle.order}:z`,
      node: handle.node,
      status: 'complete',
      log,
      payload: this.payload(handle, { finishedAt, usage, ...(counts ? { counts } : {}) }),
    });
  }

  async fail(handle: StepRecord, error: CuratorStepError, usage: Usage): Promise<void> {
    const finishedAt = this.now();
    const log = `${error.code}: ${error.message}`;
    await this.graph.addStep({
      taskId: handle.taskId,
      id: handle.stepId,
      node: handle.node,
      status: 'error',
      log,
      order: handle.order,
      startedAt: handle.startedAt,
      finishedAt,
      usage,
    });
    this.progressCount.delete(handle.stepId);
    this.bus.publish(handle.taskId, {
      id: `${handle.order}:z`,
      node: handle.node,
      status: 'error',
      log,
      payload: this.payload(handle, { finishedAt, usage }),
    });
  }

  /**
   * Conditional status change (`update_task`). Returns false when the task was not in an expected status. When the new
   * status is awaiting_review, done, or failed it also publishes the terminal task event.
   */
  async setTaskStatus(
    taskId: string,
    expected: readonly TaskStatusName[],
    patch: TaskPatch,
  ): Promise<boolean> {
    const updated = await this.graph.updateTask(taskId, expected, patch, this.now());
    if (!updated) return false;
    if (TERMINAL_STATUSES.includes(updated.status)) this.bus.publish(taskId, taskEvent(updated));
    return true;
  }

  private payload(
    handle: StepRecord,
    extra: { finishedAt?: number; usage?: Usage; counts?: Record<string, number> } = {},
  ): StepEventPayload {
    return {
      stepId: handle.stepId,
      order: handle.order,
      attempt: handle.attempt,
      startedAt: toIso(handle.startedAt),
      ...(extra.finishedAt !== undefined ? { finishedAt: toIso(extra.finishedAt) } : {}),
      ...(extra.counts ? { counts: extra.counts } : {}),
      ...(extra.usage ? { usage: { ...extra.usage } } : {}),
    };
  }
}

/** The terminal event of a task, from the row `update_task` returned (or from a stored task on connect). */
export function taskEvent(
  task: Pick<TaskUpdate, 'taskId' | 'status' | 'result' | 'error' | 'lastCompletedStep'>,
): TaskBusEvent {
  const payload: TaskEventPayload = {
    taskId: task.taskId,
    taskStatus: task.status,
    result: task.result,
    lastCompletedStep: task.lastCompletedStep,
    error: task.error,
  };
  return {
    id: `task:${task.status}`,
    node: 'task',
    status: task.status === 'failed' ? 'error' : 'complete',
    payload,
  };
}
