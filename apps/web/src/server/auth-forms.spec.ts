// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { AuthFailure } from '~/lib/auth/auth-errors';
import { AUTH_MESSAGES } from '~/lib/auth/auth-errors';
import { createAuthForms, type AuthFormsDeps } from './auth-forms';
import { SlidingWindowLimiter } from './auth-limits';
import { FAKE_CODE, createFakeCognito } from './cognito-fake';
import { CognitoError } from './cognito-port';
import { parseCookieHeader, parseSetCookie, readSession } from './session-cookie';

const SECRET = 's'.repeat(40);
const ORIGIN = 'https://coach.example.org';
const PASSWORD = 'Password123';

function setup(overrides: Partial<AuthFormsDeps> = {}, meStatus = 200, meBody: unknown = {}) {
  let t = 1_700_000_000_000;
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  const port = createFakeCognito();
  const cookies: string[] = [];
  const logs: Record<string, string | number>[] = [];
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(meBody), { status: meStatus }),
  );
  const deps: AuthFormsDeps = {
    mode: 'real',
    port,
    limits: new SlidingWindowLimiter(clock.now),
    secret: SECRET,
    secure: true,
    apiUrl: 'http://api.test/api',
    publicOrigin: ORIGIN,
    origin: ORIGIN,
    cookies: {},
    forwardedFor: '203.0.113.9, 10.0.0.1',
    fetch: fetchMock as unknown as typeof fetch,
    now: clock.now,
    setCookies: (c) => cookies.push(...c),
    log: (e) => logs.push(e),
    ...overrides,
  };
  const forms = createAuthForms(deps);
  /** A valid guard: token issued 3 s ago. */
  const guard = () => {
    const { startedAt } = forms.start();
    clock.advance(3000);
    return { website: '', startedAt };
  };
  return { forms, port, cookies, logs, fetchMock, clock, guard, deps };
}

const asFail = (r: unknown) => r as AuthFailure;

