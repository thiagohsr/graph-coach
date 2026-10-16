import { Controller, Get, Inject } from '@nestjs/common';
import type { MeDto } from '@coach/types';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/auth/decorators';
import { AccountsService } from './accounts.service';

@Controller('auth')
export class AccountsController {
  constructor(@Inject(AccountsService) private readonly accounts: AccountsService) {}

  /** The signed-in user's own record: the only response that carries an e-mail address. */
  @Get('me')
  async me(@CurrentUser() user: AuthUser): Promise<MeDto> {
    await this.accounts.touchLastSeen(user.id, { force: true });
    return this.accounts.me(user.id);
  }

  // The development routes (`dev-login`, `dev-users`) live in DevAuthController, registered only when AUTH_MODE=dev.
}
