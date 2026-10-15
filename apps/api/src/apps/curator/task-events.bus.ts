import { Injectable } from '@nestjs/common';
import type { AgentEvent } from '@coach/types';

/** An event on a task's stream, with the id that orders it within the task (events-sse.md "Event ids"). */
export type TaskBusEvent = AgentEvent & { id: string };
export type TaskEventListener = (event: TaskBusEvent) => void;

/**
 * Task id -> listeners, inside the API process (runs execute in the same process, decision D14). It holds no history:
 * the graph is the history. The only publisher is TaskRecorder, which writes the change to the graph first.
 */
@Injectable()
export class TaskEventBus {
  private readonly listeners = new Map<string, Set<TaskEventListener>>();

  /** Calls the listeners synchronously, in publication order. A listener that throws does not affect the others. */
  publish(taskId: string, event: TaskBusEvent): void {
    const set = this.listeners.get(taskId);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        listener(event);
      } catch {
        // A broken subscriber (a closed socket) must not stop the run.
      }
    }
  }

  /** Returns the function that removes the listener. */
  subscribe(taskId: string, listener: TaskEventListener): () => void {
    let set = this.listeners.get(taskId);
    if (!set) {
      set = new Set();
      this.listeners.set(taskId, set);
    }
    set.add(listener);
    return () => {
      const current = this.listeners.get(taskId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.listeners.delete(taskId);
    };
  }

  /** For tests and metrics. */
  listenerCount(taskId: string): number {
    return this.listeners.get(taskId)?.size ?? 0;
  }
}
