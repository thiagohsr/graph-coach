import { useEffect, useRef } from 'react';
import { buttonVariants } from '~/components/ui/button';
import { Button } from '~/components/ui/button';
import { cn } from '~/lib/utils';

export type LoginError = 'state' | 'provider' | 'exchange' | 'unverified' | 'account';

export const LOGIN_ERROR_VALUES: readonly LoginError[] = ['state', 'provider', 'exchange', 'unverified', 'account'];

/** Fixed messages: the provider's own error text is never shown (contracts/web-server.md §3.3). */
export const LOGIN_ERROR_MESSAGES: Record<LoginError, string> = {
  state: 'Sign-in could not be completed. Please try again.',
  provider: 'Sign-in was cancelled or refused.',
  exchange: 'Sign-in failed. Please try again in a moment.',
  unverified:
    'Your e-mail address must be verified before you can use the site. Verify it with your sign-in provider, then sign in again.',
  account: 'We could not set up your account. Please try again.',
};

export function parseLoginError(value: unknown): LoginError | undefined {
  return LOGIN_ERROR_VALUES.find((v) => v === value);
}

export function LoginErrorAlert({ error }: { error: LoginError }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [error]);
  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={-1}
      className="rounded-lg border border-destructive/60 px-4 py-3 text-sm text-destructive outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {LOGIN_ERROR_MESSAGES[error]}
    </div>
  );
}

/** Provider mode: two plain links to the web server's sign-in route. No credential field anywhere. */
export function LoginOptions({ redirect, error, onSignOut }: { redirect: string; error?: LoginError | undefined; onSignOut: () => void }) {
  const query = (provider: 'google' | 'email') => `/auth/login?provider=${provider}&redirect=${encodeURIComponent(redirect)}`;
  const unverified = error === 'unverified';

  return (
    <section className="mx-auto flex max-w-md flex-col gap-5 p-6">
      <h1 className="text-2xl font-semibold" tabIndex={-1}>
        Sign in
      </h1>
      {error && <LoginErrorAlert error={error} />}
      {unverified ? (
        <Button type="button" variant="outline" onClick={onSignOut}>
          Sign out
        </Button>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">Your first sign-in creates your account.</p>
          <div className="flex flex-col gap-3">
            <a href={query('google')} className={cn(buttonVariants({ size: 'lg' }), 'w-full')}>
              Continue with Google
            </a>
            <a href={query('email')} className={cn(buttonVariants({ size: 'lg', variant: 'outline' }), 'w-full')}>
              Continue with e-mail
            </a>
          </div>
        </>
      )}
    </section>
  );
}
