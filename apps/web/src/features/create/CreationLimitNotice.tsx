import type { ReactNode } from 'react';
import { formatClock } from '~/components/states/error-messages';
import { Alert } from '~/components/ui/alert';
import type { ApiClientError } from '~/lib/api/errors';

const WINDOW_TEXT: Record<string, string> = { hour: 'this hour', month: 'this month' };
const KIND_TEXT: Record<string, string> = { upload: 'uploads', prompt: 'prompt puzzles' };

/** 429 `CREATION_LIMIT_REACHED`: which limit, for which kind, when it resets, and the redeem form when a code can help. */
export function CreationLimitNotice({ error, redeem }: { error: ApiClientError; redeem: ReactNode }) {
  const window = error.window ? WINDOW_TEXT[error.window] : undefined;
  const kind = error.kind ? KIND_TEXT[error.kind] : undefined;
  const reset = error.retryAt
    ? error.window === 'month'
      ? `Resets on ${error.retryAt.toLocaleDateString()}.`
      : `You can try again at ${formatClock(error.retryAt)}.`
    : null;
  return (
    <div className="flex flex-col gap-3">
      <Alert variant="warning" aria-live="polite">
        <p>{`You have reached the limit for ${kind ?? 'creations'}${window ? ` ${window}` : ''}.`}</p>
        {reset && <p className="mt-1">{reset}</p>}
      </Alert>
      {error.canRedeemCode === true && redeem}
    </div>
  );
}
