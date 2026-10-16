import type { AgentEvent, StepDto, TaskKind, TaskStatus } from '@coach/types';

// Pure reducer behind the pipeline progress view (data-model.md §3).

export type StepViewStatus = 'active' | 'complete' | 'error';
export type DiagramStatus = StepViewStatus | 'pending';
export type Transport = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'polling' | 'closed';

export interface StepView {
  stepId: string;
  node: string;
  order: number;
  attempt?: number;
  status: StepViewStatus;
  lines: string[];
  startedAt?: string;
  finishedAt?: string;
}

export interface PipelineState {
  steps: Record<string, StepView>;
  taskStatus: TaskStatus | null;
  transport: Transport;
  failures: number;
}

export type PipelineAction =
  | { type: 'SNAPSHOT'; steps: readonly StepDto[] }
  | { type: 'CONNECTING' }
  | { type: 'OPENED' }
  | { type: 'STEP_EVENT'; event: AgentEvent }
  | { type: 'TASK_EVENT'; event: AgentEvent }
  | { type: 'DROPPED' }
  | { type: 'CLOSED' }
  | { type: 'RESET' };

export const initialPipelineState: PipelineState = {
  steps: {},
  taskStatus: null,
  transport: 'idle',
  failures: 0,
};

/** Canonical step order per task kind (a `cover` task uses the `generate` list). */
export const INGEST_STEPS = [
  'chunk',
  'embed',
  'extractConcepts',
  'linkPrerequisites',
  'draftQuestions',
  'validate',
  'publish',
] as const;
export const GENERATE_STEPS = [
  'outline',
  'draftQuestions',
  'critique',
  'refine',
  'validate',
  'publish',
] as const;

const INGEST_LABELS: Record<string, string> = {
  chunk: 'Chunk',
  embed: 'Embed',
  extractConcepts: 'Extract concepts',
  linkPrerequisites: 'Link prerequisites',
  draftQuestions: 'Draft questions',
  validate: 'Validate',
  publish: 'Publish',
};
const GENERATE_LABELS: Record<string, string> = {
  outline: 'Plan',
  draftQuestions: 'Write',
  critique: 'Critique',
  refine: 'Rewrite',
  validate: 'Validate',
  topUp: 'Top up',
  publish: 'Publish',
};

export function stepOrderFor(kind: TaskKind): readonly string[] {
  return kind === 'ingest' ? INGEST_STEPS : GENERATE_STEPS;
}

/** The label of a step for a kind of task; an unexpected node shows its raw name. */
export function stepLabel(kind: TaskKind, node: string): string {
  const table = kind === 'ingest' ? INGEST_LABELS : GENERATE_LABELS;
  return table[node] ?? node;
}

