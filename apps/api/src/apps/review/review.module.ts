import { Module } from '@nestjs/common';
import { CuratorModule } from '../curator/curator.module';
import { PublishService } from './publish.service';
import { ReviewController } from './review.controller';
import { ReviewGraph } from './review.graph';
import { ReviewService } from './review.service';
import { SharesController } from './sharing/shares.controller';
import { SharesService } from './sharing/shares.service';
import { VisibilityController } from './visibility.controller';

/**
 * Draft review and publishing, sharing, and visibility (spec 005). It imports the Curator module for the step recorder
 * that closes a task and exports nothing.
 */
@Module({
  imports: [CuratorModule],
  controllers: [ReviewController, SharesController, VisibilityController],
  providers: [ReviewGraph, PublishService, ReviewService, SharesService],
})
export class ReviewModule {}
