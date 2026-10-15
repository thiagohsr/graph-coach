import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  DraftUpdateRequest,
  RejectRequest,
  type DraftQuestionDto,
  type ReviewOutcome,
} from '@coach/types';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/auth/decorators';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { ReviewService } from './review.service';

const idPipe = new ZodValidationPipe(z.string().min(1).max(100));
const ListQuery = z.object({
  status: z.enum(['draft', 'approved', 'rejected']).optional(),
  taskId: z.string().min(1).max(100).optional(),
});
type ListQuery = z.infer<typeof ListQuery>;

/**
 * Draft review. Any signed-in user may call it; only the owner of the puzzle that holds a question can reach it, and
 * everyone else (any role, a user the puzzle is shared with) gets 404. Never 403.
 */
@Controller('review/questions')
export class ReviewController {
  constructor(@Inject(ReviewService) private readonly review: ReviewService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListQuery)) query: ListQuery,
  ): Promise<DraftQuestionDto[]> {
    return this.review.list(user, query);
  }

  @Patch(':id')
  edit(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(DraftUpdateRequest)) body: DraftUpdateRequest,
  ): Promise<DraftQuestionDto> {
    return this.review.edit(user, id, body);
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(@CurrentUser() user: AuthUser, @Param('id', idPipe) id: string): Promise<ReviewOutcome> {
    return this.review.approve(user, id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(RejectRequest)) body: RejectRequest,
  ): Promise<ReviewOutcome> {
    return this.review.reject(user, id, body.reason);
  }
}
