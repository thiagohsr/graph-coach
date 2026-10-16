import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { briefForConcepts, deterministicId } from '@coach/agents/curator';
import { guardBrief } from '@coach/types';
import { AccountsService } from '../accounts/accounts.service';
import { AllowanceService } from '../allowance/allowance.service';
import { CLOCK, type Clock } from '../../common/clock';
import { AppError } from '../../common/errors/app-error';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { CuratorGraph } from './curator.graph-port';
import type { CoverTaskRow } from './curator.rows';
import { RunOrchestrator } from './run-orchestrator.service';
import { TaskRecorder } from './task-recorder';

/** Principle VII: a log line never carries an error message (it may hold source text or model output). */
function errorClass(error: unknown): string {
  return error instanceof Error ? error.constructor.name : typeof error;
}

/** The step a cover task would start at; the prompt graph begins with the outline. */
const FIRST_NODE = 'outline';

/**
 * Coverage requests (spec 005 US7, reconciliation J14). The Coach writes `cover` tasks; this service reads them from the
 * graph (there is no call between agents), asks the requester's prompt allowance, stores a brief built from the missing
 * concepts as a prompt source owned by the requester, and lets the orchestrator run the prompt graph under the cover
 * task's id. It looks at start-up and every `COVER_POLL_SECONDS`; never when `NODE_ENV=test` unless a test calls
 * `runOnce` itself, and never when `COVER_POLL_SECONDS=0`.
 */
