import type { RedeemResult } from '@coach/types';
import { useForm } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { describeError } from '~/components/states/error-messages';
import { RateLimitNotice } from '~/components/states/RateLimitNotice';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { redeemCode } from '~/lib/api/account';
import { isApiClientError, type ApiClientError } from '~/lib/api/errors';
import { keys } from '~/lib/query/keys';

export const CODE_REFUSED_MESSAGE = 'That code cannot be used.';

/** What a redemption granted, one phrase per part that is non-zero or present. */
export function grantedLines(granted: RedeemResult): string[] {
  const lines: string[] = [];
  if (granted.sourceRuns > 0) lines.push(`+${granted.sourceRuns} ${granted.sourceRuns === 1 ? 'upload' : 'uploads'}`);
  if (granted.promptRuns > 0) lines.push(`+${granted.promptRuns} prompt ${granted.promptRuns === 1 ? 'puzzle' : 'puzzles'}`);
  if (granted.limitsLiftedUntil) {
    lines.push(`Hourly limit lifted until ${new Date(granted.limitsLiftedUntil).toLocaleString()}`);
  }
  return lines;
}

/** The redeem-code form of `/account` and `/sources/new`. Any refused code gets one message (FR-W30). */
export function RedeemCodeForm({
  onGranted,
  quiet = false,
}: {
  onGranted?: (granted: RedeemResult) => void;
  /** The parent shows what was granted (its own form may disappear once the allowance refreshes). */
  quiet?: boolean;
}) {
  const queryClient = useQueryClient();
  const uid = useId();
  const inputId = `redeem-code-${uid}`;
  const messageId = `redeem-code-message-${uid}`;
  const [granted, setGranted] = useState<RedeemResult | null>(null);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [empty, setEmpty] = useState(false);
  const [busy, setBusy] = useState(false);

  const form = useForm({
    defaultValues: { code: '' },
    onSubmit: async ({ value, formApi }) => {
      const code = value.code.trim();
      setGranted(null);
      setError(null);
      setEmpty(code === '');
      if (code === '') return;
      setBusy(true);
      try {
        const result = await redeemCode(code);
        setGranted(result);
        formApi.setFieldValue('code', '');
        void queryClient.invalidateQueries({ queryKey: keys.me.allowance });
        onGranted?.(result);
      } catch (caught) {
        if (isApiClientError(caught)) setError(caught);
        else throw caught;
      } finally {
        setBusy(false);
      }
    },
  });

  const refused = error?.code === 'CODE_INVALID';
  const fieldMessage = empty ? 'Enter a code.' : refused ? CODE_REFUSED_MESSAGE : null;

  return (
    <form
      className="flex flex-col gap-2"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <form.Field name="code">
        {(field) => (
          <div className="flex flex-col gap-1">
            <Label htmlFor={inputId}>Code</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id={inputId}
                className="max-w-64"
                autoComplete="off"
                maxLength={64}
                value={field.state.value}
                aria-invalid={fieldMessage ? true : undefined}
                aria-describedby={messageId}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
              <Button type="submit" disabled={busy}>
                {busy ? 'Redeeming…' : 'Redeem'}
              </Button>
            </div>
            <p id={messageId} className="text-sm text-destructive">
              {fieldMessage}
            </p>
          </div>
        )}
      </form.Field>

      {granted && !quiet && (
        <div role="status" className="rounded-md border border-success bg-success-soft p-3 text-sm">
          {grantedLines(granted).length > 0 ? (
            <ul className="list-none">
              {grantedLines(granted).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : (
            <p>The code was accepted.</p>
          )}
        </div>
      )}
      {error?.code === 'RATE_LIMITED' && <RateLimitNotice message={error.message} retryAt={error.retryAt} />}
      {error && !refused && error.code !== 'RATE_LIMITED' && (
        <Alert variant="destructive">
          <AlertDescription>{describeError(error).message}</AlertDescription>
        </Alert>
      )}
    </form>
  );
}
