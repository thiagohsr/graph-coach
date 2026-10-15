import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { RunOrchestrator } from './run-orchestrator.service';

/**
 * Start-up resume (decision D14): the Task and Step nodes are the state of a run, so after a restart every open task
 * continues at the step after its `lastCompletedStep`. A task whose requester is blocked is marked failed instead of
 * started. This never blocks start-up: it only reads the open tasks and schedules them; the runs go on in the background.
 */
@Injectable()
export class StartupResumeService implements OnApplicationBootstrap {
  private readonly logger = new Logger('StartupResume');

  constructor(@Inject(RunOrchestrator) private readonly orchestrator: RunOrchestrator) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const started = await this.orchestrator.resumeOpen();
      if (started > 0) this.logger.log(`Resumed ${started} open task${started === 1 ? '' : 's'}`);
    } catch (error) {
      // A graph that is down at start-up must not stop the application; the tasks stay open for the next start.
      this.logger.error(
        `Start-up resume skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
