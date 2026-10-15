import { Body, Controller, Inject, Post } from '@nestjs/common';
import { RecommendationRequest, type RecommendationDto } from '@coach/types';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/auth/decorators';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CoachService } from './coach.service';

@Controller('coach')
export class CoachController {
  constructor(@Inject(CoachService) private readonly coach: CoachService) {}

  /** Acts for the caller only: the learner id is the token's, never the body's. Status 201 for fresh and reused. */
  @Post('recommendations')
  recommend(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(RecommendationRequest)) body: RecommendationRequest,
  ): Promise<RecommendationDto> {
    return this.coach.recommend(user.id, body.goal);
  }
}
