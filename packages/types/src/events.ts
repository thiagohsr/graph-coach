import { z } from 'zod';

// One shape for every event on GET /tasks/:id/events.
export const AgentEventStatus = z.enum(['active', 'complete', 'error']);
export type AgentEventStatus = z.infer<typeof AgentEventStatus>;

export const AgentEvent = z.object({
  /** A pipeline step name, or the literal 'task' for the terminal event. */
  node: z.string().min(1),
  status: AgentEventStatus,
  log: z.string().optional(),
  /** Typed by 005 (StepEventPayload, TaskEventPayload in curator.ts). */
  payload: z.record(z.unknown()).optional(),
});
export type AgentEvent = z.infer<typeof AgentEvent>;
