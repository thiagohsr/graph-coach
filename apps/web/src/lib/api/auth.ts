import { MeDto } from '@coach/types';
import { apiFetch } from './client';

/** `GET /auth/me` through the forwarding route, for use after sign-in. */
export function getMe(signal?: AbortSignal) {
  return apiFetch('/auth/me', signal ? { schema: MeDto, signal } : { schema: MeDto });
}
