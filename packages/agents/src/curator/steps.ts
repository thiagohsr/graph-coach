// Step model and the wrapper every node runs in (contracts/internal-interfaces.md §1.3, §1.4).
import { STEP_TIMEOUT_MS } from './constants';
import {
  CuratorStepError,
  UsageMeter,
  type CuratorDeps,
  type StepContext,
  type StepRecord,
} from './ports';

/** Upload (`ingest`) runs. */
export const STEP_ORDER = [
  'chunk',
  'embed',
  'extractConcepts',
  'linkPrerequisites',
  'draftQuestions',
  'validate',
  'publish',
] as const;

/** Prompt (`generate`) runs. */
export const PROMPT_STEP_ORDER = [
  'outline',
  'draftQuestions',
  'critique',
  'refine',
  'validate',
  'publish',
] as const;

/** A step that exists only in a prompt run that needed a top-up round (reconciliation N). Never an entry point. */
export const TOP_UP_STEP = 'topUp' as const;

export type StepName =
  (typeof STEP_ORDER)[number] | (typeof PROMPT_STEP_ORDER)[number] | typeof TOP_UP_STEP;
export type CuratorNode = Exclude<(typeof STEP_ORDER)[number], 'publish'>;
export type PromptNode = Exclude<(typeof PROMPT_STEP_ORDER)[number], 'publish'>;
export type Entry = CuratorNode | 'finalise' | 'none';
export type PromptEntry = PromptNode | 'finalise' | 'none';

/** Where an upload run starts, given the last step that completed. */
export function resolveEntry(lastCompletedStep: StepName | null): Entry {
  switch (lastCompletedStep) {
    case null:
      return 'chunk';
    case 'chunk':
      return 'embed';
    case 'embed':
      return 'extractConcepts';
    case 'extractConcepts':
      return 'linkPrerequisites';
    case 'linkPrerequisites':
      return 'draftQuestions';
    // Its output (candidates) lives only in memory, so `validate` cannot start alone.
    case 'draftQuestions':
      return 'draftQuestions';
    // The graph has nothing left; only the task status must be set from stored state.
    case 'validate':
      return 'finalise';
    case 'publish':
      return 'none';
    default:
      return 'chunk';
  }
}

/** Where a prompt run starts. Drafts and verdicts live only in memory, so the writer and critic run again from the stored outline. */
export function resolvePromptEntry(
  lastCompletedStep: StepName | null,
  hasOutline: boolean,
): PromptEntry {
  switch (lastCompletedStep) {
    case 'outline':
    case 'draftQuestions':
    case 'critique':
    case 'refine':
    case 'topUp':
      return hasOutline ? 'draftQuestions' : 'outline';
    case 'validate':
      return 'finalise';
    case 'publish':
      return 'none';
    default:
      return 'outline';
  }
}

export interface StepOutput<T> {
  value: T;
  /** One short line. Counts only: never source text, prompt text, or provider output. */
  log: string;
  counts?: Record<string, number>;
}

export interface RunContext {
  taskId: string;
  /** The user whose account must be active for the step to start. */
  requesterId: string;
}

/** Tracing must never fail or delay a step. */
function quietly<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

function toStepError(node: StepName, error: unknown): CuratorStepError {
  if (error instanceof CuratorStepError) return error;
  const name = (error as { name?: unknown } | null)?.name;
  const code = (error as { code?: unknown } | null)?.code;
  if (name === 'GraphUnavailableError' || code === 'GRAPH_UNAVAILABLE') {
    return new CuratorStepError(node, 'GRAPH_UNAVAILABLE', 'The graph is unavailable', {
      cause: error,
    });
  }
  return new CuratorStepError(node, 'INCONSISTENT_STATE', 'The step failed unexpectedly', {
    cause: error,
  });
}

/**
 * Runs one node as a recorded step: blocked-requester check, `begin`, tracing, the node under a timeout, then `complete`
 * or `fail` with the usage the node accumulated. A node that has nothing to do still completes, with a log line saying so.
 */
export async function withStep<T>(
  deps: CuratorDeps,
  run: RunContext,
  node: StepName,
  fn: (ctx: StepContext) => Promise<StepOutput<T>>,
  /** 0 = the first pass; n = the nth top-up round of a prompt run. */
  round = 0,
): Promise<T> {
  if (!(await deps.isActive(run.requesterId))) {
    throw new CuratorStepError(node, 'ACCOUNT_BLOCKED', 'account blocked');
  }

  const record: StepRecord = await deps.recorder.begin(run.taskId, node, round);
  const meter = new UsageMeter();
  const runHandle = { runId: run.taskId };
  const trace = quietly(() => deps.tracer.startStep(runHandle, node)) ?? {
    runId: run.taskId,
    node,
  };
  const ctx: StepContext = {
    meter,
    trace,
    record,
    progress: (log) => quietly(() => deps.recorder.progress(record, log)),
  };

  const timeoutMs = deps.stepTimeoutMs ?? STEP_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new CuratorStepError(
              node,
              'STEP_TIMEOUT',
              `The step took longer than ${Math.round(timeoutMs / 1000)} seconds`,
            ),
          ),
        timeoutMs,
      );
    });
    const output = await Promise.race([fn(ctx), timeout]);
    if (timer) clearTimeout(timer);
    await deps.recorder.complete(record, output.log, meter.total(), output.counts);
    quietly(() => deps.tracer.endStep(trace, { ok: true }));
    return output.value;
  } catch (error) {
    if (timer) clearTimeout(timer);
    const stepError = toStepError(node, error);
    quietly(() => deps.tracer.endStep(trace, { ok: false }));
    await deps.recorder.fail(record, stepError, meter.total()).catch(() => undefined);
    throw stepError;
  }
}
