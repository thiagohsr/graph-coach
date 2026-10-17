// Codes and fixed messages of the e-mail sign-in forms. Shared by the server (which returns them) and the
// card (which shows its own validation messages). Pure: no Node or browser APIs. None of the messages
// includes an e-mail address, a code, a password, or text from the identity provider.

export const AUTH_MESSAGES = {
  AUTH_INVALID_CREDENTIALS: "That e-mail and password don't match.",
  AUTH_EMAIL_NOT_VERIFIED:
    "Your e-mail isn't verified yet. Enter the code we sent, or send a new one.",
  AUTH_ACCOUNT_EXISTS: 'An account with this e-mail already exists.',
  AUTH_WEAK_PASSWORD: "That password doesn't meet the rules above.",
  AUTH_CODE_MISMATCH: "That code isn't right. Check it and try again.",
  AUTH_CODE_EXPIRED: 'That code has expired. Send a new one.',
  AUTH_ALREADY_VERIFIED: 'This address is already verified. Sign in.',
  AUTH_PASSWORD_RESET_REQUIRED: 'You need to choose a new password.',
  AUTH_SESSION_EXPIRED: 'That took too long. Sign in again.',
  AUTH_RATE_LIMITED: 'Too many attempts. Try again in a moment.',
  AUTH_EMAIL_BUDGET: "We can't send more codes today. Try again tomorrow, or continue with Google.",
  AUTH_DELIVERY_FAILED: "We couldn't send the code. Check the address and try again.",
  AUTH_VALIDATION_FAILED: 'Check the highlighted fields.',
  AUTH_ACCOUNT_SETUP_FAILED: 'We could not set up your account. Please try again.',
  AUTH_FORBIDDEN_ORIGIN:
    'This request came from somewhere else and was refused. Reload the page and try again.',
  AUTH_NOT_ENABLED: "E-mail sign-in isn't available here.",
  AUTH_UNAVAILABLE: "We couldn't reach the sign-in service. Try again in a moment.",
} as const;

export type AuthErrorCode = keyof typeof AUTH_MESSAGES;

export type AuthField = 'email' | 'password' | 'newPassword' | 'code';

/** "Too many attempts. Try again in N seconds." (minutes above 90 s). */
export function rateLimitedMessage(retryAfterSeconds: number): string {
  const s = Math.max(1, Math.ceil(retryAfterSeconds));
  if (s <= 90) return `Too many attempts. Try again in ${s} ${s === 1 ? 'second' : 'seconds'}.`;
  const m = Math.ceil(s / 60);
  return `Too many attempts. Try again in ${m} minutes.`;
}

export interface AuthFailure {
  ok: false;
  code: AuthErrorCode;
  message: string;
  field?: AuthField;
  fields?: Partial<Record<AuthField, string>>;
  retryAfterSeconds?: number;
}

export function failure(
  code: AuthErrorCode,
  extra: {
    field?: AuthField;
    fields?: Partial<Record<AuthField, string>>;
    retryAfterSeconds?: number;
  } = {},
): AuthFailure {
  const out: AuthFailure = {
    ok: false,
    code,
    message:
      code === 'AUTH_RATE_LIMITED' && extra.retryAfterSeconds
        ? rateLimitedMessage(extra.retryAfterSeconds)
        : AUTH_MESSAGES[code],
  };
  if (extra.field) out.field = extra.field;
  if (extra.fields) out.fields = extra.fields;
  if (extra.retryAfterSeconds) out.retryAfterSeconds = extra.retryAfterSeconds;
  return out;
}

// --- Results of the server functions ---------------------------------------------------------------------

export interface AuthGuard {
  /** Honeypot: must stay empty. */
  website: string;
  /** Sealed timestamp from `getAuthFormStartFn`. */
  startedAt: string;
}

export type SignUpResult =
  { ok: true; next: 'verifyEmail'; destinationHint?: string } | AuthFailure;
export type ConfirmSignUpResult =
  | { ok: true; verified: true; signedIn: true; next: string }
  | { ok: true; verified: true; signedIn: false; notice?: 'verifiedSignInFailed' }
  | AuthFailure;
export type ResendResult = { ok: true; cooldownSeconds: number } | AuthFailure;
export type SignInResult = { ok: true; next: string } | AuthFailure;
export type ForgotResult = { ok: true; next: 'resetPassword' } | AuthFailure;
export type ConfirmForgotResult = { ok: true; next: 'signIn' } | AuthFailure;
