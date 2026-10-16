import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DevLoginRequest, type DevLoginResponse, type DevUserDto } from '@coach/types';
import { Public } from '../../common/auth/decorators';
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
import { UserDirectory } from './user-directory';
import { users } from './user.model';

/**
 * The development sign-in routes. Registered only by `DevAuthModule`, which the application imports only when
 * `AUTH_MODE=dev`: a non-dev build has no token-issuing route at all.
 */
@Controller('auth')
export class DevAuthController {
  constructor(
    @Inject(UserDirectory) private readonly directory: UserDirectory,
    @Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier,
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Defence in depth: the verifier must be the development one, else the route answers like an unknown route. */
  private devVerifier(): DevTokenVerifier {
    if (!(this.verifier instanceof DevTokenVerifier)) throw new NotFoundError('Route');
    return this.verifier;
  }

  @Public()
  @Get('dev-users')
  async devUsers(): Promise<DevUserDto[]> {
    this.devVerifier();
    return this.directory.demoUsers();
  }

  @Public()
  @Post('dev-login')
  @HttpCode(200)
  async devLogin(
    @Body(new ZodValidationPipe(DevLoginRequest)) body: DevLoginRequest,
  ): Promise<DevLoginResponse> {
    const verifier = this.devVerifier();
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
