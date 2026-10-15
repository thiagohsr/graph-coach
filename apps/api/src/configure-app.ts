import type { LogLevel } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Env } from './config/env';

export const LOG_LEVELS: Record<Env['LOG_LEVEL'], LogLevel[]> = {
  error: ['error'],
  warn: ['error', 'warn'],
  log: ['error', 'warn', 'log'],
  debug: ['error', 'warn', 'log', 'debug'],
};

/** `TRUST_PROXY` for Express: `false`, or the comma-separated list (loopback, subnets, addresses). */
export function trustProxyValue(value: string): false | string[] {
  return value === 'false' ? false : value.split(',').map((entry) => entry.trim());
}

/**
 * Settings every HTTP instance of the API shares (the server and the test application): prefix, CORS exactly as in
 * contracts/http-api.md "Common rules", a 1 MB JSON body limit, trusted proxies, and shutdown hooks.
 */
export function configureApp(
  app: NestExpressApplication,
  env: Pick<Env, 'WEB_ORIGIN' | 'TRUST_PROXY'>,
): void {
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: env.WEB_ORIGIN,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Id-Token'],
    credentials: false,
  });
  app.useBodyParser('json', { limit: '1mb' });
  app.set('trust proxy', trustProxyValue(env.TRUST_PROXY));
  app.enableShutdownHooks();
}
