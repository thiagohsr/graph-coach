import { CognitoError, type CognitoPort, type SignInOutcome } from './cognito-port';

// In-memory stand-in for Cognito, used by the tests and by the development-only preview of the forms
// (`/login?forms=1` with AUTH_MODE=dev). It never touches the network and its tokens are placeholders.

interface FakeUser {
  password: string;
  confirmed: boolean;
  code?: string;
  resetCode?: string;
  google?: boolean;
  resetRequired?: boolean;
}

export const FAKE_CODE = '123456';

export interface FakeCognito extends CognitoPort {
  users: Map<string, FakeUser>;
  /** Every call, by name, with the e-mail only (never the password or code). */
  calls: { fn: string; email: string }[];
  /** Make the next call of `fn` fail with this exception name. */
  failNext(
    fn: keyof CognitoPort,
    name: string,
    options?: ConstructorParameters<typeof CognitoError>[1],
  ): void;
}

export function createFakeCognito(): FakeCognito {
  const users = new Map<string, FakeUser>();
  const calls: { fn: string; email: string }[] = [];
  const failures = new Map<string, CognitoError>();
  users.set('ana@example.com', { password: 'Password123', confirmed: true });
  users.set('new@example.com', { password: 'Password123', confirmed: false, code: FAKE_CODE });
  users.set('google@example.com', { password: '', confirmed: true, google: true });
  users.set('reset@example.com', { password: 'Password123', confirmed: true, resetRequired: true });

  const enter = (fn: keyof CognitoPort, email: string) => {
    calls.push({ fn, email });
    const f = failures.get(fn);
    if (f) {
      failures.delete(fn);
      throw f;
    }
  };
  const masked = (email: string) => {
    const [u = '', d = ''] = email.split('@');
    return `${u.slice(0, 1)}***@${d.slice(0, 1)}***${d.slice(d.lastIndexOf('.'))}`;
  };

  return {
    users,
    calls,
    failNext(fn, name, options) {
      failures.set(fn, new CognitoError(name, options));
    },
    async signUp({ email, password }) {
      enter('signUp', email);
      if (users.has(email)) throw new CognitoError('UsernameExistsException');
      users.set(email, { password, confirmed: false, code: FAKE_CODE });
      return { destination: masked(email), confirmed: false };
    },
    async confirmSignUp({ email, code }) {
      enter('confirmSignUp', email);
      const u = users.get(email);
      if (!u) throw new CognitoError('UserNotFoundException');
      if (u.confirmed) throw new CognitoError('NotAuthorizedException', { alreadyConfirmed: true });
      if (code !== u.code) throw new CognitoError('CodeMismatchException');
      u.confirmed = true;
    },
    async resendCode({ email }) {
      enter('resendCode', email);
      const u = users.get(email);
      if (!u) throw new CognitoError('UserNotFoundException');
      if (u.confirmed) throw new CognitoError('InvalidParameterException');
      u.code = FAKE_CODE;
      return { destination: masked(email) };
    },
    async signIn({ email, password }): Promise<SignInOutcome> {
      enter('signIn', email);
      const u = users.get(email);
      if (!u || u.google || (u.confirmed && u.password !== password))
        throw new CognitoError('NotAuthorizedException');
      if (!u.confirmed) throw new CognitoError('UserNotConfirmedException');
      if (u.resetRequired) throw new CognitoError('PasswordResetRequiredException');
      return {
        kind: 'tokens',
        accessToken: 'fake-access-token',
        idToken: 'fake-id-token',
        refreshToken: 'fake-refresh-token',
        expiresIn: 3600,
      };
    },
    async forgotPassword({ email }) {
      enter('forgotPassword', email);
      const u = users.get(email);
      if (!u) throw new CognitoError('UserNotFoundException');
      if (u.google) throw new CognitoError('InvalidParameterException');
      u.resetCode = FAKE_CODE;
    },
    async confirmForgotPassword({ email, code, newPassword }) {
      enter('confirmForgotPassword', email);
      const u = users.get(email);
      if (!u || !u.resetCode) throw new CognitoError('ExpiredCodeException');
      if (code !== u.resetCode) throw new CognitoError('CodeMismatchException');
      u.password = newPassword;
      u.resetCode = undefined;
      u.resetRequired = false;
    },
  };
}
