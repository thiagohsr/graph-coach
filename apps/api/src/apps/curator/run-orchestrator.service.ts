import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CuratorStepError,
  MAX_CONCURRENT_RUNS,
  resolveEntry,
  resolvePromptEntry,
  runCurator,
  runPromptCreation,
  type CuratorDeps,
  type CuratorNode,
  type PromptNode,
  type StepName,
  type TaskRow,
} from '@coach/agents/curator';
import type { ChatProvider, EmbeddingsProvider, RunHandle, UsageTracer } from '@coach/agents/llm';
import type { ConflictDetails } from '@coach/types';
import { AccountsService } from '../accounts/accounts.service';
import { AllowanceService } from '../allowance/allowance.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { CLOCK, type Clock } from '../../common/clock';
import { ConflictError, UnavailableError } from '../../common/errors/app-error';
import { CHAT_PROVIDER, EMBEDDINGS_PROVIDER, USAGE_TRACER } from '../../common/llm/llm.module';
import { SettingsService } from '../../common/settings/settings.service';
import { CuratorGraph } from './curator.graph-port';
import { TaskEventBus } from './task-events.bus';
import { TaskRecorder, taskEvent } from './task-recorder';

/** Tracing must never fail or delay a run. */
function quietly<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

/** Principle VII: a log line never carries an error message (it may hold source text or model output). */
function errorClass(error: unknown): string {
  return error instanceof Error ? error.constructor.name : typeof error;
}

const OPEN_STATUSES = ['queued', 'in_progress'] as const;
const RUN_KINDS = ['ingest', 'generate'] as const;
/** A `cover` task runs the prompt graph on a brief source made by the cover pickup (spec 005 US7). */
const isPromptKind = (kind: string): boolean => kind === 'generate' || kind === 'cover';

/**
 * Runs the pipeline for a task, in this process (decision D14). The Task and Step nodes are the run's only state, so a
 * run can be started at the step after `lastCompletedStep`: after a restart, after a failure (retry), or for a new task.
 * `Task.kind` picks the graph: `ingest` runs the upload graph, `generate` the prompt graph.
 */
@Injectable()
export class RunOrchestrator {
  private readonly logger = new Logger('RunOrchestrator');
  private readonly running = new Map<string, Promise<void>>();
  private readonly resumeQueue: string[] = [];
  private resumeActive = 0;

