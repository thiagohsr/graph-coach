import { useEffect, useRef } from 'react';

export type LoginError = 'state' | 'provider' | 'exchange' | 'unverified' | 'account';

export const LOGIN_ERROR_VALUES: readonly LoginError[] = [
  'state',
  'provider',
  'exchange',
  'unverified',
  'account',
];

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
      className="rounded-md border border-danger bg-danger-soft px-4 py-3 text-sm text-danger outline-none focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {LOGIN_ERROR_MESSAGES[error]}
    </div>
  );
}
