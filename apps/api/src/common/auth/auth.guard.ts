import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccountsService } from '../../apps/accounts/accounts.service';
import { AccountBlockedError, UnauthenticatedError } from '../errors/app-error';
import type { AuthUser } from './auth-user';
import { IS_PUBLIC_KEY } from './decorators';
import { TOKEN_VERIFIER, type TokenVerifier, type VerifiedIdentity } from './token-verifier';

interface AuthRequest {
  headers: Record<string, string | string[] | undefined>;
  user?: AuthUser;
}

function header(request: AuthRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Global. For every route not marked @Public(): token -> account -> status. Role and status come from the accounts
 * table (5-second cache), never from the token. Runs once when an event stream opens.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier,
    @Inject(AccountsService) private readonly accounts: AccountsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthRequest>();
    const authorization = header(request, 'authorization') ?? '';
    const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization);
    if (!match) throw new UnauthenticatedError();

    let identity: VerifiedIdentity;
    try {
      identity = await this.verifier.verifyAccessToken(match[1]!);
    } catch (error) {
      throw error instanceof UnauthenticatedError ? error : new UnauthenticatedError();
    }

    const idToken = header(request, 'x-id-token');
    const account = await this.accounts.resolve(identity, idToken);
    if (account.status === 'blocked') throw new AccountBlockedError();

    request.user = { id: account.id, role: account.role };
    return true;
  }
}
