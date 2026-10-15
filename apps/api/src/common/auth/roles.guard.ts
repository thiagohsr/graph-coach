import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@coach/types';
import { ForbiddenError } from '../errors/app-error';
import { hasRole, type AuthUser } from './auth-user';
import { ROLES_KEY } from './decorators';

/** Global. 403 FORBIDDEN when the handler or its controller has @Roles(...) and the caller's role is not listed. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles) return true;
    const user = context.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user || !hasRole(user, ...roles)) throw new ForbiddenError();
    return true;
  }
}
