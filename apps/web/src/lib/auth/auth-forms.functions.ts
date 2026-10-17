import { createServerFn } from '@tanstack/react-start';
import { appendResponseHeader, getRequest, setResponseHeader } from '@tanstack/react-start/server';
import {
  failure,
  type ConfirmForgotResult,
  type ConfirmSignUpResult,
  type ForgotResult,
  type ResendResult,
  type SignInResult,
  type SignUpResult,
} from './auth-errors';
import type {
  ConfirmForgotInput,
  ConfirmSignUpInput,
  ForgotInput,
  ResendInput,
  SignInInput,
  SignUpInput,
} from './auth-forms.schema';

// Server functions behind the in-app sign-in forms (contracts/server-functions.md). Bodies run on the server
// only; server-only modules are imported dynamically so they never reach the browser bundle. None throws for
// an expected failure: each returns `{ ok: true, ... }` or `{ ok: false, code, message, ... }`. Nothing here
// returns, stores or logs a password, a code, or a token.

async function withForms<R>(
  run: (forms: import('~/server/auth-forms').AuthForms) => Promise<R>,
): Promise<R | ReturnType<typeof failure>> {
  const { buildAuthForms } = await import('~/server/auth-forms-context');
  setResponseHeader('Cache-Control', 'no-store');
  const forms = buildAuthForms(getRequest(), (cookies) => {
    if (cookies.length > 0) appendResponseHeader('Set-Cookie', cookies);
  });
  if (!forms) return failure('AUTH_NOT_ENABLED');
  return run(forms);
}

export const getAuthFormStartFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ startedAt: string }> => {
    const { buildAuthForms } = await import('~/server/auth-forms-context');
    setResponseHeader('Cache-Control', 'no-store');
    const forms = buildAuthForms(getRequest(), () => {});
    return forms ? forms.start() : { startedAt: '' };
  },
);

/** Whether `/login?forms=1` may show the in-memory preview: AUTH_MODE=dev and not production. */
export const getAuthFormsPreviewFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<boolean> => {
    const [{ getEnv }, { formsMode }] = await Promise.all([
      import('~/server/env'),
      import('~/server/auth-forms-context'),
    ]);
    const env = getEnv();
    return env.authMode === 'dev' && formsMode(env) === 'fake';
  },
);

export const signUpFn = createServerFn({ method: 'POST' })
  .validator((input: SignUpInput) => input)
  .handler(({ data }) => withForms((f) => f.signUp(data)));

export const confirmSignUpFn = createServerFn({ method: 'POST' })
  .validator((input: ConfirmSignUpInput) => input)
  .handler(({ data }) => withForms((f) => f.confirmSignUp(data)));

export const resendCodeFn = createServerFn({ method: 'POST' })
  .validator((input: ResendInput) => input)
  .handler(({ data }) => withForms((f) => f.resendCode(data)));

export const signInFn = createServerFn({ method: 'POST' })
  .validator((input: SignInInput) => input)
  .handler(({ data }) => withForms((f) => f.signIn(data)));

export const forgotPasswordFn = createServerFn({ method: 'POST' })
  .validator((input: ForgotInput) => input)
  .handler(({ data }) => withForms((f) => f.forgotPassword(data)));

export const confirmForgotPasswordFn = createServerFn({ method: 'POST' })
  .validator((input: ConfirmForgotInput) => input)
  .handler(({ data }) => withForms((f) => f.confirmForgotPassword(data)));

/** The card's view of the server functions; tests and the preview inject their own. */
export interface AuthApi {
  start(): Promise<{ startedAt: string }>;
  signUp(i: SignUpInput): Promise<SignUpResult>;
  confirmSignUp(i: ConfirmSignUpInput): Promise<ConfirmSignUpResult>;
  resendCode(i: ResendInput): Promise<ResendResult>;
  signIn(i: SignInInput): Promise<SignInResult>;
  forgotPassword(i: ForgotInput): Promise<ForgotResult>;
  confirmForgotPassword(i: ConfirmForgotInput): Promise<ConfirmForgotResult>;
}

export const authFormsApi: AuthApi = {
  start: () => getAuthFormStartFn(),
  signUp: (data) => signUpFn({ data }),
  confirmSignUp: (data) => confirmSignUpFn({ data }),
  resendCode: (data) => resendCodeFn({ data }),
  signIn: (data) => signInFn({ data }),
  forgotPassword: (data) => forgotPasswordFn({ data }),
  confirmForgotPassword: (data) => confirmForgotPasswordFn({ data }),
};
