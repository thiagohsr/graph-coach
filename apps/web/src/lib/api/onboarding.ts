import type { OnboardingOutcome } from '@coach/types';
import { apiFetch } from './client';

/** `POST /me/onboarding` with `{ outcome }`; 204, idempotent. */
export function recordOnboarding(outcome: OnboardingOutcome) {
  return apiFetch('/me/onboarding', { method: 'POST', body: { outcome } });
}
