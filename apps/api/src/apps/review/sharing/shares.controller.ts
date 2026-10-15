import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Put } from '@nestjs/common';
import { z } from 'zod';
import { ShareRequest, type ShareDto } from '@coach/types';
import type { AuthUser } from '../../../common/auth/auth-user';
import { CurrentUser } from '../../../common/auth/decorators';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import { SharesService } from './shares.service';

const idPipe = new ZodValidationPipe(z.string().min(1).max(100));

/** Owner only: a puzzle the caller does not own, or that does not exist, is 404 on all three, whatever the role. */
@Controller('puzzles/:id/shares')
export class SharesController {
  constructor(@Inject(SharesService) private readonly shares: SharesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Param('id', idPipe) id: string): Promise<ShareDto[]> {
    return this.shares.list(user, id);
  }

  @Put()
  @HttpCode(200)
  share(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(ShareRequest)) body: ShareRequest,
  ): Promise<ShareDto> {
    return this.shares.share(user, id, body);
  }

  @Delete(':userId')
  @HttpCode(204)
  async revoke(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Param('userId', idPipe) userId: string,
  ): Promise<void> {
    await this.shares.revoke(user, id, userId);
  }
}
