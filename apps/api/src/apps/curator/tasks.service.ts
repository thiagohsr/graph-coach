import { Inject, Injectable } from '@nestjs/common';
import { toIso } from '@coach/graph-kit';
import type { StepDto, StepName, TaskDto } from '@coach/types';
import { assertOwner } from '../../common/access/access';
import type { AuthUser } from '../../common/auth/auth-user';
import type { StepReadRow, TaskReadRow } from './curator.rows';
import { TaskReadQueries } from './tasks.queries';

export interface TaskSnapshot {
  task: TaskReadRow;
  steps: StepReadRow[];
}

/** The attempt of each step: the number of earlier `error` steps of the same node, plus one. */
export function attemptsOf(steps: StepReadRow[]): Map<string, number> {
  const failed = new Map<string, number>();
  const attempts = new Map<string, number>();
  for (const step of [...steps].sort((a, b) => a.order - b.order)) {
    attempts.set(step.stepId, (failed.get(step.node) ?? 0) + 1);
    if (step.status === 'error') failed.set(step.node, (failed.get(step.node) ?? 0) + 1);
  }
  return attempts;
}

@Injectable()
export class TasksService {
  constructor(@Inject(TaskReadQueries) private readonly reads: TaskReadQueries) {}

  /** The task and its steps, or 404 for an unknown task and for anyone who did not request it, whatever their role. */
  async snapshot(user: AuthUser, taskId: string): Promise<TaskSnapshot> {
    const task = await this.reads.getTask(taskId, user.id);
    assertOwner(user, task?.requesterId, 'Task');
    const steps = await this.reads.taskSteps(taskId, user.id);
    return { task: task!, steps };
  }

  async get(user: AuthUser, taskId: string): Promise<TaskDto> {
    return toTaskDto(await this.snapshot(user, taskId));
  }
}

export function toStepDto(step: StepReadRow): StepDto {
  return {
    stepId: step.stepId,
    order: step.order,
    node: step.node as StepName,
    status: step.status,
    ...(step.log !== null && step.log !== '' ? { log: step.log } : {}),
    ...(step.status !== 'active'
      ? {
          usage: {
            modelCalls: step.modelCalls,
            inputTokens: step.inputTokens,
            outputTokens: step.outputTokens,
            embeddingTokens: step.embeddingTokens,
          },
        }
      : {}),
    startedAt: toIso(step.startedAt),
    ...(step.finishedAt !== null ? { finishedAt: toIso(step.finishedAt) } : {}),
  };
}

export function toTaskDto({ task, steps }: TaskSnapshot): TaskDto {
  return {
    id: task.id,
    kind: task.kind,
    status: task.status,
    result: task.result,
    ...(task.status === 'failed' && task.error !== null ? { error: task.error } : {}),
    usage: {
      modelCalls: task.modelCalls,
      inputTokens: task.inputTokens,
      outputTokens: task.outputTokens,
      embeddingTokens: task.embeddingTokens,
    },
    steps: [...steps].sort((a, b) => a.order - b.order).map(toStepDto),
    produced: {
      concepts: task.concepts,
      questions: task.questions,
      ...(task.puzzleId !== null ? { puzzleId: task.puzzleId } : {}),
    },
    ...(task.sourceId !== null ? { sourceId: task.sourceId } : {}),
    ...(task.lastCompletedStep !== null
      ? { lastCompletedStep: task.lastCompletedStep as StepName }
      : {}),
  };
}
