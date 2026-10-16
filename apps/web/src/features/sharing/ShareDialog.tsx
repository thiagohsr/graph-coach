import type { ShareDto } from '@coach/types';
import { useForm } from '@tanstack/react-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { LiveRegion } from '~/components/a11y/LiveRegion';
import { ErrorState } from '~/components/states/ErrorState';
import { RateLimitNotice } from '~/components/states/RateLimitNotice';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '~/components/ui/dialog';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Skeleton } from '~/components/ui/skeleton';
import { deleteShare, putShare, sharesOptions } from '~/lib/api/sharing';
import { keys } from '~/lib/query/keys';
import {
  canOfferSource,
  checkShareAddress,
  mapShareError,
  sortShares,
  type ShareErrorView,
} from './share-state';

export interface ShareDialogProps {
  puzzle: { id: string; name: string; sourceShared: boolean };
  /** The signed-in user's own address, for the "you already own this puzzle" pre-check. */
  ownEmail: string;
}

type Pending = { kind: 'add' } | { kind: 'toggle' | 'revoke'; userId: string } | null;

/** The share dialog of `/puzzles` (contracts/ui-screens.md "Share dialog"). Rows change only from server responses. */
export function ShareDialog({ puzzle, ownEmail }: ShareDialogProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const shares = useQuery({ ...sharesOptions(puzzle.id), enabled: open });
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<ShareErrorView | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState({ seq: 0, text: '' });
  const emailRef = useRef<HTMLInputElement>(null);
  const offerSource = canOfferSource(puzzle);

  const announce = (text: string) => setAnnouncement((a) => ({ seq: a.seq + 1, text }));
  const list = sortShares(shares.data ?? []);

  function afterChange() {
    void queryClient.invalidateQueries({ queryKey: keys.puzzles.list });
    void queryClient.invalidateQueries({ queryKey: keys.sources.list });
  }

  function fail(caught: unknown, action: 'add' | 'toggle' | 'revoke', userId?: string) {
    const view = mapShareError(caught, action, userId);
    setError(view);
    if (view.refreshPuzzles) void queryClient.invalidateQueries({ queryKey: keys.puzzles.list });
  }

  function upsert(row: ShareDto) {
    queryClient.setQueryData<ShareDto[]>(keys.puzzles.shares(puzzle.id), (old) => [
      ...(old ?? []).filter((s) => s.userId !== row.userId),
      row,
    ]);
  }

  const form = useForm({
    defaultValues: { email: '', withSource: false },
    onSubmit: async ({ value, formApi }) => {
      if (pending) return;
      setError(null);
      const check = checkShareAddress({ email: value.email, ownEmail, shares: shares.data ?? [] });
      if (!check.ok) {
        setError({ target: 'email', message: check.message });
        return;
      }
      setPending({ kind: 'add' });
      try {
        const row = await putShare(puzzle.id, {
          email: check.email,
          withSource: offerSource && value.withSource,
        });
        upsert(row);
        afterChange();
        formApi.setFieldValue('email', '');
        announce(`Shared with ${row.name}.`);
      } catch (caught) {
        fail(caught, 'add');
      } finally {
        setPending(null);
      }
    },
  });

  async function toggle(row: ShareDto, withSource: boolean) {
    if (pending) return;
    setError(null);
    setPending({ kind: 'toggle', userId: row.userId });
    try {
      const updated = await putShare(puzzle.id, { email: row.email, withSource });
      upsert(updated);
      afterChange();
      announce(`${updated.name}: source ${updated.withSource ? 'shared' : 'not shared'}.`);
    } catch (caught) {
      fail(caught, 'toggle', row.userId);
    } finally {
      setPending(null);
    }
  }

  async function revoke(row: ShareDto) {
    if (pending) return;
    setError(null);
    setPending({ kind: 'revoke', userId: row.userId });
    try {
      await deleteShare(puzzle.id, row.userId);
      queryClient.setQueryData<ShareDto[]>(keys.puzzles.shares(puzzle.id), (old) =>
        (old ?? []).filter((s) => s.userId !== row.userId),
      );
      afterChange();
      setConfirmRevoke(null);
      announce(`Revoked ${row.name}.`);
    } catch (caught) {
      setConfirmRevoke(null);
      fail(caught, 'revoke', row.userId);
    } finally {
      setPending(null);
    }
  }

  const emailError = error?.target === 'email' ? error : null;
  const sourceError = error?.target === 'withSource' ? error : null;
  const formError = error?.target === 'form' ? error : null;
  const adding = pending?.kind === 'add';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setError(null);
          setConfirmRevoke(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" aria-label={`Share ${puzzle.name}`}>
          Share
        </Button>
      </DialogTrigger>
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          emailRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{`Share ${puzzle.name}`}</DialogTitle>
          <DialogDescription>
            Enter the e-mail address of someone who has signed in at least once.
          </DialogDescription>
        </DialogHeader>
        <LiveRegion message={announcement.text} seq={announcement.seq} />

        <form
          className="flex flex-col gap-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <form.Field name="email">
            {(field) => (
              <div className="flex flex-col gap-1">
                <Label htmlFor="share-email">E-mail address</Label>
                <Input
                  id="share-email"
                  ref={emailRef}
                  type="email"
                  autoComplete="off"
                  value={field.state.value}
                  aria-invalid={emailError ? true : undefined}
                  aria-describedby={emailError ? 'share-email-error' : undefined}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                {emailError && (
                  <p id="share-email-error" className="text-sm text-destructive">
                    {emailError.message}
                  </p>
                )}
              </div>
            )}
          </form.Field>

          <form.Field name="withSource">
            {(field) => (
              <div className="flex flex-col gap-1">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={offerSource && field.state.value}
                    disabled={!offerSource}
                    aria-describedby={
                      !offerSource
                        ? 'share-source-note'
                        : sourceError
                          ? 'share-source-error'
                          : undefined
                    }
                    onChange={(e) => field.handleChange(e.target.checked)}
                  />
                  Share the source too
                </label>
                {!offerSource && (
                  <p id="share-source-note" className="text-sm text-muted-foreground">
                    This puzzle has no source
                  </p>
                )}
                {sourceError && (
                  <p id="share-source-error" className="text-sm text-destructive">
                    {sourceError.message}
                  </p>
                )}
              </div>
            )}
          </form.Field>

          {formError &&
            (formError.retryAt ? (
              <RateLimitNotice message={formError.message} retryAt={formError.retryAt} />
            ) : (
              <Alert variant="destructive">
                <AlertDescription>{formError.message}</AlertDescription>
              </Alert>
            ))}

          <div>
            <Button type="submit" disabled={shares.isPending || shares.isError || pending !== null}>
              {adding ? 'Saving…' : 'Share'}
            </Button>
          </div>
        </form>

        <section aria-labelledby="share-list-heading" className="flex flex-col gap-2">
          <h3 id="share-list-heading" className="text-sm font-semibold">
            Shared with
          </h3>
          {shares.isPending && (
            <div
              aria-busy="true"
              role="group"
              aria-label="Loading shares"
              className="flex flex-col gap-2"
            >
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          )}
          {shares.isError && (
            <ErrorState error={shares.error} onRetry={() => void shares.refetch()} />
          )}
          {shares.isSuccess && list.length === 0 && (
            <p className="text-sm text-muted-foreground">Not shared with anyone yet.</p>
          )}
          {shares.isSuccess && list.length > 0 && (
            <ul className="flex flex-col gap-2">
              {list.map((row) => {
                const busy =
                  pending !== null && 'userId' in pending && pending.userId === row.userId;
                const rowError =
                  error && typeof error.target === 'object' && error.target.row === row.userId
                    ? error
                    : null;
                return (
                  <li key={row.userId} className="flex flex-col gap-2 rounded-md border p-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium break-words">{row.name}</span>
                      <span className="text-sm break-all text-muted-foreground">{row.email}</span>
                      <span className="text-sm text-muted-foreground">
                        <time dateTime={row.sharedAt}>
                          {new Date(row.sharedAt).toLocaleDateString()}
                        </time>
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="size-4"
                          checked={row.withSource}
                          disabled={!offerSource || pending !== null}
                          aria-label={`Share the source with ${row.name}`}
                          onChange={(e) => void toggle(row, e.target.checked)}
                        />
                        <span aria-hidden="true">Share the source too</span>
                      </label>
                      {confirmRevoke === row.userId ? null : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={pending !== null}
                          aria-label={`Revoke ${row.name}`}
                          onClick={() => setConfirmRevoke(row.userId)}
                        >
                          {busy && pending?.kind === 'revoke' ? 'Revoking…' : 'Revoke'}
                        </Button>
                      )}
                      {busy && pending?.kind === 'toggle' && (
                        <span className="text-sm">Saving…</span>
                      )}
                    </div>
                    {confirmRevoke === row.userId && (
                      <div
                        className="flex flex-col gap-2"
                        role="group"
                        aria-label={`Confirm revoking ${row.name}`}
                      >
                        <p className="text-sm">{`${row.name} will lose the puzzle and its source at once.`}</p>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            disabled={pending !== null}
                            aria-label={`Confirm revoke ${row.name}`}
                            onClick={() => void revoke(row)}
                          >
                            {busy ? 'Revoking…' : 'Revoke'}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={pending !== null}
                            onClick={() => setConfirmRevoke(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                    {rowError && (
                      <p className="text-sm text-destructive" role="alert">
                        {rowError.message}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}
