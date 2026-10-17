import { CheckCircle2, CircleAlert, Info, Loader2, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useId, useReducer, useRef, useState, type ReactNode } from 'react';
import { LiveRegion } from '~/components/a11y/LiveRegion';
import { documentTitle } from '~/components/a11y/RouteFocus';
import { Alert } from '~/components/ui/alert';
import { Button } from '~/components/ui/button';
import type { AuthApi } from '~/lib/auth/auth-forms.functions';
import { type AuthFailure, type AuthField, AUTH_MESSAGES } from '~/lib/auth/auth-errors';
import {
  CodeSchema,
  ConfirmForgotInputSchema,
  EmailSchema,
  NewPasswordSchema,
  SignInPasswordSchema,
  fieldErrors as zodFieldErrors,
} from '~/lib/auth/auth-forms.schema';
import { cn } from '~/lib/utils';
import { CodeField, EmailField, PasswordField } from './auth-card/fields';
import { LoginErrorAlert, type LoginError } from './login-error';
import {
  MODE_TITLES,
  initialState,
  reducer,
  type AuthMode,
  type CardNotice,
  type NoticeKind,
} from './use-auth-card';

export interface AuthCardProps {
  initialMode: 'signIn' | 'signUp';
  /** Already sanitised same-site path. */
  redirect: string;
  /** From `?error=` on /login. */
  error?: LoginError | undefined;
  headingLevel: 'h1' | 'h2';
  api: AuthApi;
  /** Full navigation to the path the server returned. */
  onSignedIn: (to: string) => void;
  onSignOut?: (() => void) | undefined;
  /** When true the card also owns the document title (the /login page). */
  ownsTitle?: boolean;
}

const COOLDOWN_SECONDS = 30;
const link =
  'rounded-sm text-primary underline underline-offset-4 outline-none hover:text-primary-hover focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring';

function GoogleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="size-[18px]">
      <path
        fill="#EA4335"
        d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"
      />
      <path
        fill="#FBBC05"
        d="M10.5 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"
      />
    </svg>
  );
}

const NOTICE_ICON: Record<NoticeKind | 'danger', typeof Info> = {
  success: CheckCircle2,
  warning: TriangleAlert,
  info: Info,
  danger: CircleAlert,
};

function Notice({ notice }: { notice: CardNotice }) {
  const Icon = NOTICE_ICON[notice.kind];
  return (
    <Alert variant={notice.kind} role="status" className="flex gap-2.5">
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div>{notice.text}</div>
    </Alert>
  );
}

function LinkButton({
  children,
  onClick,
  disabled,
  emphasised,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  emphasised?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        link,
        'min-h-6 max-sm:min-h-9',
        emphasised && 'font-semibold',
        disabled && 'cursor-default text-muted-foreground no-underline hover:text-muted-foreground',
      )}
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onClick}
    >
      {children}
    </button>
  );
}

function ageSeconds(until: number | null, now: number): number {
  return until === null ? 0 : Math.max(0, Math.ceil((until - now) / 1000));
}

