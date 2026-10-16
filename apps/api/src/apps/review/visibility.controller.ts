import { Body, Controller, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { VisibilityRequest, type VisibilityResponse } from '@coach/types';
import { publisherParams } from '../../common/access/access';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { ConflictError, NotFoundError } from '../../common/errors/app-error';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { ReviewGraph } from './review.graph';

const idPipe = new ZodValidationPipe(z.string().min(1).max(100));

/** Publish to everyone: a reviewer or admin who owns a published puzzle. The play routes on this prefix are 003's. */
@Controller('puzzles/:id/visibility')
export class VisibilityController {
  constructor(@Inject(ReviewGraph) private readonly graph: ReviewGraph) {}

  @Post()
  @HttpCode(200)
  @Roles('reviewer', 'admin')
  async set(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(VisibilityRequest)) body: VisibilityRequest,
  ): Promise<VisibilityResponse> {
    const { userId } = publisherParams(user);
    const row = await this.graph.setVisibility(id, userId, body.visibility);
    if (!row) throw new NotFoundError('Puzzle');
    if (row.status === 'draft') {
      throw new ConflictError('The puzzle is not published', {
        details: { status: 'draft' } as never,
      });
    }
    return { id: row.id, visibility: row.visibility, origin: row.origin };
  }
}
