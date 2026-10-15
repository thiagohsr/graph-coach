import type { Role } from '@coach/types';

/** The authenticated caller. id = users.id = Learner.id; never the Cognito sub. */
export interface AuthUser {
  id: string;
  role: Role;
}

export function hasRole(user: AuthUser, ...roles: Role[]): boolean {
  return roles.includes(user.role);
}
