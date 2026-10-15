import { Module } from '@nestjs/common';
import { CoachController } from './coach.controller';
import { CoachService } from './coach.service';
import { DecisionsController } from './decisions.controller';

/** The Coach agent: recommendations and the stored "why" of each decision. */
@Module({
  controllers: [CoachController, DecisionsController],
  providers: [CoachService],
  exports: [CoachService],
})
export class CoachModule {}