function mergeLines(existing: string[], incoming: string[]): string[] {
  const out = [...existing];
  for (const line of incoming) if (line !== '' && !out.includes(line)) out.push(line);
  return out;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** Does not let a late `active` replay undo a step that already finished. */
function nextStatus(
  previous: StepViewStatus | undefined,
  incoming: StepViewStatus,
): StepViewStatus {
  if (previous && previous !== 'active' && incoming === 'active') return previous;
  return incoming;
}

function snapshotSteps(state: PipelineState, steps: readonly StepDto[]): Record<string, StepView> {
  const next = { ...state.steps };
  const sorted = [...steps].sort((a, b) => a.order - b.order);
  // The attempt is one plus the earlier steps of the node that ended in `error` (a retry), not the earlier steps: a
  // top-up round runs critique and validate again, and those are not second attempts.
  const failedByNode = new Map<string, number>();
  for (const step of sorted) {
    const attempt = (failedByNode.get(step.node) ?? 0) + 1;
    if (step.status === 'error') failedByNode.set(step.node, attempt);
    const previous = next[step.stepId];
    const lines = (step.log ?? '').split('\n').map((l) => l.trim());
    next[step.stepId] = {
      stepId: step.stepId,
      node: step.node,
      order: step.order,
      attempt: previous?.attempt ?? attempt,
      status: nextStatus(previous?.status, step.status),
      lines: mergeLines(previous?.lines ?? [], lines),
      startedAt: step.startedAt,
      ...(step.finishedAt
        ? { finishedAt: step.finishedAt }
        : previous?.finishedAt
          ? { finishedAt: previous.finishedAt }
          : {}),
    };
  }
  return next;
}

function stepEvent(state: PipelineState, event: AgentEvent): PipelineState {
  const payload = event.payload;
  if (!isRecord(payload) || typeof payload.stepId !== 'string' || payload.stepId === '') {
    console.error('Step event without a stepId was ignored', event);
    return state;
  }
  const stepId = payload.stepId;
  const previous = state.steps[stepId];
  const order = typeof payload.order === 'number' ? payload.order : (previous?.order ?? 0);
  const attempt = typeof payload.attempt === 'number' ? payload.attempt : previous?.attempt;
  const startedAt = typeof payload.startedAt === 'string' ? payload.startedAt : previous?.startedAt;
  const finishedAt =
    typeof payload.finishedAt === 'string' ? payload.finishedAt : previous?.finishedAt;
  const view: StepView = {
    stepId,
    node: event.node,
    order,
    status: nextStatus(previous?.status, event.status),
    lines: mergeLines(previous?.lines ?? [], event.log ? [event.log] : []),
    ...(attempt !== undefined ? { attempt } : {}),
    ...(startedAt !== undefined ? { startedAt } : {}),
    ...(finishedAt !== undefined ? { finishedAt } : {}),
  };
  return { ...state, steps: { ...state.steps, [stepId]: view } };
}

const TASK_STATUSES: readonly string[] = [
  'queued',
  'in_progress',
  'awaiting_review',
  'done',
  'failed',
];

export function pipelineReducer(state: PipelineState, action: PipelineAction): PipelineState {
  switch (action.type) {
    case 'SNAPSHOT':
      return { ...state, steps: snapshotSteps(state, action.steps) };
    case 'CONNECTING':
      return { ...state, transport: state.failures > 0 ? 'reconnecting' : 'connecting' };
    case 'OPENED':
      return { ...state, failures: 0, transport: 'live' };
    case 'STEP_EVENT':
      return stepEvent(state, action.event);
    case 'TASK_EVENT': {
      const status = isRecord(action.event.payload) ? action.event.payload.taskStatus : undefined;
      const taskStatus =
        typeof status === 'string' && TASK_STATUSES.includes(status)
          ? (status as TaskStatus)
          : state.taskStatus;
      return { ...state, taskStatus, transport: 'closed' };
    }
    case 'DROPPED': {
      const failures = state.failures + 1;
      return { ...state, failures, transport: failures >= 3 ? 'polling' : 'reconnecting' };
    }
    case 'CLOSED':
      return { ...state, transport: 'closed' };
    case 'RESET':
      return initialPipelineState;
    default:
      return state;
  }
}

// ─── Selectors ───────────────────────────────────────────────────────────────

export interface DiagramItem {
  node: string;
  label: string;
  status: DiagramStatus;
  stepId?: string;
}

/** The steps a top-up round repeats (reconciliation N); `topUp` itself starts a round. */
const ROUND_NODES: readonly string[] = ['topUp', 'critique', 'refine', 'validate'];

/** `order` of the first `topUp` step, or null when the run did not top up. */
function topUpStart(state: PipelineState): number | null {
  let start: number | null = null;
  for (const step of Object.values(state.steps)) {
    if (step.node === 'topUp' && (start === null || step.order < start)) start = step.order;
  }
  return start;
}

/** Steps of a top-up round: a repeatable node at or after the first `topUp` step. */
function roundSteps(state: PipelineState): StepView[] {
  const start = topUpStart(state);
  if (start === null) return [];
  return Object.values(state.steps).filter(
    (step) => step.order >= start && ROUND_NODES.includes(step.node),
  );
}

/** The status of the "Top up" item: error if any round step failed, complete once the latest round's validate is, else active. */
function topUpStatus(state: PipelineState): StepViewStatus {
  const steps = roundSteps(state);
  const latestOf = new Map<string, StepView>();
  for (const step of steps) {
    const current = latestOf.get(step.node);
    if (!current || step.order > current.order) latestOf.set(step.node, step);
  }
  const latest = [...latestOf.values()];
  if (latest.some((step) => step.status === 'error')) return 'error';
  const lastTopUp = latestOf.get('topUp');
  const validate = latestOf.get('validate');
  if (lastTopUp && validate && validate.order > lastTopUp.order && validate.status === 'complete') {
    return 'complete';
  }
  return 'active';
}

/** The latest view of a node in the first pass: the one with the highest `order`, leaving a top-up round's steps out. */
function latestByNode(state: PipelineState): Map<string, StepView> {
  const latest = new Map<string, StepView>();
  const start = topUpStart(state);
  for (const step of Object.values(state.steps)) {
    if (start !== null && step.order >= start && ROUND_NODES.includes(step.node)) continue;
    const current = latest.get(step.node);
    if (!current || step.order > current.order) latest.set(step.node, step);
  }
  return latest;
}

/** The step list for the task's kind; unseen steps are `pending`. A node outside the list is added by its `order`. */
export function diagramSteps(kind: TaskKind, state: PipelineState): DiagramItem[] {
  const latest = latestByNode(state);
  const canonical = stepOrderFor(kind);
  const items: (DiagramItem & { order: number })[] = canonical.map((node, index) => {
    const view = latest.get(node);
    return {
      node,
      label: stepLabel(kind, node),
      status: view?.status ?? 'pending',
      ...(view ? { stepId: view.stepId } : {}),
      order: view?.order ?? index - canonical.length,
    };
  });
  const extras = [...latest.values()]
    .filter((view) => !canonical.includes(view.node))
    .map((view) => ({
      node: view.node,
      label: view.node,
      status: view.status as DiagramStatus,
      stepId: view.stepId,
      order: view.order,
    }));
  // A run that topped up gets a "Top up" item after Validate; a run that did not never shows it.
  const start = topUpStart(state);
  if (kind !== 'ingest' && start !== null) {
    const at = items.findIndex((item) => item.node === 'validate');
    const last = roundSteps(state).sort((a, b) => b.order - a.order)[0]!;
    items.splice(at < 0 ? items.length : at + 1, 0, {
      node: 'topUp',
      label: stepLabel(kind, 'topUp'),
      status: topUpStatus(state),
      stepId: last.stepId,
      order: start,
    });
  }
  if (extras.length === 0) return items.map(({ order: _order, ...item }) => item);
  // Canonical items keep their sequence; an extra goes after the last canonical item that has a lower `order`.
  const result: (DiagramItem & { order: number })[] = [...items];
  for (const extra of extras.sort((a, b) => a.order - b.order)) {
    let at = 0;
    result.forEach((item, index) => {
      if (item.status !== 'pending' && item.order < extra.order) at = index + 1;
    });
    result.splice(at, 0, extra);
  }
  return result.map(({ order: _order, ...item }) => item);
}

export interface LogLine {
  key: string;
  text: string;
}

/** Every line of every step in `order`, prefixed with the step label (and the attempt number after the first). */
export function logLines(kind: TaskKind, state: PipelineState): LogLine[] {
  const out: LogLine[] = [];
  const steps = Object.values(state.steps).sort((a, b) => a.order - b.order);
  for (const step of steps) {
    const prefix = `${stepLabel(kind, step.node)}${step.attempt !== undefined && step.attempt > 1 ? ` (attempt ${step.attempt})` : ''}`;
    step.lines.forEach((line, index) =>
      out.push({ key: `${step.stepId}#${index}`, text: `${prefix}: ${line}` }),
    );
  }
  return out;
}
