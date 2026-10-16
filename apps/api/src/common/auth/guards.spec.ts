import { Controller, Get, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import type { Account, AccountsService } from '../../apps/accounts/accounts.service';
import { AccountBlockedError, ForbiddenError, UnauthenticatedError } from '../errors/app-error';
import { AuthGuard } from './auth.guard';
import type { AuthUser } from './auth-user';
import { Public, Roles } from './decorators';
import { RolesGuard } from './roles.guard';
import type { TokenVerifier, VerifiedIdentity } from './token-verifier';

const ACCOUNT: Account = { id: 'user-1', role: 'reviewer', status: 'active', displayName: 'Rae' };

@Controller('t')
class Routes {
  @Get('plain') plain() {}
  @Public() @Get('open') open() {}
  @Roles('reviewer', 'admin') @Get('staff') staff() {}
  @Roles('admin') @Get('admin') adminOnly() {}
}

@Roles('admin')
@Controller('c')
class AdminController {
  @Get('x') x() {}
}

function context(
  headers: Record<string, string>,
  handler: (...args: never[]) => unknown,
  cls: new () => object = Routes,
  user?: AuthUser,
) {
  const request: { headers: Record<string, string>; user?: AuthUser } = {
    headers,
    ...(user ? { user } : {}),
  };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => cls,
  } as unknown as ExecutionContext;
  return { ctx, request };
}

function setup(options: { verifier?: Partial<TokenVerifier>; account?: Account | Error } = {}) {
  const identity: VerifiedIdentity = { kind: 'cognito', sub: 'sub-1' };
  const verifier: TokenVerifier = {
    mode: 'cognito',
    verifyAccessToken: vi.fn(async () => identity),
    verifyIdToken: vi.fn(),
    ...options.verifier,
  };
  const account = options.account ?? ACCOUNT;
  const accounts = {
    resolve: vi.fn(async () => {
      if (account instanceof Error) throw account;
      return account;
    }),
  } as unknown as AccountsService;
  return {
    guard: new AuthGuard(new Reflector(), verifier, accounts),
    verifier,
    accounts,
    identity,
  };
}

describe('AuthGuard', () => {
  it('passes @Public() handlers without looking at a token', async () => {
    const { guard, verifier } = setup();
    const { ctx } = context({}, Routes.prototype.open);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(verifier.verifyAccessToken).not.toHaveBeenCalled();
  });

  it('refuses a missing header and a wrong scheme with UnauthenticatedError', async () => {
    const { guard } = setup();
    await expect(guard.canActivate(context({}, Routes.prototype.plain).ctx)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    await expect(
      guard.canActivate(context({ authorization: 'Basic abc' }, Routes.prototype.plain).ctx),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(
      guard.canActivate(context({ authorization: 'Bearer ' }, Routes.prototype.plain).ctx),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('turns a verifier failure into UnauthenticatedError', async () => {
    const { guard } = setup({
      verifier: {
        verifyAccessToken: vi.fn(async () => {
          throw new Error('boom');
        }),
      },
    });
    await expect(
      guard.canActivate(context({ authorization: 'Bearer t' }, Routes.prototype.plain).ctx),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('passes the identity and X-Id-Token to resolve', async () => {
    const { guard, accounts, identity } = setup();
    const { ctx } = context(
      { authorization: 'Bearer tok', 'x-id-token': 'idtok' },
      Routes.prototype.plain,
    );
    await guard.canActivate(ctx);
    expect(accounts.resolve).toHaveBeenCalledWith(identity, 'idtok');
    const { ctx: ctx2 } = context({ authorization: 'bearer tok' }, Routes.prototype.plain);
    await guard.canActivate(ctx2);
    expect(accounts.resolve).toHaveBeenLastCalledWith(identity, undefined);
  });

  it('a blocked account gets AccountBlockedError', async () => {
    const { guard } = setup({ account: { ...ACCOUNT, status: 'blocked' } });
    await expect(
      guard.canActivate(context({ authorization: 'Bearer t' }, Routes.prototype.plain).ctx),
    ).rejects.toBeInstanceOf(AccountBlockedError);
  });

  it('an active account gets AuthUser { id, role } from the account, not the token', async () => {
    const { guard } = setup();
    const { ctx, request } = context({ authorization: 'Bearer t' }, Routes.prototype.plain);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.user).toEqual({ id: 'user-1', role: 'reviewer' });
  });

  it('lets an error from resolve through unchanged', async () => {
    const failure = new ForbiddenError('Verify your e-mail address to use this site');
    const { guard } = setup({ account: failure });
    await expect(
      guard.canActivate(context({ authorization: 'Bearer t' }, Routes.prototype.plain).ctx),
    ).rejects.toBe(failure);
  });
});

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  it('passes when no roles are declared', () => {
    const { ctx } = context({}, Routes.prototype.plain, Routes, { id: 'u', role: 'learner' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('passes a listed role and refuses others with ForbiddenError', () => {
    const allowed = context({}, Routes.prototype.staff, Routes, { id: 'u', role: 'reviewer' }).ctx;
    expect(guard.canActivate(allowed)).toBe(true);
    const admin = context({}, Routes.prototype.staff, Routes, { id: 'u', role: 'admin' }).ctx;
    expect(guard.canActivate(admin)).toBe(true);
    const learner = context({}, Routes.prototype.staff, Routes, { id: 'u', role: 'learner' }).ctx;
    expect(() => guard.canActivate(learner)).toThrowError(ForbiddenError);
  });

  it('@Roles("admin") admits admins only', () => {
    const reviewer = context({}, Routes.prototype.adminOnly, Routes, {
      id: 'u',
      role: 'reviewer',
    }).ctx;
    expect(() => guard.canActivate(reviewer)).toThrowError(ForbiddenError);
    const admin = context({}, Routes.prototype.adminOnly, Routes, { id: 'u', role: 'admin' }).ctx;
    expect(guard.canActivate(admin)).toBe(true);
  });

  it('a class-level @Roles applies to its handlers', () => {
    const learner = context({}, AdminController.prototype.x, AdminController, {
      id: 'u',
      role: 'learner',
    }).ctx;
    expect(() => guard.canActivate(learner)).toThrowError(ForbiddenError);
  });
});
