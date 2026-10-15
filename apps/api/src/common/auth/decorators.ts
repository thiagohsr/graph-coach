import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Role } from '@coach/types';
import type { AuthUser } from './auth-user';

export const IS_PUBLIC_KEY = 'coach:isPublic';
export const ROLES_KEY = 'coach:roles';

/** Skips AuthGuard for a handler or controller. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Explicit allow-list. @Roles('reviewer', 'admin') does not admit learners; @Roles('admin') admits admins only. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** The authenticated caller. Using it on a @Public() route is a programming error and throws. */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthUser => {
  const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
  if (!request.user) {
    throw new Error('CurrentUser() used on a route without an authenticated user (is it @Public()?)');
  }
  return request.user;
});
