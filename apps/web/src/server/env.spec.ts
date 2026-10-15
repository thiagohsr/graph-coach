// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EnvError, parseEnv } from './env';

const secret = 's'.repeat(32);

describe('parseEnv', () => {
  it('applies defaults', () => {
    const env = parseEnv({ SESSION_SECRET: secret });
    expect(env).toMatchObject({
      port: 3000,
      apiUrl: 'http://localhost:3001/api',
      cookieSecure: false,
      authMode: 'dev',
      trustProxy: '',
    });
  });

  it('treats empty values as unset', () => {
    const env = parseEnv({ SESSION_SECRET: secret, COGNITO_DOMAIN: '', WEB_ORIGIN: '', TRUST_PROXY: '', WEB_PORT: '' });
    expect(env.cognitoDomain).toBeUndefined();
    expect(env.webOrigin).toBeUndefined();
    expect(env.port).toBe(3000);
  });

  it('requires SESSION_SECRET of at least 32 characters in every mode', () => {
    expect(() => parseEnv({})).toThrow(EnvError);
    expect(() => parseEnv({ SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
  });

  it('refuses dev mode in production', () => {
    expect(() => parseEnv({ SESSION_SECRET: secret, NODE_ENV: 'production', AUTH_MODE: 'dev' })).toThrow(/AUTH_MODE/);
  });

  it('requires the Cognito values in cognito mode', () => {
    expect(() => parseEnv({ SESSION_SECRET: secret, AUTH_MODE: 'cognito' })).toThrow(/COGNITO_DOMAIN/);
    const env = parseEnv({
      SESSION_SECRET: secret,
      AUTH_MODE: 'cognito',
      COGNITO_DOMAIN: 'auth.example.com',
      COGNITO_CLIENT_ID: 'abc',
      WEB_ORIGIN: 'https://coach.example.com/',
      COOKIE_SECURE: 'true',
      NODE_ENV: 'production',
    });
    expect(env.webOrigin).toBe('https://coach.example.com');
    expect(env.cookieSecure).toBe(true);
  });

  it('strips a trailing slash from API_URL', () => {
    expect(parseEnv({ SESSION_SECRET: secret, API_URL: 'http://api:3001/api/' }).apiUrl).toBe('http://api:3001/api');
  });
});