@Injectable()
export class CoverPickupService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('CoverPickup');
  private timer: NodeJS.Timeout | null = null;
  private sweep: Promise<number> | null = null;
  private readonly inFlight = new Set<Promise<unknown>>();
  private stopped = false;

  constructor(
    @Inject(CuratorGraph) private readonly graph: CuratorGraph,
    @Inject(TaskRecorder) private readonly recorder: TaskRecorder,
    @Inject(RunOrchestrator) private readonly orchestrator: RunOrchestrator,
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(AllowanceService) private readonly allowance: AllowanceService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENV) private readonly env: Pick<Env, 'NODE_ENV' | 'COVER_POLL_SECONDS'>,
  ) {
    // A retry of a refused cover task goes through the same path as a new one, so the allowance is asked again.
    this.orchestrator.onCoverRetry((taskId) => this.track(this.runOnce({ onlyTask: taskId })));
  }

  onApplicationBootstrap(): void {
    const seconds = this.env.COVER_POLL_SECONDS;
    if (this.env.NODE_ENV === 'test' || seconds <= 0) return;
    this.track(this.runOnce({ resume: true }));
    this.timer = setInterval(() => this.track(this.runOnce()), seconds * 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** For tests: resolves when no sweep started by the poller or a retry is running. */
  async whenIdle(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.allSettled([...this.inFlight]);
  }

  private track(work: Promise<unknown>): void {
    const tracked = work.catch(() => undefined).finally(() => this.inFlight.delete(tracked));
    this.inFlight.add(tracked);
  }

  /**
   * One look at the graph. `resume` (start-up only) also restarts `in_progress` cover tasks that already have a source.
   * `onlyTask` limits the pass to one task (a retry). Passes never overlap: a call made during a pass waits for it, then
   * runs its own. Returns how many tasks were handled. Never throws.
   */
  async runOnce(options: { resume?: boolean; onlyTask?: string } = {}): Promise<number> {
    while (this.sweep) await this.sweep.catch(() => undefined);
    if (this.stopped) return 0;
    const pass = this.pass(options).catch((error: unknown) => {
      this.logger.error(`tag=cover_pass_failed error=${errorClass(error)}`);
      return 0;
    });
    this.sweep = pass;
    try {
      return await pass;
    } finally {
      this.sweep = null;
    }
  }

  private async pass(options: { resume?: boolean; onlyTask?: string }): Promise<number> {
    const rows = await this.graph.openCoverTasks(
      options.resume ? ['queued', 'in_progress'] : ['queued'],
    );
    let handled = 0;
    for (const row of rows) {
      if (this.stopped) break;
      if (options.onlyTask !== undefined && row.id !== options.onlyTask) continue;
      try {
        if (row.status === 'in_progress') await this.resume(row);
        else await this.pickUp(row);
        handled += 1;
      } catch (error) {
        // One task never stops the others; it stays as it is and the next pass looks at it again.
        this.logger.error(
          `task=${row.id} step=${FIRST_NODE} tag=cover_skipped error=${errorClass(error)}`,
        );
      }
    }
    if (handled > 0) this.logger.log(`Handled ${handled} cover task${handled === 1 ? '' : 's'}`);
    return handled;
  }

  /** Start-up: an `in_progress` cover task continues at the step after its last one, or fails if its requester is blocked. */
  private async resume(row: CoverTaskRow): Promise<void> {
    if (row.requesterId === null || row.sourceId === null) {
      await this.fail(row, 'INCONSISTENT_STATE', 'The task has no requester or source');
      return;
    }
    if (!(await this.accounts.isActive(row.requesterId))) {
      await this.fail(row, 'ACCOUNT_BLOCKED', 'account blocked');
      return;
    }
    this.orchestrator.start(row.id);
  }

  private async pickUp(row: CoverTaskRow): Promise<void> {
    if (row.requesterId === null || row.conceptIds.length === 0) {
      await this.fail(row, 'INCONSISTENT_STATE', 'The task has no requester or concepts');
      return;
    }
    const requesterId = row.requesterId;
    if (!(await this.accounts.isActive(requesterId))) {
      await this.fail(row, 'ACCOUNT_BLOCKED', 'account blocked');
      return;
    }

    // A source linked by an earlier pass that died before the claim: the allowance was already confirmed, so go on.
    let sourceId = row.sourceId;
    if (sourceId === null) {
      const concepts = await this.graph.coverConcepts(row.conceptIds);
      const brief = briefForConcepts(concepts);
      if (concepts.length === 0 || !guardBrief(brief).ok) {
        await this.fail(row, 'INCONSISTENT_STATE', 'The concepts could not be turned into a brief');
        return;
      }

      const account = await this.accounts.me(requesterId);
      let grant;
      try {
        grant = await this.allowance.begin({ id: requesterId, role: account.role }, 'prompt');
      } catch (error) {
        if (
          error instanceof AppError &&
          (error.code === 'CREATION_LIMIT_REACHED' || error.code === 'CREATION_PAUSED')
        ) {
          await this.fail(row, error.code, error.message);
          return;
        }
        throw error;
      }

      sourceId = deterministicId('cover-source', row.id);
      try {
        const now = this.clock.now().getTime();
        const created = await this.graph.createSource({
          id: sourceId,
          ownerId: requesterId,
          title: brief.subject.slice(0, 200),
          kind: 'prompt',
          fingerprint: null,
          content: null,
          brief: JSON.stringify(brief),
          now,
        });
        if (!created) throw new Error('The source could not be written: the owner does not exist');
        if (
          !(await this.graph.linkCoverTaskToSource({ taskId: row.id, requesterId, sourceId, now }))
        ) {
          throw new Error('The task could not be linked to its source');
        }
        grant.confirm();
      } catch (error) {
        await grant.refund();
        this.logger.error(
          `task=${row.id} step=${FIRST_NODE} tag=cover_source_not_written error=${errorClass(error)}`,
        );
        await this.fail(row, 'INCONSISTENT_STATE', 'The brief could not be stored');
        return;
      }
    }

    // A conditional change: if a retry or another pass moved the task on, this pass has nothing to do.
    if (!(await this.recorder.setTaskStatus(row.id, ['queued'], { status: 'in_progress' }))) return;
    this.orchestrator.start(row.id);
  }

  /** error = "<node>: <CODE>: <message>", the same shape as a failed step, so the web client shows it the same way. */
  private async fail(row: CoverTaskRow, code: string, message: string): Promise<void> {
    const error = `${FIRST_NODE}: ${code}: ${message}`;
    await this.recorder.setTaskStatus(row.id, ['queued', 'in_progress'], {
      status: 'failed',
      error,
    });
    this.logger.warn(`task=${row.id} step=${FIRST_NODE} tag=${code}`);
  }
}
