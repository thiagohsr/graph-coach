import { failure, type AuthErrorCode, type AuthFailure } from '~/lib/auth/auth-errors';
import { CognitoError, type FormsFn } from './cognito-port';

// One table, one function: Cognito exception name -> our code, per function. Messages come from
// `lib/auth/auth-errors.ts`. Anything not listed falls to AUTH_UNAVAILABLE.

/** `'ok'` means "success-looking": the normal success result (anti-enumeration). */
export type Outcome = AuthErrorCode | 'ok';

type Row = Partial<Record<FormsFn, Outcome>>;

const ALL_UNAVAILABLE: Row = {
  signUp: 'AUTH_UNAVAILABLE',
  confirmSignUp: 'AUTH_UNAVAILABLE',
  resendCode: 'AUTH_UNAVAILABLE',
  signIn: 'AUTH_UNAVAILABLE',
  forgotPassword: 'AUTH_UNAVAILABLE',
  confirmForgotPassword: 'AUTH_UNAVAILABLE',
};
const ALL_RATE: Row = {
  signUp: 'AUTH_RATE_LIMITED',
  confirmSignUp: 'AUTH_RATE_LIMITED',
  resendCode: 'AUTH_RATE_LIMITED',
  signIn: 'AUTH_RATE_LIMITED',
  forgotPassword: 'AUTH_RATE_LIMITED',
  confirmForgotPassword: 'AUTH_RATE_LIMITED',
};

export const ERROR_MAP: Record<string, Row> = {
  UsernameExistsException: { signUp: 'AUTH_ACCOUNT_EXISTS' },
  InvalidPasswordException: {
    signUp: 'AUTH_WEAK_PASSWORD',
    confirmForgotPassword: 'AUTH_WEAK_PASSWORD',
  },
  InvalidParameterException: {
    signUp: 'AUTH_VALIDATION_FAILED', // 'AUTH_WEAK_PASSWORD' when the error is about the password
    confirmSignUp: 'AUTH_VALIDATION_FAILED',
    resendCode: 'ok',
    signIn: 'AUTH_INVALID_CREDENTIALS',
    forgotPassword: 'ok',
    confirmForgotPassword: 'AUTH_CODE_MISMATCH',
  },
  CodeMismatchException: {
    confirmSignUp: 'AUTH_CODE_MISMATCH',
    confirmForgotPassword: 'AUTH_CODE_MISMATCH',
  },
  ExpiredCodeException: {
    confirmSignUp: 'AUTH_CODE_EXPIRED',
    confirmForgotPassword: 'AUTH_CODE_EXPIRED',
  },
  NotAuthorizedException: {
    confirmSignUp: 'AUTH_CODE_MISMATCH', // 'AUTH_ALREADY_VERIFIED' when the user is already confirmed
    signIn: 'AUTH_INVALID_CREDENTIALS',
    forgotPassword: 'ok',
    confirmForgotPassword: 'AUTH_CODE_MISMATCH',
  },
  UserNotConfirmedException: { signIn: 'AUTH_EMAIL_NOT_VERIFIED' },
  UserNotFoundException: {
    confirmSignUp: 'AUTH_CODE_MISMATCH',
    resendCode: 'ok',
    signIn: 'AUTH_INVALID_CREDENTIALS',
    forgotPassword: 'ok',
    confirmForgotPassword: 'AUTH_CODE_MISMATCH',
  },
  PasswordResetRequiredException: { signIn: 'AUTH_PASSWORD_RESET_REQUIRED' },
  TooManyFailedAttemptsException: {
    confirmSignUp: 'AUTH_RATE_LIMITED',
    signIn: 'AUTH_RATE_LIMITED',
    confirmForgotPassword: 'AUTH_RATE_LIMITED',
  },
  LimitExceededException: ALL_RATE,
  TooManyRequestsException: ALL_UNAVAILABLE,
  CodeDeliveryFailureException: {
    signUp: 'AUTH_DELIVERY_FAILED',
    resendCode: 'AUTH_DELIVERY_FAILED',
    forgotPassword: 'ok',
  },
  InvalidEmailRoleAccessPolicyException: {
    signUp: 'AUTH_UNAVAILABLE',
    resendCode: 'AUTH_UNAVAILABLE',
    forgotPassword: 'AUTH_UNAVAILABLE',
  },
  InvalidSmsRoleAccessPolicyException: {
    signUp: 'AUTH_UNAVAILABLE',
    resendCode: 'AUTH_UNAVAILABLE',
    forgotPassword: 'AUTH_UNAVAILABLE',
  },
  InvalidSmsRoleTrustRelationshipException: {
    signUp: 'AUTH_UNAVAILABLE',
    resendCode: 'AUTH_UNAVAILABLE',
    forgotPassword: 'AUTH_UNAVAILABLE',
  },
  UserLambdaValidationException: ALL_UNAVAILABLE,
  InvalidLambdaResponseException: ALL_UNAVAILABLE,
  UnexpectedLambdaException: ALL_UNAVAILABLE,
  ResourceNotFoundException: ALL_UNAVAILABLE,
  ForbiddenException: ALL_UNAVAILABLE,
  InternalErrorException: ALL_UNAVAILABLE,
  UnsupportedUserStateException: { forgotPassword: 'ok' },
  AliasExistsException: { confirmSignUp: 'AUTH_ACCOUNT_EXISTS' },
  MFAMethodNotFoundException: ALL_UNAVAILABLE,
  SoftwareTokenMFANotFoundException: ALL_UNAVAILABLE,
  InvalidUserPoolConfigurationException: ALL_UNAVAILABLE,
  UserPoolAddOnNotEnabledException: ALL_UNAVAILABLE,
};

