import { Alert } from '~/components/ui/alert';
import { formatClock } from './error-messages';

const WINDOW_TEXT: Record<string, string> = { hour: 'this hour', month: 'this month' };

/** A 429: the message, which window was hit when known, and when to try again. */
export function RateLimitNotice({ message, window, retryAt }: { message: string; window?: string | undefined; retryAt?: Date | null | undefined }) {
  const windowText = window ? WINDOW_TEXT[window] : undefined;
  return (
    <Alert variant="destructive" aria-live="polite">
      <p>
        {message}
        {windowText ? ` (${windowText})` : ''}
      </p>
      {retryAt && <p className="mt-1">You can try again at {formatClock(retryAt)}.</p>}
    </Alert>
  );
}
