// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { AUTH_MESSAGES, rateLimitedMessage } from '~/lib/auth/auth-errors';
import { ERROR_MAP, mapCognitoError } from './auth-errors';
import { CognitoError, type FormsFn } from './cognito-port';

const FNS: FormsFn[] = [
  'signUp',
  'confirmSignUp',
  'resendCode',
  'signIn',
  'forgotPassword',
  'confirmForgotPassword',
];

describe('mapCognitoError: the full table', () => {
  const rows = Object.entries(ERROR_MAP).flatMap(([name, row]) =>
    FNS.flatMap((fn) => (row[fn] ? [[name, fn, row[fn]] as const] : [])),
  );

  it('has a row for every documented exception', () => {
    for (const name of [
      'UsernameExistsException',
      'InvalidPasswordException',
      'InvalidParameterException',
      'CodeMismatchException',
      'ExpiredCodeException',
      'NotAuthorizedException',
      'UserNotConfirmedException',
      'UserNotFoundException',
      'PasswordResetRequiredException',
      'TooManyFailedAttemptsException',
      'LimitExceededException',
      'TooManyRequestsException',
      'CodeDeliveryFailureException',
      'UnsupportedUserStateException',
    ])
      expect(ERROR_MAP[name], name).toBeDefined();
  });

  it.each(rows)('%s on %s -> %s', (name, fn, outcome) => {
    const mapped = mapCognitoError(fn, new CognitoError(name));
    if (outcome === 'ok') {
      expect(mapped).toEqual({ ok: true });
      return;
    }
    expect(mapped).toMatchObject({ ok: false, code: outcome });
    if (mapped.ok === false && outcome !== 'AUTH_RATE_LIMITED')
      expect(mapped.message).toBe(AUTH_MESSAGES[outcome]);
  });

  it('sends anything unlisted to AUTH_UNAVAILABLE, including non-Cognito errors', () => {
    for (const fn of FNS) {
      expect(mapCognitoError(fn, new CognitoError('SomethingNew'))).toMatchObject({
        code: 'AUTH_UNAVAILABLE',
      });
      expect(mapCognitoError(fn, new Error('boom'))).toMatchObject({ code: 'AUTH_UNAVAILABLE' });
      expect(mapCognitoError(fn, new CognitoError('TimeoutError'))).toMatchObject({
        code: 'AUTH_UNAVAILABLE',
      });
    }
  });

  it('never puts provider text in the result', () => {
    const e = new CognitoError('NotAuthorizedException');
    e.message = 'Incorrect username or password for ana@example.com';
    expect(JSON.stringify(mapCognitoError('signIn', e))).not.toContain('ana@example.com');
  });
});

describe('special cases', () => {
  it('maps a confirmed user on confirmSignUp to AUTH_ALREADY_VERIFIED', () => {
    expect(
      mapCognitoError(
        'confirmSignUp',
        new CognitoError('NotAuthorizedException', { alreadyConfirmed: true }),
      ),
    ).toMatchObject({ code: 'AUTH_ALREADY_VERIFIED' });
    expect(
      mapCognitoError('confirmSignUp', new CognitoError('NotAuthorizedException')),
    ).toMatchObject({
      code: 'AUTH_CODE_MISMATCH',
    });
  });

  it('maps a password-related InvalidParameter on signUp to AUTH_WEAK_PASSWORD', () => {
    expect(
      mapCognitoError(
        'signUp',
        new CognitoError('InvalidParameterException', { aboutPassword: true }),
      ),
    ).toMatchObject({ code: 'AUTH_WEAK_PASSWORD', field: 'password' });
    expect(mapCognitoError('signUp', new CognitoError('InvalidParameterException'))).toMatchObject({
      code: 'AUTH_VALIDATION_FAILED',
      field: 'email',
    });
  });

  it('puts field names on field errors', () => {
    expect(mapCognitoError('signUp', new CognitoError('UsernameExistsException'))).toMatchObject({
      field: 'email',
    });
    expect(
      mapCognitoError('confirmSignUp', new CognitoError('CodeMismatchException')),
    ).toMatchObject({ field: 'code' });
    expect(
      mapCognitoError('confirmForgotPassword', new CognitoError('InvalidPasswordException')),
    ).toMatchObject({
      field: 'newPassword',
    });
  });

  it('gives rate limits a retry time: 300 s for Cognito lockouts, 60 s otherwise', () => {
    expect(
      mapCognitoError('signIn', new CognitoError('TooManyFailedAttemptsException')),
    ).toMatchObject({
      retryAfterSeconds: 300,
      message: 'Too many attempts. Try again in 5 minutes.',
    });
    expect(mapCognitoError('signUp', new CognitoError('LimitExceededException'))).toMatchObject({
      retryAfterSeconds: 60,
    });
  });

  it('makes the sign-in answers for unknown users and wrong passwords identical', () => {
    const a = mapCognitoError('signIn', new CognitoError('NotAuthorizedException'));
    const b = mapCognitoError('signIn', new CognitoError('UserNotFoundException'));
    expect(a).toEqual(b);
  });
});

describe('rateLimitedMessage', () => {
  it('counts seconds up to 90 and minutes above', () => {
    expect(rateLimitedMessage(1)).toBe('Too many attempts. Try again in 1 second.');
    expect(rateLimitedMessage(45)).toBe('Too many attempts. Try again in 45 seconds.');
    expect(rateLimitedMessage(90)).toBe('Too many attempts. Try again in 90 seconds.');
    expect(rateLimitedMessage(91)).toBe('Too many attempts. Try again in 2 minutes.');
    expect(rateLimitedMessage(900)).toBe('Too many attempts. Try again in 15 minutes.');
  });
});
