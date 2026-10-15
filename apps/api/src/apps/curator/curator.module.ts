import { Module } from '@nestjs/common';
import { CuratorGraph } from './curator.graph-port';
import { RunOrchestrator } from './run-orchestrator.service';
import { SourcesController } from './sources.controller';
import { SourcesService } from './sources.service';
import { StartupResumeService } from './startup-resume.service';
import { TaskEventBus } from './task-events.bus';
import { TaskRecorder } from './task-recorder';
import { TasksController } from './tasks.controller';
import { TaskReadQueries } from './tasks.queries';
import { TasksService } from './tasks.service';

/**
 * Sources, tasks, and the Curator run. Later phases add the publish service and start-up resume here. Exports what the
 * review module needs: the graph port, the recorder (the only writer of steps and publisher of task events), and the
 * orchestrator.
 */
@Module({
  controllers: [SourcesController, TasksController],
  providers: [
    CuratorGraph,
    TaskEventBus,
    TaskRecorder,
    RunOrchestrator,
    StartupResumeService,
    SourcesService,
    TaskReadQueries,
    TasksService,
  ],
  exports: [CuratorGraph, TaskRecorder, TaskEventBus, RunOrchestrator],
})
export class CuratorModule {}
