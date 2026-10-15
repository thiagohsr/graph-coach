import type { ErrorCode } from '@coach/types';
import { isApiClientError } from '~/lib/api/errors';

/** Messages by code (contracts/ui-screens.md "Service errors"). */
const MESSAGES: Partial<Record<ErrorCode, string>> = {
  GRAPH_UNAVAILABLE: 'The knowledge graph is unavailable.',
  SQL_UNAVAILABLE: 'Accounts are unavailable.',
  PROVIDER_UNAVAILABLE: 'The language or embedding service is unavailable.',
  DECISION_NOT_RECORDED: 'The Coach could not store its evidence, so no recommendation was made.',
  CREATION_PAUSED: 'Puzzle creation is paused. Try again later.',
};

export const SERVICE_UNAVAILABLE = 'Service unavailable.';

export interface ErrorPresentation {
  kind: 'forbidden' | 'not-found' | 'contract' | 'service';
  message: string;
}

/** Maps any thrown value to how a screen presents it (plan.md "Error Handling"). */
export function describeError(error: unknown): ErrorPresentation {
  if (!isApiClientError(error)) return { kind: 'service', message: SERVICE_UNAVAILABLE };
  if (error.code === 'CONTRACT_MISMATCH') return { kind: 'contract', message: error.message };
  if (error.status === 403 && error.code === 'FORBIDDEN') return { kind: 'forbidden', message: 'You do not have access to this page.' };
  if (error.status === 404) return { kind: 'not-found', message: 'Not found.' };
  const byCode = MESSAGES[error.code as ErrorCode];
  if (byCode) return { kind: 'service', message: byCode };
  if (error.status >= 500 || error.status === 0) return { kind: 'service', message: SERVICE_UNAVAILABLE };
  return { kind: 'service', message: error.message || SERVICE_UNAVAILABLE };
}

/** "HH:MM" in the viewer's locale. */
export function formatClock(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
