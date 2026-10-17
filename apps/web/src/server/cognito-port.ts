// The narrow interface the sign-in forms need from the identity provider. The real adapter wraps the Cognito
// user-pool API (unauthenticated public operations, no AWS credentials, no client secret); the in-memory fake
// serves tests and the development-only visual preview. Server-only.

export type FormsFn =
  'signUp' | 'confirmSignUp' | 'resendCode' | 'signIn' | 'forgotPassword' | 'confirmForgotPassword';

/**
 * A failure from the identity provider. Carries the exception name and nothing else from the provider: no
 * message text and no request fields, so it is safe to log.
 */
export class CognitoError extends Error {
  constructor(
    readonly cognitoName: string,
    readonly options: {
      httpStatus?: number;
      /** `NotAuthorizedException` whose text says the user is already confirmed. */
      alreadyConfirmed?: boolean;
      /** `InvalidParameterException` whose text is about the password. */
      aboutPassword?: boolean;
      retryAfterSeconds?: number;
    } = {},
  ) {
    super(cognitoName);
    this.name = 'CognitoError';
  }
}

export interface TokenSet {
  accessToken: string;
  idToken: string;
  refreshToken: string;
  /** Seconds. */
  expiresIn: number;
}

export type SignInOutcome = ({ kind: 'tokens' } & TokenSet) | { kind: 'challenge'; name: string };

export interface CognitoPort {
  signUp(i: {
    email: string;
    password: string;
  }): Promise<{ destination?: string; confirmed: boolean }>;
  confirmSignUp(i: { email: string; code: string }): Promise<void>;
  resendCode(i: { email: string }): Promise<{ destination?: string }>;
  signIn(i: { email: string; password: string }): Promise<SignInOutcome>;
  forgotPassword(i: { email: string }): Promise<void>;
  confirmForgotPassword(i: { email: string; code: string; newPassword: string }): Promise<void>;
}
