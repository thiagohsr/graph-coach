import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { describeError } from '~/components/states/error-messages';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { isApiClientError } from '~/lib/api/errors';
import { setVisibility } from '~/lib/api/sharing';
import { keys } from '~/lib/query/keys';
import { GONE_MESSAGE, NOT_PUBLISHED_MESSAGE } from './share-state';

export interface VisibilityButtonProps {
  puzzle: { id: string; name: string; visibility: 'private' | 'public' };
}

/** "Make public" / "Make private" with a confirm dialog; failures show an inline alert on the card. */
export function VisibilityButton({ puzzle }: VisibilityButtonProps) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = puzzle.visibility === 'public' ? 'private' : 'public';
  const label = target === 'public' ? 'Make public' : 'Make private';

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await setVisibility(puzzle.id, target);
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: keys.puzzles.list });
    } catch (caught) {
      setConfirming(false);
      if (isApiClientError(caught) && caught.status === 404) {
        setError(GONE_MESSAGE);
        void queryClient.invalidateQueries({ queryKey: keys.puzzles.list });
      } else if (isApiClientError(caught) && caught.status === 403 && caught.code === 'FORBIDDEN') {
        setError(caught.message); // the server's message (the role is too low), not the page-level wording
      } else if (isApiClientError(caught) && caught.status === 409) {
        setError(NOT_PUBLISHED_MESSAGE);
      } else {
        setError(describeError(caught).message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" aria-label={`${label} ${puzzle.name}`} onClick={() => setConfirming(true)}>
        {label}
      </Button>
      {error && (
        <Alert variant="destructive" className="basis-full">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Dialog open={confirming} onOpenChange={(open) => !busy && setConfirming(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{`${label}: ${puzzle.name}`}</DialogTitle>
            <DialogDescription>
              {target === 'public'
                ? 'Everyone will be able to find and play this puzzle. The source is never made public.'
                : 'Only you and the people you shared it with will see this puzzle. The source is never made public.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={busy} onClick={() => void confirm()}>
              {busy ? 'Saving…' : label}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
