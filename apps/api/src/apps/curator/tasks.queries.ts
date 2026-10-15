import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { GraphKit } from '@coach/graph-kit';
import { StepReadRow, TaskReadRow } from './curator.rows';

function requireUserId(userId: unknown): string {
  if (typeof userId !== 'string' || userId.trim() === '') {
    throw new Error('A task read needs the id of the calling user');
  }
  return userId;
}

/**
 * The only request-facing task reads (get_task, task_steps). Both require the caller's id and are requester-only:
 * there is no value that skips the check, and a missing or empty id is refused before anything is sent. No controller,
 * and no service method called by a controller, may use the pipeline's internal task read; a test enforces it.
 */
@Injectable()
export class TaskReadQueries {
  constructor(@Inject(GraphKit) private readonly graph: GraphKit) {}

  async getTask(id: string, userId: string): Promise<z.output<typeof TaskReadRow> | null> {
    const caller = requireUserId(userId);
    const [row] = await this.graph.query('get_task', { id, userId: caller });
    return row ? TaskReadRow.parse(row) : null;
  }

  async taskSteps(id: string, userId: string): Promise<Array<z.output<typeof StepReadRow>>> {
    const caller = requireUserId(userId);
    const rows = await this.graph.query('task_steps', { taskId: id, userId: caller });
    return rows.map((row) => StepReadRow.parse(row));
  }
}
