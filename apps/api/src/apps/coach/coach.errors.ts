import { AppError, UnavailableError } from '../../common/errors/app-error';

/**
 * Maps the errors the Coach package throws to the shared error codes (contracts/coach-internal.md section 2).
 * Anything else, including GraphUnavailableError, is returned unchanged so the global filter answers it.
 * Matching is by error name: the package is a separate build, so `instanceof` could miss a second copy of a class.
 */
export function toApiError(error: unknown): unknown {
  if (error instanceof AppError) return error;
  const name = (error as { name?: unknown } | null)?.name;
  if (name === 'EvidenceMissingError' || name === 'DecisionNotRecordedError') {
    return new UnavailableError('DECISION_NOT_RECORDED', 'The decision could not be recorded; no recommendation was made');
  }
  if (name === 'ProviderUnavailableError' || name === 'ProviderConfigError') {
    // The embeddings provider (goal stretch) is down or misconfigured: no recommendation without the goal it was asked for.
    return new UnavailableError('PROVIDER_UNAVAILABLE', 'The embeddings provider is unavailable; the goal could not be resolved');
  }
  if (name === 'LearnerNotFoundError') {
    return new AppError('INTERNAL', 'The learner has no graph node', 500);
  }
  return error;
}
