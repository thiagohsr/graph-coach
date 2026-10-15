import { Module } from '@nestjs/common';
import { LearnerLock } from './learner-lock';
import { MasteryController } from './mastery.controller';
import { MasteryService } from './mastery.service';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

/** Sessions, grading, and mastery. Exports MasteryService (seed tooling and tests). */
@Module({
  controllers: [SessionsController, MasteryController],
  providers: [SessionsService, MasteryService, LearnerLock],
  exports: [MasteryService],
})
export class GameplayModule {}