export function AuthCard({
  initialMode,
  redirect,
  error: loginError,
  headingLevel,
  api,
  onSignedIn,
  onSignOut,
  ownsTitle = false,
}: AuthCardProps) {
  const uid = useId();
  const [state, dispatch] = useReducer(reducer, initialMode, initialState);
  const { mode } = state;
  const [now, setNow] = useState(() => Date.now());
  const [live, setLive] = useState({ text: '', seq: 0 });
  const announce = useCallback((text: string) => setLive((l) => ({ text, seq: l.seq + 1 })), []);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);
  const stateRef = useRef(state);
  stateRef.current = state;

  const id = (name: string) => `${uid}-${name}`;
  const Heading = headingLevel;

  // The bot-guard timestamp, fetched once; fetched again at submit if it failed.
  useEffect(() => {
    let cancelled = false;
    api
      .start()
      .then((r) => {
        if (!cancelled && r.startedAt) dispatch({ type: 'SET_GUARD', startedAt: r.startedAt });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [api]);

  // Focus the heading when the mode changes (not on first render), and keep the document title in step.
  useEffect(() => {
    if (ownsTitle) document.title = documentTitle(MODE_TITLES[mode].documentTitle);
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [mode, ownsTitle]);

  // Non-field errors take focus so they are announced and reachable.
  useEffect(() => {
    if (state.error && !state.error.field) errorRef.current?.focus();
  }, [state.error]);

  // One ticker while a cooldown or a lock runs; the countdown text itself is not live-announced.
  const running =
    (state.cooldownUntil !== null && state.cooldownUntil > now) ||
    (state.lockedUntil !== null && state.lockedUntil > now);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  const cooldown = ageSeconds(state.cooldownUntil, now);
  const lockLeft = ageSeconds(state.lockedUntil, now);
  const prevCooldown = useRef(0);
  useEffect(() => {
    if (prevCooldown.current > 0 && cooldown === 0) announce('You can send a new code now.');
    prevCooldown.current = cooldown;
  }, [cooldown, announce]);
  useEffect(() => {
    if (state.status === 'locked' && state.lockedUntil !== null && lockLeft === 0) {
      dispatch({ type: 'UNLOCK' });
      announce('You can try again now.');
    }
  }, [state.status, state.lockedUntil, lockLeft, announce]);

  const startCooldown = () => {
    const until = Date.now() + COOLDOWN_SECONDS * 1000;
    setNow(Date.now());
    dispatch({ type: 'SET_COOLDOWN', until });
  };

  const focusField = (field: AuthField) => {
    const map: Record<AuthField, string> = {
      email: id('email'),
      password: id('password'),
      newPassword: id('password'),
      code: id('code'),
    };
    // After the re-render that shows the error.
    setTimeout(() => {
      const el = document.getElementById(map[field]) as HTMLInputElement | null;
      el?.focus();
      if (field === 'code') el?.select();
    }, 0);
  };

  /** Shows a failure from the server: field error, notice-and-move, lock, or alert. */
  function handleFailure(f: AuthFailure, from: AuthMode) {
    const err = { code: f.code, message: f.message, field: f.field };
    switch (f.code) {
      case 'AUTH_EMAIL_NOT_VERIFIED':
        dispatch({
          type: 'SWITCH_MODE',
          mode: 'verifyEmail',
          notice: { kind: 'warning', text: f.message },
        });
        return;
      case 'AUTH_PASSWORD_RESET_REQUIRED':
        dispatch({
          type: 'SWITCH_MODE',
          mode: 'forgotPassword',
          notice: { kind: 'warning', text: f.message },
        });
        return;
      case 'AUTH_ALREADY_VERIFIED':
      case 'AUTH_SESSION_EXPIRED':
        dispatch({
          type: 'SWITCH_MODE',
          mode: 'signIn',
          notice: { kind: 'info', text: f.message },
        });
        return;
      case 'AUTH_RATE_LIMITED': {
        const secs = f.retryAfterSeconds ?? 60;
        setNow(Date.now());
        dispatch({ type: 'LOCK', until: Date.now() + secs * 1000, error: err });
        return;
      }
      case 'AUTH_VALIDATION_FAILED': {
        const fieldsMap = f.fields ?? (f.field ? { [f.field]: f.message } : {});
        dispatch({ type: 'FAILED', error: null, fieldErrors: fieldsMap });
        const first = (['email', 'password', 'newPassword', 'code'] as AuthField[]).find(
          (k) => fieldsMap[k],
        );
        if (first) focusField(first);
        return;
      }
      case 'AUTH_INVALID_CREDENTIALS':
        dispatch({ type: 'FAILED', error: err, clear: ['password'] });
        return;
      case 'AUTH_WEAK_PASSWORD': {
        const field: AuthField = from === 'resetPassword' ? 'newPassword' : 'password';
        dispatch({ type: 'FAILED', error: { ...err, field }, fieldErrors: { [field]: f.message } });
        focusField(field);
        return;
      }
      case 'AUTH_CODE_MISMATCH':
      case 'AUTH_CODE_EXPIRED':
        dispatch({
          type: 'FAILED',
          error: { ...err, field: 'code' },
          fieldErrors: { code: f.message },
        });
        focusField('code');
        return;
      case 'AUTH_ACCOUNT_EXISTS':
      case 'AUTH_DELIVERY_FAILED':
        dispatch({
          type: 'FAILED',
          error: { ...err, field: 'email' },
          fieldErrors: { email: f.message },
          clear: [],
        });
        focusField('email');
        return;
      default:
        dispatch({ type: 'FAILED', error: err });
    }
  }

  async function guard() {
    let startedAt = stateRef.current.guard.startedAt;
    if (!startedAt) {
      try {
        startedAt = (await api.start()).startedAt;
      } catch {
        startedAt = '';
      }
    }
    return { website: stateRef.current.guard.website, startedAt };
  }

  /** Validates the given fields; on failure shows the errors and returns null. */
  function validate<T extends Record<string, unknown>>(
    checks: Record<
      string,
      [
        unknown,
        {
          safeParse: (v: unknown) => {
            success: boolean;
            data?: unknown;
            error?: { issues: { message: string }[] };
          };
        },
      ]
    >,
    map: Partial<Record<string, AuthField>> = {},
  ): T | null {
    const errors: Partial<Record<AuthField, string>> = {};
    const out: Record<string, unknown> = {};
    for (const [key, [value, schema]] of Object.entries(checks)) {
      const r = schema.safeParse(value);
      if (r.success) out[key] = r.data;
      else
        errors[map[key] ?? (key as AuthField)] =
          r.error?.issues[0]?.message ?? AUTH_MESSAGES.AUTH_VALIDATION_FAILED;
    }
    const keys = Object.keys(errors) as AuthField[];
    if (keys.length === 0) return out as T;
    dispatch({
      type: 'FAILED',
      error:
        keys.length > 1
          ? { code: 'AUTH_VALIDATION_FAILED', message: AUTH_MESSAGES.AUTH_VALIDATION_FAILED }
          : null,
      fieldErrors: errors,
    });
    focusField(keys[0]!);
    return null;
  }

  async function submit(e?: { preventDefault: () => void }) {
    e?.preventDefault();
    const s = stateRef.current;
    if (s.status !== 'idle') return;

    try {
      switch (s.mode) {
        case 'signIn': {
          const v = validate<{ email: string; password: string }>({
            email: [s.email, EmailSchema],
            password: [s.password, SignInPasswordSchema],
          });
          if (!v) return;
          dispatch({ type: 'SUBMIT' });
          const r = await api.signIn({ email: v.email, password: v.password, redirect });
          if (r.ok) return finish(r.next);
          handleFailure(r, 'signIn');
          return;
        }
        case 'signUp': {
          const v = validate<{ email: string; password: string }>({
            email: [s.email, EmailSchema],
            password: [s.password, NewPasswordSchema],
          });
          if (!v) return;
          dispatch({ type: 'SUBMIT' });
          const r = await api.signUp({ ...v, guard: await guard() });
          if (r.ok) {
            // The password stays in memory so the user can be signed in after the code is verified.
            dispatch({
              type: 'SWITCH_MODE',
              mode: 'verifyEmail',
              keepPassword: true,
              destinationHint: r.destinationHint,
            });
            startCooldown();
            return;
          }
          handleFailure(r, 'signUp');
          return;
        }
        case 'verifyEmail': {
          const v = validate<{ email: string; code: string }>({
            email: [s.email, EmailSchema],
            code: [s.code, CodeSchema],
          });
          if (!v) return;
          dispatch({ type: 'SUBMIT' });
          const r = await api.confirmSignUp({
            email: v.email,
            code: v.code,
            ...(s.password ? { password: s.password } : {}),
            redirect,
          });
          if (r.ok && r.signedIn) return finish(r.next);
          if (r.ok) {
            dispatch({
              type: 'SWITCH_MODE',
              mode: 'signIn',
              notice: { kind: 'success', text: 'Your e-mail is verified. Sign in to continue.' },
            });
            return;
          }
          handleFailure(r, 'verifyEmail');
          return;
        }
        case 'forgotPassword': {
          const v = validate<{ email: string }>({ email: [s.email, EmailSchema] });
          if (!v) return;
          dispatch({ type: 'SUBMIT' });
          const r = await api.forgotPassword({ email: v.email, guard: await guard() });
          if (r.ok) {
            dispatch({
              type: 'SWITCH_MODE',
              mode: 'resetPassword',
              notice: {
                kind: 'success',
                text: 'If an account exists for that address, we sent a code.',
              },
            });
            startCooldown();
            return;
          }
          handleFailure(r, 'forgotPassword');
          return;
        }
        case 'resetPassword': {
          const parsed = ConfirmForgotInputSchema.safeParse({
            email: s.email,
            code: s.code,
            newPassword: s.newPassword,
          });
          if (!parsed.success) {
            const errs = zodFieldErrors(parsed.error) as Partial<Record<AuthField, string>>;
            const keys = (['code', 'newPassword', 'email'] as AuthField[]).filter((k) => errs[k]);
            dispatch({
              type: 'FAILED',
              error:
                keys.length > 1
                  ? {
                      code: 'AUTH_VALIDATION_FAILED',
                      message: AUTH_MESSAGES.AUTH_VALIDATION_FAILED,
                    }
                  : null,
              fieldErrors: errs,
            });
            if (keys[0]) focusField(keys[0]);
            return;
          }
          dispatch({ type: 'SUBMIT' });
          const r = await api.confirmForgotPassword(parsed.data);
          if (r.ok) {
            dispatch({
              type: 'SWITCH_MODE',
              mode: 'signIn',
              notice: {
                kind: 'success',
                text: 'Password changed. Sign in with your new password.',
              },
            });
            announce('Password changed');
            return;
          }
          handleFailure(r, 'resetPassword');
          return;
        }
      }
    } catch {
      dispatch({
        type: 'FAILED',
        error: { code: 'AUTH_UNAVAILABLE', message: AUTH_MESSAGES.AUTH_UNAVAILABLE },
      });
    }
  }

  function finish(next: string) {
    dispatch({ type: 'SET_FIELD', field: 'password', value: '' });
    onSignedIn(next);
  }

  async function resend() {
    const s = stateRef.current;
    if (s.status !== 'idle' || cooldown > 0) return;
    const email = EmailSchema.safeParse(s.email);
    if (!email.success) {
      dispatch({
        type: 'SET_FIELD_ERROR',
        field: 'email',
        message: email.error.issues[0]?.message ?? null,
      });
      return;
    }
    dispatch({ type: 'SUBMIT' });
    try {
      const r =
        s.mode === 'resetPassword'
          ? await api.forgotPassword({ email: email.data, guard: await guard() })
          : await api.resendCode({ email: email.data, guard: await guard() });
      if (r.ok) {
        dispatch({ type: 'FAILED', error: null });
        dispatch({ type: 'SET_NOTICE', notice: { kind: 'success', text: 'We sent a new code.' } });
        announce('Code sent');
        startCooldown();
        return;
      }
      handleFailure(r, s.mode);
    } catch {
      dispatch({
        type: 'FAILED',
        error: { code: 'AUTH_UNAVAILABLE', message: AUTH_MESSAGES.AUTH_UNAVAILABLE },
      });
    }
  }

  const go = (to: AuthMode, extra: { notice?: CardNotice } = {}) =>
    dispatch({ type: 'SWITCH_MODE', mode: to, ...extra });

  const busy = state.status === 'submitting';
  const locked = state.status === 'locked';
  const disabled = busy || locked;
  const blurCheck = (field: 'email' | 'code' | 'password' | 'newPassword') => () => {
    const schemas = {
      email: EmailSchema,
      code: CodeSchema,
      password: mode === 'signUp' ? NewPasswordSchema : SignInPasswordSchema,
      newPassword: NewPasswordSchema,
    } as const;
    const value = state[field];
    if (value === '') return; // not touched yet
    const r = schemas[field].safeParse(value);
    dispatch({
      type: 'SET_FIELD_ERROR',
      field,
      message: r.success ? null : (r.error.issues[0]?.message ?? null),
    });
  };

  const showGoogle = mode === 'signIn' || mode === 'signUp';
  const googleHref = `/auth/login?provider=google&redirect=${encodeURIComponent(redirect)}`;
  const unverified = loginError === 'unverified';
  const sentTo = state.destinationHint ?? state.email;

  const helper: Record<AuthMode, string | null> = {
    signIn: 'Welcome back.',
    signUp: 'Free. Your first sign-in creates your account.',
    verifyEmail:
      state.notice?.kind === 'warning'
        ? null
        : state.destinationHint
          ? `We sent a 6-digit code to ${sentTo}.`
          : state.email
            ? `Enter the 6-digit code we sent to ${state.email}.`
            : 'Enter the 6-digit code we sent to your e-mail.',
    forgotPassword: "Enter your e-mail and we'll send a code.",
    resetPassword: `Enter the code we sent to ${state.email || 'your e-mail'} and a new password.`,
  };

  const fe = state.fieldErrors;
  const errorLinks = state.error?.code === 'AUTH_VALIDATION_FAILED' && Object.keys(fe).length > 1;

  return (
    <section
      aria-labelledby={id('heading')}
      data-testid="auth-card"
      className="mx-auto flex w-full max-w-md flex-col gap-4 rounded-xl border bg-card p-6 shadow-sm max-[420px]:p-4.5"
    >
      <div>
        <Heading
          id={id('heading')}
          ref={headingRef}
          tabIndex={-1}
          className={cn(
            'outline-none focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring',
            headingLevel === 'h1'
              ? 'text-2xl leading-[30px] font-bold tracking-tight sm:text-[30px] sm:leading-9'
              : 'text-xl font-semibold leading-7',
          )}
        >
          {MODE_TITLES[mode].heading}
        </Heading>
        {!unverified && helper[mode] && (
          <p className="mt-1 text-sm text-text-secondary">{helper[mode]}</p>
        )}
      </div>

      {loginError && mode === 'signIn' && <LoginErrorAlert error={loginError} />}

      {unverified && mode === 'signIn' ? (
        <Button type="button" variant="outline" onClick={onSignOut}>
          Sign out
        </Button>
      ) : (
        <>
          {state.notice && <Notice notice={state.notice} />}
          {state.error && !state.error.field && (
            <Alert
              variant="destructive"
              ref={errorRef}
              className="flex gap-2.5 outline-none focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring"
              tabIndex={-1}
            >
              <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <div>
                <p>{state.error.message}</p>
                {locked && lockLeft > 0 && (
                  <p className="mt-1 text-xs" aria-hidden="true">
                    You can try again in {lockLeft} s.
                  </p>
                )}
                {errorLinks && (
                  <ul className="mt-1 list-disc pl-5">
                    {(['email', 'code', 'password', 'newPassword'] as AuthField[])
                      .filter((k) => fe[k])
                      .map((k) => (
                        <li key={k}>
                          <a
                            className={link}
                            href={`#${k === 'newPassword' ? id('password') : id(k)}`}
                          >
                            {fe[k]}
                          </a>
                        </li>
                      ))}
                  </ul>
                )}
                {state.error.code === 'AUTH_EMAIL_BUDGET' && showGoogle && (
                  <a className={cn(link, 'mt-1 inline-block font-semibold')} href={googleHref}>
                    Continue with Google
                  </a>
                )}
              </div>
            </Alert>
          )}

          <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
            {showGoogle && (
              <>
                <a
                  href={googleHref}
                  className="inline-flex h-11 w-full items-center justify-center gap-2.5 rounded-md border border-input bg-card text-sm font-semibold text-foreground outline-none transition-colors hover:bg-accent focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <GoogleIcon />
                  Continue with Google
                </a>
                <div
                  role="separator"
                  className="flex items-center gap-2.5 text-[13px] text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border"
                >
                  {mode === 'signIn'
                    ? 'or sign in with e-mail'
                    : 'or create an account with e-mail'}
                </div>
              </>
            )}

            <fieldset disabled={disabled} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
              <legend className="sr-only">{MODE_TITLES[mode].heading}</legend>
              {(mode === 'signIn' || mode === 'signUp' || mode === 'forgotPassword') && (
                <EmailField
                  id={id('email')}
                  value={state.email}
                  error={fe.email}
                  onChange={(v) => dispatch({ type: 'SET_FIELD', field: 'email', value: v })}
                  onBlur={blurCheck('email')}
                />
              )}
              {mode === 'signIn' && (
                <PasswordField
                  id={id('password')}
                  label="Password"
                  autoComplete="current-password"
                  value={state.password}
                  show={state.showPassword}
                  error={fe.password}
                  onChange={(v) => dispatch({ type: 'SET_FIELD', field: 'password', value: v })}
                  onToggle={() => dispatch({ type: 'TOGGLE_SHOW' })}
                />
              )}
              {mode === 'signUp' && (
                <PasswordField
                  id={id('password')}
                  label="Password"
                  autoComplete="new-password"
                  value={state.password}
                  show={state.showPassword}
                  error={fe.password}
                  showRules
                  onChange={(v) => dispatch({ type: 'SET_FIELD', field: 'password', value: v })}
                  onToggle={() => dispatch({ type: 'TOGGLE_SHOW' })}
                />
              )}
              {mode === 'forgotPassword' && (
                <p className="-mt-2 text-[13px] text-muted-foreground">
                  Signed up with Google? There is no password to reset: use{' '}
                  <a className={link} href={googleHref}>
                    Continue with Google
                  </a>
                  .
                </p>
              )}
              {(mode === 'verifyEmail' || mode === 'resetPassword') && (
                <CodeField
                  id={id('code')}
                  value={state.code}
                  error={fe.code}
                  onChange={(v) => dispatch({ type: 'SET_FIELD', field: 'code', value: v })}
                  onBlur={blurCheck('code')}
                />
              )}
              {mode === 'resetPassword' && (
                <PasswordField
                  id={id('password')}
                  label="New password"
                  autoComplete="new-password"
                  value={state.newPassword}
                  show={state.showPassword}
                  error={fe.newPassword}
                  showRules
                  onChange={(v) => dispatch({ type: 'SET_FIELD', field: 'newPassword', value: v })}
                  onToggle={() => dispatch({ type: 'TOGGLE_SHOW' })}
                />
              )}
              {mode === 'signUp' && state.error?.code === 'AUTH_ACCOUNT_EXISTS' && (
                <div className="-mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  <LinkButton onClick={() => go('signIn')}>Sign in</LinkButton>
                  <LinkButton onClick={() => go('forgotPassword')}>Forgot password?</LinkButton>
                  <LinkButton onClick={() => go('verifyEmail')}>I have a code</LinkButton>
                </div>
              )}
              {(mode === 'signUp' || mode === 'forgotPassword') && (
                <Honeypot
                  id={id('website')}
                  onChange={(v) => dispatch({ type: 'SET_FIELD', field: 'website', value: v })}
                />
              )}
            </fieldset>

            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={disabled}
              aria-busy={busy || undefined}
            >
              {busy && (
                <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
              )}
              {submitLabel(mode, busy)}
            </Button>

            {mode === 'signUp' && (
              <p className="-mt-1 text-xs text-muted-foreground">
                By creating an account you agree that this is a demonstration site that may be
                reset.
              </p>
            )}
          </form>

          <div className="flex flex-wrap justify-between gap-x-4 gap-y-2 text-sm">
            {mode === 'signIn' && (
              <>
                <LinkButton onClick={() => go('forgotPassword')}>Forgot password?</LinkButton>
                <span className="text-muted-foreground">
                  New here? <LinkButton onClick={() => go('signUp')}>Create account</LinkButton>
                </span>
              </>
            )}
            {mode === 'signUp' && (
              <span className="text-muted-foreground">
                Already have an account?{' '}
                <LinkButton onClick={() => go('signIn')}>Sign in</LinkButton>
              </span>
            )}
            {(mode === 'verifyEmail' || mode === 'resetPassword') && (
              <LinkButton
                disabled={cooldown > 0 || disabled}
                emphasised={state.error?.code === 'AUTH_CODE_EXPIRED'}
                onClick={() => void resend()}
              >
                {cooldown > 0 ? `Send a new code in ${cooldown} s` : 'Send a new code'}
              </LinkButton>
            )}
            {mode === 'verifyEmail' && (
              <LinkButton onClick={() => go('signUp')}>Use a different e-mail</LinkButton>
            )}
            {(mode === 'verifyEmail' || mode === 'forgotPassword' || mode === 'resetPassword') && (
              <LinkButton onClick={() => go('signIn')}>Back to sign in</LinkButton>
            )}
          </div>
        </>
      )}

      <noscript>
        <p className="text-sm text-muted-foreground">
          Turn on JavaScript to use e-mail sign-in. Continue with Google works without it.
        </p>
      </noscript>
      <LiveRegion message={live.text} seq={live.seq} />
    </section>
  );
}

function submitLabel(mode: AuthMode, busy: boolean): string {
  const labels: Record<AuthMode, [string, string]> = {
    signIn: ['Sign in', 'Signing in…'],
    signUp: ['Create account', 'Creating account…'],
    verifyEmail: ['Verify', 'Verifying…'],
    forgotPassword: ['Send code', 'Sending…'],
    resetPassword: ['Change password', 'Changing…'],
  };
  return labels[mode][busy ? 1 : 0];
}

/** A field only bots fill in: out of sight, out of the tab order, ignored by assistive technology. */
function Honeypot({ id, onChange }: { id: string; onChange: (v: string) => void }) {
  return (
    <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
      <label htmlFor={id}>Website</label>
      <input
        id={id}
        name="website"
        type="text"
        tabIndex={-1}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
