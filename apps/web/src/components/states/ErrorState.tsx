import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert';
import { Button } from '~/components/ui/button';
import { describeError } from './error-messages';

/** Presents a failed primary query: a message chosen by code, and Retry. */
export function ErrorState({ error, onRetry, title = 'Something went wrong' }: { error: unknown; onRetry?: () => void; title?: string }) {
  const { kind, message } = describeError(error);
  if (kind === 'contract') {
    return (
      <Alert variant="destructive">
        <AlertTitle>Unexpected response from the server</AlertTitle>
        <AlertDescription>{message}</AlertDescription>
        {onRetry && (
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRetry}>
            Retry
          </Button>
        )}
      </Alert>
    );
  }
  return (
    <Alert variant="destructive">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
      {onRetry && (
        <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRetry}>
          Retry
        </Button>
      )}
    </Alert>
  );
}
