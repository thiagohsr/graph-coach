import { Controller, Get, Inject, Param } from '@nestjs/common';
import { z } from 'zod';
import type { DecisionDto, DecisionPathDto } from '@coach/types';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/auth/decorators';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CoachService } from './coach.service';

const idPipe = new ZodValidationPipe(z.string().min(1).max(64));

/** The learner a decision is for, or an admin; anyone else gets 404. */
@Controller('decisions')
export class DecisionsController {
  constructor(@Inject(CoachService) private readonly coach: CoachService) {}

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', idPipe) id: string): Promise<DecisionDto> {
    return this.coach.getDecision(user, id);
  }

  @Get(':id/path')
  path(@CurrentUser() user: AuthUser, @Param('id', idPipe) id: string): Promise<DecisionPathDto> {
    return this.coach.getDecisionPath(user, id);
  }
}