  constructor(
    @Inject(CuratorGraph) private readonly graph: CuratorGraph,
    @Inject(TaskRecorder) private readonly recorder: TaskRecorder,
    @Inject(TaskEventBus) private readonly bus: TaskEventBus,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CHAT_PROVIDER) private readonly chat: ChatProvider,
    @Inject(EMBEDDINGS_PROVIDER) private readonly embeddings: EmbeddingsProvider,
    @Inject(USAGE_TRACER) private readonly tracer: UsageTracer,
    @Inject(AllowanceService) private readonly allowance: AllowanceService,
  ) {}

  /** Fire and forget; a no-op when the task is already running here. */
  start(taskId: string): void {
    if (this.running.has(taskId)) return;
    const run = this.run(taskId)
      .catch((error: unknown) => {
        this.logger.error(
          `task=${taskId} step=unknown tag=run_unexpected_error error=${errorClass(error)}`,
        );
      })
      .finally(() => {
        this.running.delete(taskId);
      });
    this.running.set(taskId, run);
  }

  isRunning(taskId: string): boolean {
    return this.running.has(taskId);
  }

  /** For tests: resolves when the task is not running any more. */
  async whenIdle(taskId: string): Promise<void> {
    while (this.running.has(taskId)) await this.running.get(taskId);
  }

  /** For tests: resolves when no run started by `resumeOpen` is queued or running. */
  async whenResumed(): Promise<void> {
    while (this.resumeQueue.length > 0 || this.resumeActive > 0) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  /**
   * POST /tasks/:id/retry, after the access check. Refused while creation is paused (the only allowance reason retry
   * acts on; `begin` is never called, so nothing is consumed and the hourly limit does not apply). A failed task moves
   * to `in_progress` with its error cleared, in one conditional write: a second caller finds no row and gets 409.
   */
  async retry(user: AuthUser, task: { id: string; kind: TaskRow['kind'] }): Promise<void> {
    const check = await this.allowance.check(user, isPromptKind(task.kind) ? 'prompt' : 'upload');
    if (!check.allowed && check.reason === 'paused') {
      throw new UnavailableError('CREATION_PAUSED', 'Puzzle creation is paused');
    }
    // A cover task that was refused at the allowance never began: it has no source yet. It goes back to `queued` and
    // through the cover pickup, which asks the allowance again (spec 005 US7).
    const stored = task.kind === 'cover' ? await this.graph.loadTask(task.id) : null;
    const requeue = task.kind === 'cover' && stored !== null && stored.sourceId === null && this.coverHook !== null;
    const moved = await this.recorder.setTaskStatus(task.id, ['failed'], {
      status: requeue ? 'queued' : 'in_progress',
      error: null,
    });
    if (!moved) {
      const current = await this.graph.loadTask(task.id);
      throw new ConflictError('Only a failed task can be retried', {
        code: 'TASK_NOT_FAILED',
        details: { status: current?.status ?? 'unknown' } as unknown as ConflictDetails,
      });
    }
    if (requeue) this.coverHook?.(task.id);
    else this.start(task.id);
  }

  private coverHook: ((taskId: string) => void) | null = null;

  /** The cover pickup registers itself here so that a retry of a refused cover task goes through it. */
  onCoverRetry(hook: (taskId: string) => void): void {
    this.coverHook = hook;
  }

  /**
   * Start-up resume. Every `queued` and `in_progress` task of the pipeline is looked at: one whose requester is blocked
   * is marked `failed` with ACCOUNT_BLOCKED (no step starts, no provider is called), the others are started, at most
   * `MAX_CONCURRENT_RUNS` at a time. Returns how many were started. A task that cannot be read or written never stops
   * the others.
   */
  async resumeOpen(): Promise<number> {
    const open = await this.graph.openTasks([...OPEN_STATUSES], [...RUN_KINDS]);
    let started = 0;
    for (const task of open) {
      if (this.running.has(task.id) || this.resumeQueue.includes(task.id)) continue;
      try {
        if (task.requesterId === null || task.sourceId === null) {
          await this.fail(task.id, 'chunk', 'INCONSISTENT_STATE', 'The task has no requester or source');
          continue;
        }
        if (!(await this.accounts.isActive(task.requesterId))) {
          const node = await this.nextNode(task);
          await this.fail(task.id, node, 'ACCOUNT_BLOCKED', 'account blocked');
          continue;
        }
        this.resumeQueue.push(task.id);
        started += 1;
      } catch (error) {
        this.logger.error(
          `task=${task.id} step=${task.lastCompletedStep ?? 'none'} tag=resume_skipped error=${errorClass(error)}`,
        );
      }
    }
    this.pumpResume();
    return started;
  }

  private pumpResume(): void {
    while (this.resumeActive < MAX_CONCURRENT_RUNS && this.resumeQueue.length > 0) {
      const taskId = this.resumeQueue.shift()!;
      this.resumeActive += 1;
      this.start(taskId);
      void (this.running.get(taskId) ?? Promise.resolve()).finally(() => {
        this.resumeActive -= 1;
        this.pumpResume();
      });
    }
  }

  /** The step a stored task would start at next; `validate` when nothing is left to run. */
  private async nextNode(task: {
    id: string;
    kind: string;
    lastCompletedStep: string | null;
    sourceId: string | null;
  }): Promise<StepName> {
    const last = task.lastCompletedStep as StepName | null;
    const entry =
      isPromptKind(task.kind)
        ? resolvePromptEntry(last, await this.hasOutline(task.sourceId))
        : resolveEntry(last);
    return entry === 'none' || entry === 'finalise' ? 'validate' : entry;
  }

  private async hasOutline(sourceId: string | null): Promise<boolean> {
    if (!sourceId) return false;
    const read = await this.graph.sourceChunks(sourceId);
    return read?.source.outline != null;
  }

  private async deps(): Promise<CuratorDeps> {
    const settings = await this.settings.getAll();
    return {
      graph: this.graph,
      chat: this.chat,
      embeddings: this.embeddings,
      recorder: this.recorder,
      tracer: this.tracer,
      isActive: (userId) => this.accounts.isActive(userId),
      params: {
        chunkSizeChars: settings.chunkSizeChars,
        chunkOverlapChars: settings.chunkOverlapChars,
      },
      now: () => this.clock.now().getTime(),
    };
  }

  private async run(taskId: string): Promise<void> {
    const task = await this.graph.loadTask(taskId);
    if (
      !task ||
      (task.kind !== 'ingest' && !isPromptKind(task.kind)) ||
      !OPEN_STATUSES.includes(task.status as (typeof OPEN_STATUSES)[number])
    )
      return;

    const entry =
      isPromptKind(task.kind)
        ? resolvePromptEntry(task.lastCompletedStep, await this.hasOutline(task.sourceId))
        : resolveEntry(task.lastCompletedStep);
    if (entry === 'none') return;
    if (!task.requesterId || !task.sourceId) {
      await this.fail(taskId, 'chunk', 'INCONSISTENT_STATE', 'The task has no requester or source');
      return;
    }
    const { requesterId, sourceId } = task;

    // A conditional change: if another process or request moved the task on, this run has nothing to do.
    if (!(await this.recorder.setTaskStatus(taskId, OPEN_STATUSES, { status: 'in_progress' })))
      return;

    const runHandle: RunHandle | undefined = quietly(() =>
      this.tracer.startRun({ id: taskId, kind: task.kind as 'ingest' | 'generate' | 'cover', userId: requesterId }),
    );
    let ok = false;
    try {
      let outcome: 'awaiting_review' | 'nothing_usable';
      if (entry === 'finalise') {
        outcome = task.questions > 0 ? 'awaiting_review' : 'nothing_usable';
      } else if (isPromptKind(task.kind)) {
        const result = await runPromptCreation(await this.deps(), {
          taskId,
          sourceId,
          ownerId: requesterId,
          entry: entry as PromptNode,
          minQuestions: await this.settings.get('minQuestions'),
        });
        outcome = result.outcome;
      } else {
        const result = await runCurator(await this.deps(), {
          taskId,
          kind: 'ingest',
          sourceId,
          ownerId: requesterId,
          entry: entry as CuratorNode,
        });
        outcome = result.outcome;
      }
      await this.finish(taskId, outcome);
      ok = true;
    } catch (error) {
      await this.failWith(taskId, task, error);
    } finally {
      if (runHandle) quietly(() => this.tracer.endRun(runHandle, { ok }));
    }
  }

  private async finish(
    taskId: string,
    outcome: 'awaiting_review' | 'nothing_usable',
  ): Promise<void> {
    await this.recorder.setTaskStatus(
      taskId,
      ['in_progress'],
      outcome === 'awaiting_review'
        ? { status: 'awaiting_review' }
        : { status: 'done', result: 'nothing_usable' },
    );
  }

  /** error = "<node>: <CODE>: <message>", never source, brief, or provider text; the terminal task event follows. */
  private async failWith(taskId: string, task: TaskRow, error: unknown): Promise<void> {
    let stepError: CuratorStepError;
    if (error instanceof CuratorStepError) {
      stepError = error;
    } else {
      stepError = new CuratorStepError(
        await this.nextNode(task).catch(() => 'validate' as StepName),
        'INCONSISTENT_STATE',
        'The run stopped unexpectedly',
        { cause: error },
      );
      this.logger.error(
        `task=${taskId} step=${stepError.node} tag=run_unexpected_error error=${errorClass(error)}`,
      );
    }
    await this.fail(taskId, stepError.node, stepError.code, stepError.message);
  }

  private async fail(taskId: string, node: string, code: string, message: string): Promise<void> {
    const error = `${node}: ${code}: ${message}`;
    try {
      await this.recorder.setTaskStatus(taskId, OPEN_STATUSES, { status: 'failed', error });
    } catch (writeError) {
      // The graph could not store the failure. The task stays in_progress, so start-up resume picks it up; the stream
      // still gets a best-effort terminal event and closes.
      this.logger.error(
        `task=${taskId} step=${node} tag=failure_not_stored error=${errorClass(writeError)}`,
      );
      this.bus.publish(
        taskId,
        taskEvent({ taskId, status: 'failed', result: null, error, lastCompletedStep: null }),
      );
    }
  }
}
