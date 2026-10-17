import { createHmac } from 'node:crypto';
import type { ZodType, z } from 'zod';
import {
  failure,
  type AuthFailure,
  type ConfirmForgotResult,
  type ConfirmSignUpResult,
  type ForgotResult,
  type ResendResult,
  type SignInResult,
  type SignUpResult,
} from '~/lib/auth/auth-errors';
import {
  ConfirmForgotInputSchema,
  ConfirmSignUpInputSchema,
  ForgotInputSchema,
  ResendInputSchema,
  SignInInputSchema,
  SignUpInputSchema,
  fieldErrors,
  type ConfirmForgotInput,
  type ConfirmSignUpInput,
  type ForgotInput,
  type ResendInput,
  type SignInInput,
  type SignUpInput,
} from '~/lib/auth/auth-forms.schema';
import { safeRedirect } from '~/lib/auth/guards';
import { exceptionName, mapCognitoError } from './auth-errors';
import { LIMITS, type Rule, type SlidingWindowLimiter } from './auth-limits';
import type { CognitoPort, FormsFn } from './cognito-port';
import { callMe } from './oidc';
import {
  clearSession,
  seal,
  sessionCookieNames,
  unseal,
  writeSession,
  type Session,
} from './session-cookie';
import { originAllowed } from './trust';

// The e-mail sign-in service behind the auth server functions (contracts/server-functions.md). Pure over
// `AuthFormsDeps`: no environment, no framework. Expected failures are returned, never thrown. Passwords and
// codes are only ever handed to the port: they are not stored, logged, or put in any key or URL.

export interface AuthFormsDeps {
  /** `real` talks to Cognito; `fake` is the development-only preview (no session is created). */
  mode: 'real' | 'fake';
  port: CognitoPort;
  limits: SlidingWindowLimiter;
  /** The session secret: seals the form timestamp and keys the e-mail and address hashes. */
  secret: string;
  secure: boolean;
  apiUrl: string;
  publicOrigin: string;
  /** The request's `Origin` header. */
  origin: string | null;
  /** The request's cookies (to expire stale session chunks). */
  cookies: Record<string, string>;
  /** Client address list as trusted by the proxy rules; the first value is used. */
  forwardedFor: string | undefined;
  fetch: typeof fetch;
  now?: () => number;
  /** Receives `Set-Cookie` values. */
  setCookies: (cookies: string[]) => void;
  /** One line per call: `{ fn, outcome, emailKey, ipKey, ms }` only. */
  log?: (entry: Record<string, string | number>) => void;
  limitsDisabled?: boolean;
}

export const FORM_PURPOSE = 'auth-form';
export const MIN_FORM_AGE_MS = 2_000;
export const MAX_FORM_AGE_MS = 24 * 3_600_000;
export const RESEND_COOLDOWN_SECONDS = 30;

type Guarded = { guard?: { website: string; startedAt: string } | undefined };

