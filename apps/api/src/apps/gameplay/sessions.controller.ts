import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { SubmitRequest, type StartSessionResponse, type SubmitResult } from '@coach/types';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/auth/decorators';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { SessionsService } from './sessions.service';

const IdParam = z.string().min(1).max(64);
const idPipe = new ZodValidationPipe(IdParam);

@Controller()
export class SessionsController {
  constructor(@Inject(SessionsService) private readonly sessions: SessionsService) {}

  @Post('puzzles/:id/sessions')
  start(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) puzzleId: string,
  ): Promise<StartSessionResponse> {
    return this.sessions.start(user, puzzleId);
  }

  @Post('sessions/:id/submit')
  @HttpCode(200)
  submit(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) sessionId: string,
    @Body(new ZodValidationPipe(SubmitRequest)) body: SubmitRequest,
  ): Promise<SubmitResult> {
    return this.sessions.submit(user, sessionId, body);
  }

  /** The stored result of a submitted session; the session's learner only (any other caller gets 404). */
  @Get('sessions/:id')
  result(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) sessionId: string,
  ): Promise<SubmitResult> {
    return this.sessions.getResult(user, sessionId);
  }
}
