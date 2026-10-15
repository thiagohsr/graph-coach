import { Controller, Get, HttpCode, Inject, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import type { StepName } from '@coach/agents/curator';
import { toIso } from '@coach/graph-kit';
import type { AgentEvent, TaskDto } from '@coach/types';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/auth/decorators';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import type { StepReadRow } from './curator.rows';
import { RunOrchestrator } from './run-orchestrator.service';
import { TaskEventBus, type TaskBusEvent } from './task-events.bus';
import { taskEvent } from './task-recorder';
import { TasksService, attemptsOf } from './tasks.service';

const idPipe = new ZodValidationPipe(z.string().min(1).max(64));

/**
 * `: ping` every 15 seconds; a non-terminal stream with no event for 10 minutes is closed (the client may reconnect).
 * An object so that tests can shorten the times; nothing reads them from the environment.
 */
export const STREAM_TIMING = { pingMs: 15_000, idleMs: 10 * 60_000 };

const TERMINAL = new Set(['awaiting_review', 'done', 'failed']);

/** a < a:1 < a:2 < z, within one step order. */
function rank(id: string): number {
  const suffix = id.slice(id.indexOf(':') + 1);
  if (suffix === 'z') return Number.POSITIVE_INFINITY;
  if (suffix === 'a') return 0;
  return Number(suffix.slice(2)) || 0;
}
const orderOf = (id: string): number => Number(id.slice(0, id.indexOf(':')));

/** One stored step as a stream event: replayed once with its current status. */
function replayEvent(step: StepReadRow, attempt: number): TaskBusEvent {
  const done = step.status !== 'active';
  return {
    id: done ? `${step.order}:z` : `${step.order}:a`,
    node: step.node,
    status: step.status,
    ...(step.log !== null && step.log !== '' ? { log: step.log } : {}),
    payload: {
      stepId: step.stepId,
      order: step.order,
      attempt,
      startedAt: toIso(step.startedAt),
      ...(step.finishedAt !== null ? { finishedAt: toIso(step.finishedAt) } : {}),
      ...(done
        ? {
            usage: {
              modelCalls: step.modelCalls,
              inputTokens: step.inputTokens,
              outputTokens: step.outputTokens,
              embeddingTokens: step.embeddingTokens,
            },
          }
        : {}),
    },
  };
}

@Controller('tasks')
export class TasksController {
  constructor(
    @Inject(TasksService) private readonly tasks: TasksService,
    @Inject(TaskEventBus) private readonly bus: TaskEventBus,
    @Inject(RunOrchestrator) private readonly orchestrator: RunOrchestrator,
  ) {}

  /**
   * POST /tasks/:id/retry: no body. 404 for anyone but the requester, then 503 CREATION_PAUSED while creation is paused,
   * then 409 TASK_NOT_FAILED unless the task is `failed`. Consumes no allowance.
   */
  @Post(':id/retry')
  @HttpCode(202)
  async retry(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
  ): Promise<{ taskId: string }> {
    const { task } = await this.tasks.snapshot(user, id);
    await this.orchestrator.retry(user, { id: task.id, kind: task.kind });
    return { taskId: task.id };
  }

  /** The requester only; anyone else, whatever their role, and an unknown id answer 404. */
  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', idPipe) id: string): Promise<TaskDto> {
    return this.tasks.get(user, id);
  }

  /**
   * GET /tasks/:id/events (contracts/events-sse.md): subscribe, read the stored steps, replay them once each in order,
   * flush what arrived meanwhile (dropping what the replay already covered), then forward live events. The stream ends
   * with the terminal task event.
   */
  @Get(':id/events')
  async events(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const buffered: TaskBusEvent[] = [];
    let live = false;
    let ended = false;
    const replayedRank = new Map<number, number>();
    const timers: { idle?: NodeJS.Timeout; ping?: NodeJS.Timeout } = {};
    let unsubscribe: () => void = () => undefined;

    const end = () => {
      if (ended) return;
      ended = true;
      if (timers.idle) clearTimeout(timers.idle);
      if (timers.ping) clearInterval(timers.ping);
      unsubscribe();
      if (!res.writableEnded) res.end();
    };
    const write = (event: TaskBusEvent) => {
      if (ended) return;
      const { id: eventId, ...data } = event;
      res.write(`id: ${eventId}\ndata: ${JSON.stringify(data satisfies AgentEvent)}\n\n`);
      armIdle();
    };
    const armIdle = () => {
      if (timers.idle) clearTimeout(timers.idle);
      timers.idle = setTimeout(end, STREAM_TIMING.idleMs);
    };
    /** Forwards one event unless the replay already covered it; the terminal event closes the stream. */
    const deliver = (event: TaskBusEvent) => {
      if (event.node === 'task') {
        write(event);
        end();
        return;
      }
      const covered = replayedRank.get(orderOf(event.id));
      if (covered !== undefined && rank(event.id) <= covered) return;
      write(event);
    };

    unsubscribe = this.bus.subscribe(id, (event) => (live ? deliver(event) : buffered.push(event)));

    let snapshot;
    try {
      snapshot = await this.tasks.snapshot(user, id);
    } catch (error) {
      unsubscribe();
      throw error;
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    // The response closing is the client going away (the request's own 'close' only means the request was read).
    res.on('close', end);
    timers.ping = setInterval(() => {
      if (!ended) res.write(': ping\n\n');
    }, STREAM_TIMING.pingMs);
    armIdle();

    const attempts = attemptsOf(snapshot.steps);
    for (const step of [...snapshot.steps].sort((a, b) => a.order - b.order)) {
      const event = replayEvent(step, attempts.get(step.stepId) ?? 1);
      replayedRank.set(step.order, rank(event.id));
      write(event);
    }

    if (TERMINAL.has(snapshot.task.status)) {
      write(
        taskEvent({
          taskId: snapshot.task.id,
          status: snapshot.task.status as 'awaiting_review' | 'done' | 'failed',
          result: snapshot.task.result,
          error: snapshot.task.status === 'failed' ? snapshot.task.error : null,
          lastCompletedStep: snapshot.task.lastCompletedStep as StepName | null,
        }),
      );
      end();
      return;
    }

    for (const event of buffered.splice(0)) {
      deliver(event);
      if (ended) return;
    }
    live = true;
  }
}
