import { EventEmitter } from 'node:events';
import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RequestLoggerMiddleware } from './request-logger.middleware';

const lines: string[] = [];

beforeEach(() => {
  lines.length = 0;
  const capture = (message: unknown) => {
    lines.push(String(message));
  };
  Logger.overrideLogger({ log: capture, error: capture, warn: capture, debug: capture, verbose: capture });
});

afterEach(() => {
  Logger.overrideLogger(false);
});

function run(request: Record<string, unknown>, status: number): void {
  const res = Object.assign(new EventEmitter(), { statusCode: status }) as unknown as Response;
  let nextCalled = false;
  new RequestLoggerMiddleware().use(request as unknown as Request, res, (() => {
    nextCalled = true;
  }) as NextFunction);
  expect(nextCalled).toBe(true);
  res.emit('finish');
}

describe('RequestLoggerMiddleware', () => {
  it('logs method, path, status, duration, and the user id', () => {
    run({ method: 'GET', originalUrl: '/api/me/allowance', user: { id: 'user-1' } }, 200);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^GET \/api\/me\/allowance 200 [\d.]+ms user=user-1$/);
  });

  it('omits the user when the request is not authenticated and drops the query string', () => {
    run({ method: 'GET', originalUrl: '/api/health?probe=secret-value' }, 200);
    expect(lines[0]).toMatch(/^GET \/api\/health 200 /);
    expect(lines[0]).not.toContain('secret-value');
    expect(lines[0]).not.toContain('user=');
  });

  it('never logs the password, token, or address of a login request', () => {
    run(
      {
        method: 'POST',
        originalUrl: '/api/auth/dev-login',
        headers: { authorization: 'Bearer eyJ.token.value', 'x-id-token': 'id.token.value' },
        body: { email: 'person@example.test', password: 'hunter2-hunter2' },
      },
      200,
    );
    const output = lines.join('\n');
    expect(output).toContain('POST /api/auth/dev-login 200');
    for (const secret of ['hunter2', 'eyJ.token', 'id.token', 'person@example.test', 'Bearer']) {
      expect(output).not.toContain(secret);
    }
  });
});
