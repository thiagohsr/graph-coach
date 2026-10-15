import { Controller, Get, Inject } from '@nestjs/common';
import type { MasteryDto } from '@coach/types';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/auth/decorators';
import { MasteryService } from './mastery.service';

@Controller('me')
export class MasteryController {
  constructor(@Inject(MasteryService) private readonly mastery: MasteryService) {}

  /** The caller's own mastery, whatever their role. */
  @Get('mastery')
  list(@CurrentUser() user: AuthUser): Promise<MasteryDto[]> {
    return this.mastery.list(user.id);
  }
}
