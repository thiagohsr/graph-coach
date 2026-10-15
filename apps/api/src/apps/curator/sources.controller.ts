import { Body, Controller, Get, Inject, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import {
  SourceCreateRequest,
  type SourceDetailDto,
  type SourceCreateResponse,
  type SourceSummaryDto,
} from '@coach/types';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/auth/decorators';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { SourcesService } from './sources.service';

@Controller('sources')
export class SourcesController {
  constructor(@Inject(SourcesService) private readonly sources: SourcesService) {}

  /** 202 { taskId, sourceId } for a new run; 200 { duplicateOf, taskId } when the caller already submitted this text. */
  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(SourceCreateRequest)) body: SourceCreateRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SourceCreateResponse> {
    const result = await this.sources.create(user, body);
    res.status(result.status);
    return result.body;
  }

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<SourceSummaryDto[]> {
    return this.sources.list(user);
  }

  /** The owner, or a user the puzzle was shared with including the source; everyone else, any role, gets 404. */
  @Get(':id')
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(z.string().min(1).max(100))) id: string,
  ): Promise<SourceDetailDto> {
    return this.sources.get(user, id);
  }
}