export function createAuthForms(deps: AuthFormsDeps) {
  const now = deps.now ?? Date.now;
  const ip = (deps.forwardedFor?.split(',')[0] ?? '').trim() || 'unknown';

  const hmac = (label: string, value: string) =>
    createHmac('sha256', deps.secret).update(`${label}:${value}`).digest('hex');
  const emailHash = (email: string) => hmac('email', email);
  const ipHash = hmac('ip', ip);
  const short = (h: string) => h.slice(0, 12);

  /** `AUTH_RATE_LIMITED` for the first rule that is full, else null. */
  function blocked(checks: [key: string, rule: Rule][]): AuthFailure | null {
    if (deps.limitsDisabled) return null;
    for (const [key, rule] of checks) {
      const v = deps.limits.peek(key, rule.max, rule.windowMs);
      if (!v.allowed)
        return failure('AUTH_RATE_LIMITED', { retryAfterSeconds: v.retryAfterSeconds });
    }
    return null;
  }
  /** Records one hit on each; returns the first full one (nothing recorded when any is full). */
  function take(checks: [key: string, rule: Rule][]): AuthFailure | null {
    const full = blocked(checks);
    if (full) return full;
    if (!deps.limitsDisabled)
      for (const [key, rule] of checks) deps.limits.record(key, rule.windowMs);
    return null;
  }
  const hit = (key: string, rule: Rule) => {
    if (!deps.limitsDisabled) deps.limits.record(key, rule.windowMs);
  };

  function guardOk(guard: Guarded['guard']): boolean {
    if (!guard || guard.website !== '') return false;
    const payload = unseal<{ t?: number }>(guard.startedAt, deps.secret, FORM_PURPOSE);
    if (!payload || typeof payload.t !== 'number') return false;
    const age = now() - payload.t;
    return age >= MIN_FORM_AGE_MS && age <= MAX_FORM_AGE_MS;
  }

  /** Mode gate, origin, validation, error handling, and the log line, shared by every function. */
  async function run<S extends ZodType, R>(
    fn: string,
    schema: S,
    raw: unknown,
    body: (input: z.output<S>, emailKey: string) => Promise<R>,
  ): Promise<R | AuthFailure> {
    const started = now();
    let outcome = 'ok';
    let emailKey = '-';
    try {
      // A missing Origin is refused here (stricter than the proxy rule): browsers always send it on POST.
      if (deps.origin === null || !originAllowed(deps.origin, deps.publicOrigin)) {
        outcome = 'AUTH_FORBIDDEN_ORIGIN';
        return failure('AUTH_FORBIDDEN_ORIGIN');
      }
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        outcome = 'AUTH_VALIDATION_FAILED';
        return failure('AUTH_VALIDATION_FAILED', { fields: fieldErrors(parsed.error) });
      }
      const email = (parsed.data as { email?: string }).email;
      if (email) emailKey = emailHash(email);
      const result = await body(parsed.data, emailKey);
      const code = (result as { ok?: boolean; code?: string } | null)?.code;
      if ((result as { ok?: boolean } | null)?.ok === false && code) outcome = code;
      return result;
    } catch (error) {
      // A thrown provider error that no function handled itself: report and log the exception name only.
      outcome = `cognito:${exceptionName(error)}`;
      return failure('AUTH_UNAVAILABLE');
    } finally {
      deps.log?.({
        fn,
        outcome,
        emailKey: short(emailKey),
        ipKey: short(ipHash),
        ms: now() - started,
      });
    }
  }

  const fail = (fn: FormsFn, error: unknown): AuthFailure | null => {
    const mapped = mapCognitoError(fn, error);
    return mapped.ok ? null : mapped;
  };

  // --- Sign in ------------------------------------------------------------------------------------------

  async function signInCore(
    email: string,
    password: string,
    redirect: string | undefined,
    ek: string,
  ): Promise<SignInResult> {
    const pairKey = `si:pair:${ek}:${ipHash}`;
    const ipKey = `si:ip:${ipHash}`;
    const emailKey = `si:email:${ek}`;
    const full = blocked([
      [pairKey, LIMITS.signInPairFailures],
      [ipKey, LIMITS.signInIpFailures],
      [emailKey, LIMITS.signInEmailFailures],
    ]);
    if (full) return full;

    let outcome;
    try {
      outcome = await deps.port.signIn({ email, password });
    } catch (error) {
      const name = exceptionName(error);
      if (name === 'NotAuthorizedException' || name === 'UserNotFoundException') {
        hit(pairKey, LIMITS.signInPairFailures);
        hit(ipKey, LIMITS.signInIpFailures);
        hit(emailKey, LIMITS.signInEmailFailures);
      }
      const f = fail('signIn', error);
      if (!f) return failure('AUTH_INVALID_CREDENTIALS');
      return f;
    }
    // Challenges (MFA, forced new password) are not enabled in this pool.
    if (outcome.kind !== 'tokens') return failure('AUTH_UNAVAILABLE');

    const next = safeRedirect(redirect);
    if (deps.mode === 'fake') {
      deps.limits.reset(pairKey);
      return { ok: true, next };
    }

    const me = await callMe(
      { accessToken: outcome.accessToken, idToken: outcome.idToken, expiresIn: outcome.expiresIn },
      { apiUrl: deps.apiUrl, fetch: deps.fetch, forwardedFor: deps.forwardedFor },
    );
    const existing = sessionCookieNames(deps.cookies);
    const cookieOptions = { secret: deps.secret, secure: deps.secure };
    if (me === 'ok' || me === 'blocked') {
      const session: Session = {
        accessToken: outcome.accessToken,
        refreshToken: outcome.refreshToken,
        expiresAt: now() + outcome.expiresIn * 1000,
      };
      deps.setCookies(writeSession(session, { ...cookieOptions, existing, now: now() }));
      deps.limits.reset(pairKey);
      return { ok: true, next: me === 'blocked' ? '/blocked' : next };
    }
    deps.setCookies(clearSession({ ...cookieOptions, existing }));
    return failure('AUTH_ACCOUNT_SETUP_FAILED');
  }

  // --- Public functions ---------------------------------------------------------------------------------

  return {
    /** A timestamp token for the bot guard; nothing else. */
    start(): { startedAt: string } {
      return { startedAt: seal({ t: now() }, deps.secret, FORM_PURPOSE) };
    },

    signUp(raw: SignUpInput): Promise<SignUpResult> {
      return run('signUp', SignUpInputSchema, raw, async (i, ek) => {
        if (!guardOk(i.guard)) {
          // A bot or a hurried form: the normal success shape, no provider call.
          return {
            ok: true as const,
            next: 'verifyEmail' as const,
            destinationHint: hint(i.email),
          };
        }
        const full = take([
          [`su:ip:${ipHash}`, LIMITS.signUpIp],
          [`su:email:${ek}`, LIMITS.signUpEmail],
        ]);
        if (full) return full;
        try {
          const out = await deps.port.signUp({ email: i.email, password: i.password });
          // The pool must require verification; a confirmed user here is a configuration error.
          if (out.confirmed) return failure('AUTH_UNAVAILABLE');
          return {
            ok: true as const,
            next: 'verifyEmail' as const,
            destinationHint: out.destination ?? hint(i.email),
          };
        } catch (error) {
          return fail('signUp', error) ?? failure('AUTH_UNAVAILABLE');
        }
      });
    },

    confirmSignUp(raw: ConfirmSignUpInput): Promise<ConfirmSignUpResult> {
      return run('confirmSignUp', ConfirmSignUpInputSchema, raw, async (i, ek) => {
        const pairKey = `cs:pair:${ek}:${ipHash}`;
        const full =
          take([[`cs:ip:${ipHash}`, LIMITS.codeIp]]) ??
          blocked([[pairKey, LIMITS.codePairFailures]]);
        if (full) return full;
        try {
          await deps.port.confirmSignUp({ email: i.email, code: i.code });
        } catch (error) {
          const name = exceptionName(error);
          if (
            name === 'CodeMismatchException' ||
            name === 'ExpiredCodeException' ||
            name === 'NotAuthorizedException' ||
            name === 'UserNotFoundException'
          )
            hit(pairKey, LIMITS.codePairFailures);
          return fail('confirmSignUp', error) ?? failure('AUTH_UNAVAILABLE');
        }
        deps.limits.reset(pairKey);
        if (!i.password)
          return { ok: true as const, verified: true as const, signedIn: false as const };
        // Verified: sign in with the password the card still holds. A failure here is not an error.
        const signedIn = await signInCore(i.email, i.password, i.redirect, ek).catch(() => null);
        if (signedIn?.ok)
          return {
            ok: true as const,
            verified: true as const,
            signedIn: true as const,
            next: signedIn.next,
          };
        return {
          ok: true as const,
          verified: true as const,
          signedIn: false as const,
          notice: 'verifiedSignInFailed' as const,
        };
      });
    },

    resendCode(raw: ResendInput): Promise<ResendResult> {
      return run('resendCode', ResendInputSchema, raw, async (i, ek) => {
        const full = take([
          [`rs:ip:${ipHash}`, LIMITS.resendIp],
          [`rs:burst:${ek}`, LIMITS.resendEmailBurst],
          [`rs:hour:${ek}`, LIMITS.resendEmailHour],
        ]);
        if (full) return full;
        try {
          await deps.port.resendCode({ email: i.email });
        } catch (error) {
          const f = fail('resendCode', error); // null = success-looking
          if (f) return f;
        }
        return { ok: true as const, cooldownSeconds: RESEND_COOLDOWN_SECONDS };
      });
    },

    signIn(raw: SignInInput): Promise<SignInResult> {
      return run('signIn', SignInInputSchema, raw, (i, ek) =>
        signInCore(i.email, i.password, i.redirect, ek),
      );
    },

    forgotPassword(raw: ForgotInput): Promise<ForgotResult> {
      return run('forgotPassword', ForgotInputSchema, raw, async (i, ek) => {
        if (!guardOk(i.guard)) return { ok: true as const, next: 'resetPassword' as const };
        const full = take([
          [`fp:ip:${ipHash}`, LIMITS.forgotIp],
          [`fp:email:${ek}`, LIMITS.forgotEmail],
        ]);
        if (full) return full;
        try {
          await deps.port.forgotPassword({ email: i.email });
        } catch (error) {
          const f = fail('forgotPassword', error);
          if (f) return f;
        }
        return { ok: true as const, next: 'resetPassword' as const };
      });
    },

    confirmForgotPassword(raw: ConfirmForgotInput): Promise<ConfirmForgotResult> {
      return run('confirmForgotPassword', ConfirmForgotInputSchema, raw, async (i, ek) => {
        const pairKey = `cf:pair:${ek}:${ipHash}`;
        const full =
          take([[`cf:ip:${ipHash}`, LIMITS.codeIp]]) ??
          blocked([[pairKey, LIMITS.codePairFailures]]);
        if (full) return full;
        try {
          await deps.port.confirmForgotPassword({
            email: i.email,
            code: i.code,
            newPassword: i.newPassword,
          });
        } catch (error) {
          const name = exceptionName(error);
          if (
            name === 'CodeMismatchException' ||
            name === 'ExpiredCodeException' ||
            name === 'NotAuthorizedException' ||
            name === 'UserNotFoundException'
          )
            hit(pairKey, LIMITS.codePairFailures);
          return fail('confirmForgotPassword', error) ?? failure('AUTH_UNAVAILABLE');
        }
        deps.limits.reset(pairKey);
        return { ok: true as const, next: 'signIn' as const };
      });
    },
  };

  /** A masked address made from what was typed (used when the provider's own hint is not available). */
  function hint(email: string): string {
    const [u = '', d = ''] = email.split('@');
    const dot = d.lastIndexOf('.');
    return `${u.slice(0, 1)}***@${d.slice(0, 1)}***${dot > 0 ? d.slice(dot) : ''}`;
  }
}

export type AuthForms = ReturnType<typeof createAuthForms>;