describe('signIn', () => {
  it('seals tokens into the session cookie, calls /auth/me with the ID token, returns only the path', async () => {
    const t = setup();
    const r = await t.forms.signIn({
      email: ' Ana@Example.com ',
      password: PASSWORD,
      redirect: '/coach',
    });
    expect(r).toEqual({ ok: true, next: '/coach' });
    expect(JSON.stringify(r)).not.toContain('fake-');

    const [url, init] = t.fetchMock.mock.calls[0]!;
    expect(url).toBe('http://api.test/api/auth/me');
    const headers = init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer fake-access-token');
    expect(headers['X-Id-Token']).toBe('fake-id-token');
    expect(headers['X-Forwarded-For']).toBe('203.0.113.9, 10.0.0.1');
    expect(t.port.calls[0]).toEqual({ fn: 'signIn', email: 'ana@example.com' });

    const parsed = t.cookies.map(parseSetCookie);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed.every((c) => c.httpOnly && c.secure && c.sameSite === 'Lax')).toBe(true);
    const jar = parseCookieHeader(t.cookies.map((c) => c.split(';')[0]).join('; '));
    const session = readSession(jar, SECRET);
    expect(session).toMatchObject({
      accessToken: 'fake-access-token',
      refreshToken: 'fake-refresh-token',
    });
    expect(session!.expiresAt).toBe(t.clock.now() + 3600_000);
    // The ID token is never stored.
    expect(t.cookies.join('')).not.toContain('fake-id-token');
    expect(JSON.stringify(session)).not.toContain('fake-id-token');
  });

  it('sanitises the redirect', async () => {
    const t = setup();
    expect(
      await t.forms.signIn({
        email: 'ana@example.com',
        password: PASSWORD,
        redirect: '//evil.test',
      }),
    ).toEqual({
      ok: true,
      next: '/puzzles',
    });
  });

  it('sends a blocked account to /blocked but keeps the session', async () => {
    const t = setup({}, 403, { error: { code: 'ACCOUNT_BLOCKED' } });
    expect(await t.forms.signIn({ email: 'ana@example.com', password: PASSWORD })).toEqual({
      ok: true,
      next: '/blocked',
    });
    expect(t.cookies.length).toBeGreaterThan(0);
    expect(t.cookies.every((c) => !c.includes('Max-Age=0'))).toBe(true);
  });

  it.each([
    [403, { error: { code: 'EMAIL_NOT_VERIFIED' } }],
    [500, {}],
  ])(
    'refuses with AUTH_ACCOUNT_SETUP_FAILED and no session when /auth/me answers %s',
    async (status, body) => {
      const t = setup({ cookies: { 'gc_session.0': 'old' } }, status, body);
      const r = asFail(await t.forms.signIn({ email: 'ana@example.com', password: PASSWORD }));
      expect(r).toMatchObject({ ok: false, code: 'AUTH_ACCOUNT_SETUP_FAILED' });
      expect(t.cookies.every((c) => c.includes('Max-Age=0'))).toBe(true);
    },
  );

  it('answers a wrong password and an unknown e-mail identically', async () => {
    const t = setup();
    const wrong = await t.forms.signIn({ email: 'ana@example.com', password: 'Wrong-password1' });
    const unknown = await t.forms.signIn({
      email: 'nobody@example.com',
      password: 'Wrong-password1',
    });
    expect(wrong).toEqual(unknown);
    expect(wrong).toEqual({
      ok: false,
      code: 'AUTH_INVALID_CREDENTIALS',
      message: AUTH_MESSAGES.AUTH_INVALID_CREDENTIALS,
    });
  });

  it('moves an unverified account to AUTH_EMAIL_NOT_VERIFIED and a forced reset to AUTH_PASSWORD_RESET_REQUIRED', async () => {
    const t = setup();
    expect(
      asFail(await t.forms.signIn({ email: 'new@example.com', password: PASSWORD })).code,
    ).toBe('AUTH_EMAIL_NOT_VERIFIED');
    expect(
      asFail(await t.forms.signIn({ email: 'reset@example.com', password: PASSWORD })).code,
    ).toBe('AUTH_PASSWORD_RESET_REQUIRED');
  });

  it('treats a challenge (MFA, new password) as unavailable', async () => {
    const t = setup();
    t.port.signIn = async () => ({ kind: 'challenge', name: 'NEW_PASSWORD_REQUIRED' });
    expect(
      asFail(await t.forms.signIn({ email: 'ana@example.com', password: PASSWORD })).code,
    ).toBe('AUTH_UNAVAILABLE');
  });

  it('locks a (e-mail, address) pair after 5 failures without calling Cognito again', async () => {
    const t = setup();
    for (let i = 0; i < 5; i++)
      await t.forms.signIn({ email: 'ana@example.com', password: 'Wrong-password1' });
    const callsBefore = t.port.calls.length;
    const r = asFail(await t.forms.signIn({ email: 'ana@example.com', password: PASSWORD }));
    expect(r.code).toBe('AUTH_RATE_LIMITED');
    expect(r.retryAfterSeconds).toBeGreaterThan(0);
    expect(r.message).toMatch(/^Too many attempts\. Try again in \d+ (seconds|minutes)\.$/);
    expect(t.port.calls.length).toBe(callsBefore);
    // Another e-mail from the same address is still allowed.
    expect((await t.forms.signIn({ email: 'other@example.com', password: PASSWORD })).ok).toBe(
      false,
    );
    expect(t.port.calls.length).toBe(callsBefore + 1);
  });

  it('locks an address after 30 failures across e-mails; success resets the pair counter', async () => {
    const t = setup();
    for (let i = 0; i < 30; i++)
      await t.forms.signIn({ email: `u${i}@example.com`, password: 'Wrong-password1' });
    expect(
      asFail(await t.forms.signIn({ email: 'ana@example.com', password: PASSWORD })).code,
    ).toBe('AUTH_RATE_LIMITED');

    const u = setup();
    for (let i = 0; i < 4; i++)
      await u.forms.signIn({ email: 'ana@example.com', password: 'Wrong-password1' });
    expect((await u.forms.signIn({ email: 'ana@example.com', password: PASSWORD })).ok).toBe(true);
    for (let i = 0; i < 4; i++)
      await u.forms.signIn({ email: 'ana@example.com', password: 'Wrong-password1' });
    expect(
      asFail(await u.forms.signIn({ email: 'ana@example.com', password: 'Wrong-password1' })).code,
    ).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('unlocks when the window passes', async () => {
    const t = setup();
    for (let i = 0; i < 5; i++)
      await t.forms.signIn({ email: 'ana@example.com', password: 'Wrong-password1' });
    t.clock.advance(15 * 60_000 + 1000);
    expect((await t.forms.signIn({ email: 'ana@example.com', password: PASSWORD })).ok).toBe(true);
  });

  it('maps a Cognito lockout and an outage', async () => {
    const t = setup();
    t.port.failNext('signIn', 'TooManyFailedAttemptsException');
    expect(await t.forms.signIn({ email: 'ana@example.com', password: PASSWORD })).toMatchObject({
      code: 'AUTH_RATE_LIMITED',
      retryAfterSeconds: 300,
    });
    t.port.failNext('signIn', 'InternalErrorException');
    expect(
      asFail(await t.forms.signIn({ email: 'ana@example.com', password: PASSWORD })).code,
    ).toBe('AUTH_UNAVAILABLE');
  });

  it('in fake mode creates no session and does not call the API', async () => {
    const t = setup({ mode: 'fake' });
    expect(await t.forms.signIn({ email: 'ana@example.com', password: PASSWORD })).toEqual({
      ok: true,
      next: '/puzzles',
    });
    expect(t.cookies).toEqual([]);
    expect(t.fetchMock).not.toHaveBeenCalled();
  });
});

describe('common rules', () => {
  it.each([[null], ['https://evil.example'], [ORIGIN + '/']])(
    'refuses origin %s before any Cognito call',
    async (origin) => {
      const t = setup({ origin });
      const calls = [
        t.forms.signIn({ email: 'ana@example.com', password: PASSWORD }),
        t.forms.signUp({ email: 'x@example.com', password: PASSWORD, guard: t.guard() }),
        t.forms.confirmSignUp({ email: 'x@example.com', code: FAKE_CODE }),
        t.forms.resendCode({ email: 'x@example.com' }),
        t.forms.forgotPassword({ email: 'x@example.com', guard: t.guard() }),
        t.forms.confirmForgotPassword({
          email: 'x@example.com',
          code: FAKE_CODE,
          newPassword: PASSWORD,
        }),
      ];
      for (const r of await Promise.all(calls))
        expect(r).toMatchObject({ ok: false, code: 'AUTH_FORBIDDEN_ORIGIN' });
      expect(t.port.calls).toEqual([]);
      expect(t.cookies).toEqual([]);
    },
  );

  it('validates input, names fields, and never echoes the input', async () => {
    const t = setup();
    const r = asFail(await t.forms.signIn({ email: 'not-an-email', password: '' }));
    expect(r.code).toBe('AUTH_VALIDATION_FAILED');
    expect(r.fields).toEqual({
      email: 'Enter a valid e-mail address.',
      password: 'Enter your password.',
    });
    expect(JSON.stringify(r)).not.toContain('not-an-email');
    const w = asFail(
      await t.forms.signUp({ email: 'a@example.com', password: 'short', guard: t.guard() }),
    );
    expect(w.fields?.password).toBe(
      'At least 10 characters, with a lower-case letter, an upper-case letter, and a number.',
    );
    const s = asFail(
      await t.forms.signUp({ email: 'a@example.com', password: ' Password123', guard: t.guard() }),
    );
    expect(s.fields?.password).toBe("Passwords can't start or end with a space.");
    const c = asFail(await t.forms.confirmSignUp({ email: 'a@example.com', code: '12' }));
    expect(c.fields?.code).toBe('Enter the 6-digit code.');
    expect(t.port.calls).toEqual([]);
  });

  it('logs only the function, outcome, hashed keys and time', async () => {
    const t = setup();
    await t.forms.signIn({ email: 'ana@example.com', password: PASSWORD });
    await t.forms.signIn({ email: 'ana@example.com', password: 'Wrong-password1' });
    const text = JSON.stringify(t.logs);
    expect(t.logs).toHaveLength(2);
    for (const e of t.logs)
      expect(Object.keys(e).sort()).toEqual(['emailKey', 'fn', 'ipKey', 'ms', 'outcome']);
    expect(t.logs[0]).toMatchObject({ fn: 'signIn', outcome: 'ok' });
    expect(t.logs[1]).toMatchObject({ outcome: 'AUTH_INVALID_CREDENTIALS' });
    expect(String(t.logs[0]!.emailKey)).toMatch(/^[0-9a-f]{12}$/);
    for (const secret of [
      'ana@example.com',
      PASSWORD,
      'Wrong-password1',
      '203.0.113.9',
      'fake-access-token',
    ])
      expect(text).not.toContain(secret);
  });

  it('turns an unexpected throw into AUTH_UNAVAILABLE and logs the exception name', async () => {
    const t = setup();
    t.port.signIn = async () => {
      throw new Error('secret detail for ana@example.com');
    };
    expect(
      asFail(await t.forms.signIn({ email: 'ana@example.com', password: PASSWORD })).code,
    ).toBe('AUTH_UNAVAILABLE');
    expect(JSON.stringify(t.logs)).not.toContain('secret detail');
  });
});

describe('signUp', () => {
  it('creates the user and returns the masked destination', async () => {
    const t = setup();
    const r = await t.forms.signUp({
      email: 'Brand@New.org',
      password: PASSWORD,
      guard: t.guard(),
    });
    expect(r).toEqual({
      ok: true,
      next: 'verifyEmail',
      destinationHint: 'b***@N***.org'.toLowerCase().replace('n***', 'n***'),
    });
    expect(t.port.users.has('brand@new.org')).toBe(true);
  });

  it('answers a taken address with AUTH_ACCOUNT_EXISTS on the e-mail field', async () => {
    const t = setup();
    expect(
      await t.forms.signUp({ email: 'ana@example.com', password: PASSWORD, guard: t.guard() }),
    ).toMatchObject({
      code: 'AUTH_ACCOUNT_EXISTS',
      field: 'email',
      message: 'An account with this e-mail already exists.',
    });
  });

  it('returns the success shape without calling Cognito when the honeypot is filled', async () => {
    const t = setup();
    const g = t.guard();
    const r = await t.forms.signUp({
      email: 'bot@example.com',
      password: PASSWORD,
      guard: { ...g, website: 'http://spam' },
    });
    expect(r).toMatchObject({ ok: true, next: 'verifyEmail' });
    expect(t.port.calls).toEqual([]);
  });

  it('returns the success shape without calling Cognito when the form was sent in under 2 s, or the token is bad', async () => {
    const t = setup();
    const { startedAt } = t.forms.start();
    t.clock.advance(1000);
    expect(
      await t.forms.signUp({
        email: 'fast@example.com',
        password: PASSWORD,
        guard: { website: '', startedAt },
      }),
    ).toMatchObject({ ok: true });
    expect(
      await t.forms.signUp({
        email: 'fake@example.com',
        password: PASSWORD,
        guard: { website: '', startedAt: 'forged' },
      }),
    ).toMatchObject({ ok: true });
    expect(t.port.calls).toEqual([]);
  });

  it('limits to 3 per e-mail and 5 per address per hour', async () => {
    const t = setup();
    for (let i = 0; i < 3; i++)
      await t.forms.signUp({ email: 'same@example.com', password: PASSWORD, guard: t.guard() });
    expect(
      asFail(
        await t.forms.signUp({ email: 'same@example.com', password: PASSWORD, guard: t.guard() }),
      ).code,
    ).toBe('AUTH_RATE_LIMITED');
    const u = setup();
    for (let i = 0; i < 5; i++)
      await u.forms.signUp({ email: `n${i}@example.com`, password: PASSWORD, guard: u.guard() });
    expect(
      asFail(
        await u.forms.signUp({ email: 'n9@example.com', password: PASSWORD, guard: u.guard() }),
      ).code,
    ).toBe('AUTH_RATE_LIMITED');
  });

  it.each([
    ['InvalidPasswordException', undefined, 'AUTH_WEAK_PASSWORD'],
    ['InvalidParameterException', { aboutPassword: true }, 'AUTH_WEAK_PASSWORD'],
    ['InvalidParameterException', undefined, 'AUTH_VALIDATION_FAILED'],
    ['CodeDeliveryFailureException', undefined, 'AUTH_DELIVERY_FAILED'],
    ['LimitExceededException', undefined, 'AUTH_RATE_LIMITED'],
    ['TooManyRequestsException', undefined, 'AUTH_UNAVAILABLE'],
  ] as const)('maps %s %j to %s', async (name, options, code) => {
    const t = setup();
    t.port.failNext('signUp', name, options);
    expect(
      asFail(await t.forms.signUp({ email: 'x@example.com', password: PASSWORD, guard: t.guard() }))
        .code,
    ).toBe(code);
  });

  it('treats an auto-confirmed user as a configuration error', async () => {
    const t = setup();
    t.port.signUp = async () => ({ confirmed: true });
    expect(
      asFail(await t.forms.signUp({ email: 'x@example.com', password: PASSWORD, guard: t.guard() }))
        .code,
    ).toBe('AUTH_UNAVAILABLE');
  });
});

describe('confirmSignUp', () => {
  it('verifies, then signs in directly when the password is given', async () => {
    const t = setup();
    t.port.users.set('late@example.com', { password: PASSWORD, confirmed: false, code: FAKE_CODE });
    const r = await t.forms.confirmSignUp({
      email: 'late@example.com',
      code: '123 456',
      password: PASSWORD,
      redirect: '/puzzles',
    });
    expect(r).toEqual({ ok: true, verified: true, signedIn: true, next: '/puzzles' });
    expect(t.cookies.length).toBeGreaterThan(0);
    expect(t.port.users.get('late@example.com')!.confirmed).toBe(true);
  });

  it('verifies without signing in when no password is given', async () => {
    const t = setup();
    expect(await t.forms.confirmSignUp({ email: 'new@example.com', code: FAKE_CODE })).toEqual({
      ok: true,
      verified: true,
      signedIn: false,
    });
    expect(t.cookies).toEqual([]);
  });

  it('reports verifiedSignInFailed when the code worked but the sign-in did not', async () => {
    const t = setup();
    expect(
      await t.forms.confirmSignUp({
        email: 'new@example.com',
        code: FAKE_CODE,
        password: 'Different123',
      }),
    ).toEqual({
      ok: true,
      verified: true,
      signedIn: false,
      notice: 'verifiedSignInFailed',
    });
  });

  it('maps wrong and expired codes, and a verified user', async () => {
    const t = setup();
    expect(await t.forms.confirmSignUp({ email: 'new@example.com', code: '000000' })).toMatchObject(
      { code: 'AUTH_CODE_MISMATCH', field: 'code' },
    );
    t.port.failNext('confirmSignUp', 'ExpiredCodeException');
    expect(
      asFail(await t.forms.confirmSignUp({ email: 'new@example.com', code: FAKE_CODE })).code,
    ).toBe('AUTH_CODE_EXPIRED');
    expect(
      asFail(await t.forms.confirmSignUp({ email: 'ana@example.com', code: FAKE_CODE })).code,
    ).toBe('AUTH_ALREADY_VERIFIED');
    expect(
      asFail(await t.forms.confirmSignUp({ email: 'nobody@example.com', code: FAKE_CODE })).code,
    ).toBe('AUTH_CODE_MISMATCH');
  });

  it('locks after 5 wrong codes for the same (e-mail, address)', async () => {
    const t = setup();
    for (let i = 0; i < 5; i++)
      await t.forms.confirmSignUp({ email: 'new@example.com', code: '000000' });
    const calls = t.port.calls.length;
    expect(
      asFail(await t.forms.confirmSignUp({ email: 'new@example.com', code: FAKE_CODE })).code,
    ).toBe('AUTH_RATE_LIMITED');
    expect(t.port.calls.length).toBe(calls);
  });
});

describe('resendCode', () => {
  it('answers a known, an unknown and an already-verified address the same way', async () => {
    const t = setup();
    const known = await t.forms.resendCode({ email: 'new@example.com' });
    t.clock.advance(31_000);
    const unknown = await t.forms.resendCode({ email: 'nobody@example.com' });
    t.clock.advance(31_000);
    const verified = await t.forms.resendCode({ email: 'ana@example.com' });
    expect(known).toEqual({ ok: true, cooldownSeconds: 30 });
    expect(unknown).toEqual(known);
    expect(verified).toEqual(known);
  });

  it('allows one per 30 s and five per hour per e-mail', async () => {
    const t = setup();
    await t.forms.resendCode({ email: 'new@example.com' });
    const early = asFail(await t.forms.resendCode({ email: 'new@example.com' }));
    expect(early.code).toBe('AUTH_RATE_LIMITED');
    expect(early.retryAfterSeconds).toBeLessThanOrEqual(30);
    for (let i = 0; i < 4; i++) {
      t.clock.advance(31_000);
      expect((await t.forms.resendCode({ email: 'new@example.com' })).ok).toBe(true);
    }
    t.clock.advance(31_000);
    expect(asFail(await t.forms.resendCode({ email: 'new@example.com' })).code).toBe(
      'AUTH_RATE_LIMITED',
    );
  });

  it('maps throttling and delivery failure; hides other failures', async () => {
    const t = setup();
    t.port.failNext('resendCode', 'LimitExceededException');
    expect(asFail(await t.forms.resendCode({ email: 'new@example.com' })).code).toBe(
      'AUTH_RATE_LIMITED',
    );
    t.clock.advance(31_000);
    t.port.failNext('resendCode', 'CodeDeliveryFailureException');
    expect(asFail(await t.forms.resendCode({ email: 'new@example.com' })).code).toBe(
      'AUTH_DELIVERY_FAILED',
    );
  });
});

describe('forgotPassword and confirmForgotPassword', () => {
  it('answers a known, unknown and Google-only address identically', async () => {
    const t = setup();
    const a = await t.forms.forgotPassword({ email: 'ana@example.com', guard: t.guard() });
    const b = await t.forms.forgotPassword({ email: 'nobody@example.com', guard: t.guard() });
    const c = await t.forms.forgotPassword({ email: 'google@example.com', guard: t.guard() });
    expect(a).toEqual({ ok: true, next: 'resetPassword' });
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    t.port.failNext('forgotPassword', 'CodeDeliveryFailureException');
    expect(await t.forms.forgotPassword({ email: 'ana@example.com', guard: t.guard() })).toEqual(a);
    t.port.failNext('forgotPassword', 'NotAuthorizedException');
    expect(await t.forms.forgotPassword({ email: 'ana@example.com', guard: t.guard() })).toEqual(a);
  });

  it('skips Cognito for a failed guard', async () => {
    const t = setup();
    const g = t.guard();
    expect(
      await t.forms.forgotPassword({ email: 'ana@example.com', guard: { ...g, website: 'x' } }),
    ).toEqual({ ok: true, next: 'resetPassword' });
    expect(t.port.calls).toEqual([]);
  });

  it('limits to 3 per e-mail and 10 per address per hour', async () => {
    const t = setup();
    for (let i = 0; i < 3; i++)
      await t.forms.forgotPassword({ email: 'ana@example.com', guard: t.guard() });
    expect(
      asFail(await t.forms.forgotPassword({ email: 'ana@example.com', guard: t.guard() })).code,
    ).toBe('AUTH_RATE_LIMITED');
    const u = setup();
    for (let i = 0; i < 10; i++)
      await u.forms.forgotPassword({ email: `n${i}@example.com`, guard: u.guard() });
    expect(
      asFail(await u.forms.forgotPassword({ email: 'n99@example.com', guard: u.guard() })).code,
    ).toBe('AUTH_RATE_LIMITED');
  });

  it('changes the password so the new one signs in and the old one does not', async () => {
    const t = setup();
    await t.forms.forgotPassword({ email: 'ana@example.com', guard: t.guard() });
    expect(
      await t.forms.confirmForgotPassword({
        email: 'ana@example.com',
        code: FAKE_CODE,
        newPassword: 'Another-pass9',
      }),
    ).toEqual({ ok: true, next: 'signIn' });
    expect(
      asFail(await t.forms.signIn({ email: 'ana@example.com', password: PASSWORD })).code,
    ).toBe('AUTH_INVALID_CREDENTIALS');
    expect((await t.forms.signIn({ email: 'ana@example.com', password: 'Another-pass9' })).ok).toBe(
      true,
    );
  });

  it('maps wrong code, expired code, weak password, and an unknown e-mail', async () => {
    const t = setup();
    await t.forms.forgotPassword({ email: 'ana@example.com', guard: t.guard() });
    expect(
      await t.forms.confirmForgotPassword({
        email: 'ana@example.com',
        code: '000000',
        newPassword: 'Another-pass9',
      }),
    ).toMatchObject({ code: 'AUTH_CODE_MISMATCH', field: 'code' });
    t.port.failNext('confirmForgotPassword', 'InvalidPasswordException');
    expect(
      await t.forms.confirmForgotPassword({
        email: 'ana@example.com',
        code: FAKE_CODE,
        newPassword: 'Another-pass9',
      }),
    ).toMatchObject({ code: 'AUTH_WEAK_PASSWORD', field: 'newPassword' });
    t.port.failNext('confirmForgotPassword', 'ExpiredCodeException');
    expect(
      asFail(
        await t.forms.confirmForgotPassword({
          email: 'ana@example.com',
          code: FAKE_CODE,
          newPassword: 'Another-pass9',
        }),
      ).code,
    ).toBe('AUTH_CODE_EXPIRED');
    t.port.failNext('confirmForgotPassword', 'UserNotFoundException');
    expect(
      asFail(
        await t.forms.confirmForgotPassword({
          email: 'nobody@example.com',
          code: FAKE_CODE,
          newPassword: 'Another-pass9',
        }),
      ).code,
    ).toBe('AUTH_CODE_MISMATCH');
  });

  it('locks after 5 wrong codes', async () => {
    const t = setup();
    await t.forms.forgotPassword({ email: 'ana@example.com', guard: t.guard() });
    for (let i = 0; i < 5; i++)
      await t.forms.confirmForgotPassword({
        email: 'ana@example.com',
        code: '000000',
        newPassword: 'Another-pass9',
      });
    expect(
      asFail(
        await t.forms.confirmForgotPassword({
          email: 'ana@example.com',
          code: FAKE_CODE,
          newPassword: 'Another-pass9',
        }),
      ).code,
    ).toBe('AUTH_RATE_LIMITED');
  });
});

describe('start', () => {
  it('returns only a sealed timestamp', () => {
    const t = setup();
    const r = t.forms.start();
    expect(Object.keys(r)).toEqual(['startedAt']);
    expect(r.startedAt).not.toContain(String(t.clock.now()));
  });
});

describe('CognitoError', () => {
  it('carries the exception name and no message beyond it', () => {
    const e = new CognitoError('NotAuthorizedException');
    expect(e.message).toBe('NotAuthorizedException');
  });
});
