import { z } from 'zod';
import { Id } from './common';

export const Role = z.enum(['learner', 'reviewer', 'admin']);
export type Role = z.infer<typeof Role>;

export const UserStatus = z.enum(['active', 'blocked']);
export type UserStatus = z.infer<typeof UserStatus>;

/** GET /auth/me: the signed-in user's own record. The only DTO of 002 that carries an e-mail address. */
export const MeDto = z.object({
  id: Id,
  name: z.string(),
  email: z.string().email(),
  role: Role,
  status: UserStatus,
});
export type MeDto = z.infer<typeof MeDto>;

/** How other people are named in any response: id and display name, never an address. */
export const UserRef = z.object({ id: Id, name: z.string() });
export type UserRef = z.infer<typeof UserRef>;

/** GET /auth/dev-users: the seeded demo accounts, development mode only. */
export const DevUserDto = z.object({ email: z.string().email(), name: z.string(), role: Role });
export type DevUserDto = z.infer<typeof DevUserDto>;

export const DevLoginRequest = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
});
export type DevLoginRequest = z.infer<typeof DevLoginRequest>;

export const DevLoginResponse = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int().positive(),
});
export type DevLoginResponse = z.infer<typeof DevLoginResponse>;
