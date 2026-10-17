// @vitest-environment node
import {
  ConfirmSignUpCommand,
  InitiateAuthCommand,
  SignUpCommand,
  type CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { describe, expect, it, vi } from 'vitest';
import { createCognitoAdapter, regionFrom } from './cognito-adapter';
import { CognitoError } from './cognito-port';

function clientReturning(result: unknown) {
  const send = vi.fn(async (_cmd: unknown, _opts?: unknown) => result);
  return { send, client: { send } as unknown as CognitoIdentityProviderClient };
}
function clientThrowing(name: string, message: string, status = 400) {
  const send = vi.fn(async () => {
    throw Object.assign(new Error(message), { name, $metadata: { httpStatusCode: status } });
  });
  return { send, client: { send } as unknown as CognitoIdentityProviderClient };
}

describe('regionFrom', () => {
  it('prefers the explicit region, then the pool id, then the hosted-UI domain', () => {
    expect(regionFrom({ region: 'us-west-2', userPoolId: 'eu-west-1_AbC' })).toBe('us-west-2');
    expect(regionFrom({ userPoolId: 'eu-west-1_AbC123' })).toBe('eu-west-1');
    expect(regionFrom({ domain: 'coach.auth.sa-east-1.amazoncognito.com' })).toBe('sa-east-1');
    expect(regionFrom({ domain: 'login.example.org' })).toBeUndefined();
    expect(regionFrom({})).toBeUndefined();
  });
});

describe('createCognitoAdapter', () => {
  it('signs in with USER_PASSWORD_AUTH, the client id, no secret hash, and a timeout', async () => {
    const { client, send } = clientReturning({
      AuthenticationResult: { AccessToken: 'a', IdToken: 'i', RefreshToken: 'r', ExpiresIn: 1800 },
    });
    const out = await createCognitoAdapter({ region: 'eu-west-1', clientId: 'cid' }, client).signIn(
      {
        email: 'ana@example.com',
        password: 'Password123',
      },
    );
    expect(out).toEqual({
      kind: 'tokens',
      accessToken: 'a',
      idToken: 'i',
      refreshToken: 'r',
      expiresIn: 1800,
    });
    const [cmd, opts] = send.mock.calls[0]!;
    expect(cmd).toBeInstanceOf(InitiateAuthCommand);
    expect((cmd as InitiateAuthCommand).input).toEqual({
      ClientId: 'cid',
      AuthFlow: 'USER_PASSWORD_AUTH',
      AuthParameters: { USERNAME: 'ana@example.com', PASSWORD: 'Password123' },
    });
    expect((opts as { abortSignal: AbortSignal }).abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('reports a challenge instead of tokens', async () => {
    const { client } = clientReturning({ ChallengeName: 'NEW_PASSWORD_REQUIRED', Session: 's' });
    expect(
      await createCognitoAdapter({ region: 'x', clientId: 'c' }, client).signIn({
        email: 'a@b.co',
        password: 'p',
      }),
    ).toEqual({
      kind: 'challenge',
      name: 'NEW_PASSWORD_REQUIRED',
    });
  });

  it('signs up with the e-mail attribute and returns the masked destination', async () => {
    const { client, send } = clientReturning({
      UserConfirmed: false,
      CodeDeliveryDetails: { Destination: 'a***@e***.com' },
    });
    expect(
      await createCognitoAdapter({ region: 'x', clientId: 'cid' }, client).signUp({
        email: 'a@e.com',
        password: 'Password123',
      }),
    ).toEqual({
      confirmed: false,
      destination: 'a***@e***.com',
    });
    expect((send.mock.calls[0]![0] as SignUpCommand).input).toMatchObject({
      Username: 'a@e.com',
      UserAttributes: [{ Name: 'email', Value: 'a@e.com' }],
    });
  });

  it('confirms with the code', async () => {
    const { client, send } = clientReturning({});
    await createCognitoAdapter({ region: 'x', clientId: 'cid' }, client).confirmSignUp({
      email: 'a@e.com',
      code: '123456',
    });
    expect((send.mock.calls[0]![0] as ConfirmSignUpCommand).input).toEqual({
      ClientId: 'cid',
      Username: 'a@e.com',
      ConfirmationCode: '123456',
    });
  });

  it('turns SDK errors into CognitoError with the exception name and no message or input', async () => {
    const { client } = clientThrowing(
      'NotAuthorizedException',
      'Incorrect username or password for ana@example.com PASSWORD=Password123',
    );
    const err = await createCognitoAdapter({ region: 'x', clientId: 'c' }, client)
      .signIn({ email: 'ana@example.com', password: 'Password123' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CognitoError);
    expect((err as CognitoError).cognitoName).toBe('NotAuthorizedException');
    expect((err as CognitoError).options.httpStatus).toBe(400);
    expect(String((err as Error).message)).not.toContain('ana@example.com');
    expect(JSON.stringify(err)).not.toContain('Password123');
  });

  it('flags the two hints and maps aborts to TimeoutError', async () => {
    const run = async (name: string, message: string) =>
      (await createCognitoAdapter(
        { region: 'x', clientId: 'c' },
        clientThrowing(name, message).client,
      )
        .confirmSignUp({ email: 'a@e.com', code: '123456' })
        .catch((e: unknown) => e)) as CognitoError;
    expect(
      (await run('NotAuthorizedException', 'User cannot be confirmed. Current status is CONFIRMED'))
        .options.alreadyConfirmed,
    ).toBe(true);
    expect(
      (await run('InvalidParameterException', 'Password did not conform with policy')).options
        .aboutPassword,
    ).toBe(true);
    expect((await run('TimeoutError', 'The operation was aborted')).cognitoName).toBe(
      'TimeoutError',
    );
    expect((await run('AbortError', 'x')).cognitoName).toBe('TimeoutError');
  });
});
