import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DevLoginRequest, type DevLoginResponse, type DevUserDto, type MeDto } from '@coach/types';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Public } from '../../common/auth/decorators';
import { DevTokenVerifier } from '../../common/auth/dev-token-verifier';
import { TOKEN_VERIFIER, type TokenVerifier } from '../../common/auth/token-verifier';
import { CLOCK, type Clock } from '../../common/clock';
import { DB, type Db } from '../../common/db/db.module';
import {
  AccountBlockedError,
  NotFoundError,
  UnauthenticatedError,
} from '../../common/errors/app-error';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { AccountsService } from './accounts.service';
import { UserDirectory } from './user-directory';
import { users } from './user.model';

@Controller('auth')
export class AccountsController {
  constructor(
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(UserDirectory) private readonly directory: UserDirectory,
    @Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier,
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** The signed-in user's own record: the only response that carries an e-mail address. */
  @Get('me')
  async me(@CurrentUser() user: AuthUser): Promise<MeDto> {
    await this.accounts.touchLastSeen(user.id, { force: true });
    return this.accounts.me(user.id);
  }

  /** The development routes exist only in `dev` mode; in `cognito` mode they answer like any unknown route. */
  private requireDevMode(): DevTokenVerifier {
    if (this.env.auth.mode !== 'dev' || !(this.verifier instanceof DevTokenVerifier)) {
      throw new NotFoundError('Route');
    }
    return this.verifier;
  }

  @Public()
  @Get('dev-users')
  async devUsers(): Promise<DevUserDto[]> {
    this.requireDevMode();
    return this.directory.demoUsers();
  }

  @Public()
  @Post('dev-login')
  @HttpCode(200)
  async devLogin(
    @Body(new ZodValidationPipe(DevLoginRequest)) body: DevLoginRequest,
  ): Promise<DevLoginResponse> {
    const verifier = this.requireDevMode();
    const [row] = await this.db
      .select({ id: users.id, status: users.status })
      .from(users)
      .where(eq(users.email, body.email))
      .limit(1);
    if (!row) {
      throw new UnauthenticatedError('No account with that e-mail address', 'INVALID_CREDENTIALS');
    }
    if (row.status === 'blocked') throw new AccountBlockedError();
    await this.db.update(users).set({ lastSeenAt: this.clock.now() }).where(eq(users.id, row.id));
    return verifier.sign(row.id);
  }
}
