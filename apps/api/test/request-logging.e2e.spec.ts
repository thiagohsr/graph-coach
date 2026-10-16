import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './support/test-app';

describe('request logging', () => {
  let t: TestApp;
  const lines: string[] = [];

  beforeAll(async () => {
    t = await createTestApp();
    const capture = (message: unknown) => {
      lines.push(String(message));
    };
    Logger.overrideLogger({
      log: capture,
      error: capture,
      warn: capture,
      debug: capture,
      verbose: capture,
    });
  });

  afterAll(async () => {
    Logger.overrideLogger(false);
    await t.close();
  });

  it('logs method, path, status, and user id, and nothing from /auth bodies or tokens', async () => {
    const user = await t.createUser({ email: 'private-person@example.test' });
    const login = await t.http
      .post('/auth/dev-login')
      .send({ email: user.email, password: 'hunter2-hunter2' });
    expect(login.status).toBe(200);
    const me = await t.http.get('/me/allowance').set(user.auth);
    expect(me.status).toBe(200);

    const output = lines.join('\n');
    expect(output).toContain('POST /api/auth/dev-login 200');
    expect(output).toContain(`GET /api/me/allowance 200`);
    expect(output).toContain(`user=${user.id}`);
    for (const secret of [user.email, 'hunter2', user.token, login.body.accessToken]) {
      expect(output).not.toContain(secret);
    }
  });
});
