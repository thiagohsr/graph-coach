import {
  CognitoIdentityProviderClient,
  ConfirmForgotPasswordCommand,
  ConfirmSignUpCommand,
  ForgotPasswordCommand,
  InitiateAuthCommand,
  ResendConfirmationCodeCommand,
  SignUpCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { CognitoError, type CognitoPort, type SignInOutcome } from './cognito-port';

// The real CognitoPort: the user-pool API's unauthenticated public operations. The app client is public
// (no secret), so there is no SECRET_HASH, and no AWS credentials are used. Every call has a 5 s timeout and
// at most one SDK retry. Thrown errors carry the exception name only (see CognitoError).

const TIMEOUT_MS = 5_000;

export interface AdapterConfig {
  region: string;
  clientId: string;
}

function toCognitoError(error: unknown): CognitoError {
  if (error instanceof CognitoError) return error;
  const e = error as { name?: unknown; message?: unknown; $metadata?: { httpStatusCode?: number } };
  const name = typeof e?.name === 'string' && e.name ? e.name : 'Unknown';
  const text = typeof e?.message === 'string' ? e.message : '';
  const options: ConstructorParameters<typeof CognitoError>[1] = {};
  if (typeof e?.$metadata?.httpStatusCode === 'number')
    options.httpStatus = e.$metadata.httpStatusCode;
  if (name === 'NotAuthorizedException' && /current status is CONFIRMED/i.test(text))
    options.alreadyConfirmed = true;
  if (name === 'InvalidParameterException' && /password/i.test(text)) options.aboutPassword = true;
  // The message text is read for those two hints and dropped: it is never kept.
  return new CognitoError(
    name === 'AbortError' || name === 'TimeoutError' ? 'TimeoutError' : name,
    options,
  );
}

export function createCognitoAdapter(
  config: AdapterConfig,
  client: CognitoIdentityProviderClient = new CognitoIdentityProviderClient({
    region: config.region,
    maxAttempts: 2,
  }),
): CognitoPort {
  const { clientId } = config;
  const send = async <T>(run: (opts: { abortSignal: AbortSignal }) => Promise<T>): Promise<T> => {
    try {
      return await run({ abortSignal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
      throw toCognitoError(error);
    }
  };

  return {
    async signUp({ email, password }) {
      const out = await send((o) =>
        client.send(
          new SignUpCommand({
            ClientId: clientId,
            Username: email,
            Password: password,
            UserAttributes: [{ Name: 'email', Value: email }],
          }),
          o,
        ),
      );
      const result: { destination?: string; confirmed: boolean } = {
        confirmed: out.UserConfirmed === true,
      };
      if (out.CodeDeliveryDetails?.Destination)
        result.destination = out.CodeDeliveryDetails.Destination;
      return result;
    },
    async confirmSignUp({ email, code }) {
      await send((o) =>
        client.send(
          new ConfirmSignUpCommand({ ClientId: clientId, Username: email, ConfirmationCode: code }),
          o,
        ),
      );
    },
    async resendCode({ email }) {
      const out = await send((o) =>
        client.send(new ResendConfirmationCodeCommand({ ClientId: clientId, Username: email }), o),
      );
      const result: { destination?: string } = {};
      if (out.CodeDeliveryDetails?.Destination)
        result.destination = out.CodeDeliveryDetails.Destination;
      return result;
    },
    async signIn({ email, password }): Promise<SignInOutcome> {
      const out = await send((o) =>
        client.send(
          new InitiateAuthCommand({
            ClientId: clientId,
            AuthFlow: 'USER_PASSWORD_AUTH',
            AuthParameters: { USERNAME: email, PASSWORD: password },
          }),
          o,
        ),
      );
      const r = out.AuthenticationResult;
      if (r?.AccessToken && r.IdToken && r.RefreshToken)
        return {
          kind: 'tokens',
          accessToken: r.AccessToken,
          idToken: r.IdToken,
          refreshToken: r.RefreshToken,
          expiresIn: r.ExpiresIn && r.ExpiresIn > 0 ? r.ExpiresIn : 3600,
        };
      return { kind: 'challenge', name: out.ChallengeName ?? 'UNKNOWN' };
    },
    async forgotPassword({ email }) {
      await send((o) =>
        client.send(new ForgotPasswordCommand({ ClientId: clientId, Username: email }), o),
      );
    },
    async confirmForgotPassword({ email, code, newPassword }) {
      await send((o) =>
        client.send(
          new ConfirmForgotPasswordCommand({
            ClientId: clientId,
            Username: email,
            ConfirmationCode: code,
            Password: newPassword,
          }),
          o,
        ),
      );
    },
  };
}

/** `eu-west-1` from a pool id (`eu-west-1_AbC`) or a hosted-UI domain (`x.auth.eu-west-1.amazoncognito.com`). */
export function regionFrom(source: {
  region?: string | undefined;
  userPoolId?: string | undefined;
  domain?: string | undefined;
}): string | undefined {
  if (source.region) return source.region;
  const fromPool = /^([a-z]{2}(?:-[a-z]+)+-\d)_/.exec(source.userPoolId ?? '')?.[1];
  if (fromPool) return fromPool;
  return /\.auth(?:-fips)?\.([a-z0-9-]+)\.amazoncognito\.com$/.exec(source.domain ?? '')?.[1];
}
