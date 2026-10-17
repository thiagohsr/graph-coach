// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { formsMode } from './auth-forms-context';
import { parseEnv } from './env';

describe('formsMode', () => {
  it('is real with AUTH_MODE=cognito', () => {
    expect(formsMode({ authMode: 'cognito', nodeEnv: 'production' })).toBe('real');
  });
  it('is the fake preview only in dev mode outside production', () => {
    expect(formsMode({ authMode: 'dev', nodeEnv: undefined })).toBe('fake');
    expect(formsMode({ authMode: 'dev', nodeEnv: 'development' })).toBe('fake');
    expect(formsMode({ authMode: 'dev', nodeEnv: 'production' })).toBe('off');
  });
  it('cannot be enabled in production through the environment: AUTH_MODE=dev is refused there', () => {
    expect(() =>
      parseEnv({ SESSION_SECRET: 's'.repeat(32), NODE_ENV: 'production', AUTH_MODE: 'dev' }),
    ).toThrow(/AUTH_MODE/);
  });
});

describe('env', () => {
  it('reads the optional Cognito region and pool id', () => {
    const env = parseEnv({
      SESSION_SECRET: 's'.repeat(32),
      COGNITO_REGION: 'eu-west-1',
      COGNITO_USER_POOL_ID: 'eu-west-1_x',
    });
    expect(env).toMatchObject({ cognitoRegion: 'eu-west-1', cognitoUserPoolId: 'eu-west-1_x' });
    expect(
      parseEnv({ SESSION_SECRET: 's'.repeat(32), COGNITO_REGION: '' }).cognitoRegion,
    ).toBeUndefined();
  });
});