export type Mapped = { ok: true } | AuthFailure;

const FIELD: Partial<Record<AuthErrorCode, 'email' | 'password' | 'code'>> = {
  AUTH_ACCOUNT_EXISTS: 'email',
  AUTH_DELIVERY_FAILED: 'email',
  AUTH_CODE_MISMATCH: 'code',
  AUTH_CODE_EXPIRED: 'code',
};

/** The exception name of anything thrown by a Cognito call. */
export function exceptionName(error: unknown): string {
  return error instanceof CognitoError ? error.cognitoName : 'Unknown';
}

/**
 * `{ ok: true }` for a success-looking outcome (the caller returns its normal result), otherwise the
 * browser-facing failure. Never includes provider text.
 */
export function mapCognitoError(fn: FormsFn, error: unknown): Mapped {
  const name = exceptionName(error);
  const e = error instanceof CognitoError ? error : undefined;
  let outcome: Outcome = ERROR_MAP[name]?.[fn] ?? 'AUTH_UNAVAILABLE';

  if (name === 'InvalidParameterException' && fn === 'signUp' && e?.options.aboutPassword)
    outcome = 'AUTH_WEAK_PASSWORD';
  if (name === 'NotAuthorizedException' && fn === 'confirmSignUp' && e?.options.alreadyConfirmed)
    outcome = 'AUTH_ALREADY_VERIFIED';

  if (outcome === 'ok') return { ok: true };

  const extra: {
    field?: 'email' | 'password' | 'code' | 'newPassword';
    retryAfterSeconds?: number;
  } = {};
  if (outcome === 'AUTH_WEAK_PASSWORD')
    extra.field = fn === 'confirmForgotPassword' ? 'newPassword' : 'password';
  else if (outcome === 'AUTH_VALIDATION_FAILED') extra.field = 'email';
  else if (FIELD[outcome]) extra.field = FIELD[outcome]!;

  if (outcome === 'AUTH_RATE_LIMITED')
    extra.retryAfterSeconds =
      e?.options.retryAfterSeconds ?? (name === 'TooManyFailedAttemptsException' ? 300 : 60);
  return failure(outcome, extra);
}
