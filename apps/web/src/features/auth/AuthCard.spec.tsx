import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTH_MESSAGES, failure, type AuthFailure } from '~/lib/auth/auth-errors';
import type { AuthApi } from '~/lib/auth/auth-forms.functions';
import { AuthCard, type AuthCardProps } from './AuthCard';

function makeApi(overrides: Partial<{ [K in keyof AuthApi]: ReturnType<typeof vi.fn> }> = {}) {
  return {
    start: vi.fn(async () => ({ startedAt: 'token' })),
    signUp: vi.fn(async () => ({
      ok: true,
      next: 'verifyEmail',
      destinationHint: 'a***@e***.com',
    })),
    confirmSignUp: vi.fn(async () => ({ ok: true, verified: true, signedIn: false })),
    resendCode: vi.fn(async () => ({ ok: true, cooldownSeconds: 30 })),
    signIn: vi.fn(async () => ({ ok: true, next: '/puzzles' })),
    forgotPassword: vi.fn(async () => ({ ok: true, next: 'resetPassword' })),
    confirmForgotPassword: vi.fn(async () => ({ ok: true, next: 'signIn' })),
    ...overrides,
  } as unknown as AuthApi & { [K in keyof AuthApi]: ReturnType<typeof vi.fn> };
}

type Api = ReturnType<typeof makeApi>;

function setup(props: Partial<AuthCardProps> = {}, api: Api = makeApi(), fakeTimers = false) {
  const onSignedIn = vi.fn();
  const user = userEvent.setup(fakeTimers ? { advanceTimers: vi.advanceTimersByTime } : {});
  const view = render(
    <AuthCard
      initialMode="signIn"
      redirect="/puzzles"
      headingLevel="h1"
      api={api}
      onSignedIn={onSignedIn}
      {...props}
    />,
  );
  return { api, user, onSignedIn, ...view };
}

const email = () => screen.getByLabelText(/^E-mail/) as HTMLInputElement;
const password = (name: RegExp = /^Password \(required\)/) =>
  screen.getByLabelText(name) as HTMLInputElement;
const heading = (name: string) => screen.getByRole('heading', { name });
const alertText = () => screen.getByRole('alert').textContent;
const fail = (code: Parameters<typeof failure>[0], extra?: Parameters<typeof failure>[1]) =>
  failure(code, extra) as AuthFailure;

/** Fake timers, plus the shim Testing Library needs to advance them under Vitest. */
function fakeTimers() {
  vi.useFakeTimers();
  (globalThis as { jest?: unknown }).jest = { advanceTimersByTime: vi.advanceTimersByTime };
}

afterEach(() => {
  vi.useRealTimers();
  (globalThis as { jest?: unknown }).jest = undefined;
});

/** The notice box (not the screen-reader live region, which is also role=status). */
const notice = () => document.querySelector<HTMLElement>('[data-slot="alert"][role="status"]')!;

describe('AuthCard: sign in', () => {
  it('renders the labelled fields with the right attributes, Google, and the links', () => {
    setup();
    expect(heading('Sign in').tagName).toBe('H1');
    expect(screen.getByText('Welcome back.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue with Google' })).toHaveAttribute(
      'href',
      '/auth/login?provider=google&redirect=%2Fpuzzles',
    );
    expect(screen.getByText('or sign in with e-mail')).toBeInTheDocument();
    expect(email()).toHaveAttribute('type', 'email');
    expect(email()).toHaveAttribute('autocomplete', 'username');
    expect(email()).toHaveAttribute('inputmode', 'email');
    expect(email()).toHaveAttribute('autocapitalize', 'none');
    expect(email()).toHaveAttribute('spellcheck', 'false');
    expect(password()).toHaveAttribute('autocomplete', 'current-password');
    expect(password()).toHaveAttribute('type', 'password');
    expect(screen.getByText('E-mail').parentElement).toHaveTextContent('E-mail (required)');
    expect(screen.getByRole('button', { name: 'Sign in' })).toHaveAttribute('type', 'submit');
    expect(screen.getByRole('button', { name: 'Forgot password?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Password rules' })).toBeNull();
  });

  it('submits normalised data and hands the server path to onSignedIn', async () => {
    const { user, api, onSignedIn } = setup({ redirect: '/coach' });
    await user.type(email(), '  Ana@Example.com ');
    await user.type(password(), 'Password123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(api.signIn).toHaveBeenCalledWith({
      email: 'ana@example.com',
      password: 'Password123',
      redirect: '/coach',
    });
    expect(onSignedIn).toHaveBeenCalledWith('/puzzles');
  });

  it('shows our validation messages and calls nothing when fields are empty', async () => {
    const { user, api } = setup();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(api.signIn).not.toHaveBeenCalled();
    expect(email()).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Check the highlighted fields.');
    expect(screen.getAllByText('Enter a valid e-mail address.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Enter your password.').length).toBeGreaterThan(0);
    await waitFor(() => expect(email()).toHaveFocus());
  });

  it('validates the e-mail on blur once touched', async () => {
    const { user } = setup();
    await user.type(email(), 'nope');
    await user.tab();
    expect(email()).toHaveAttribute('aria-invalid', 'true');
    expect(email()).toHaveAccessibleDescription('Enter a valid e-mail address.');
  });

  it('wrong credentials: alert with the fixed message and focus, password cleared, e-mail kept', async () => {
    const api = makeApi({ signIn: vi.fn(async () => fail('AUTH_INVALID_CREDENTIALS')) });
    const { user } = setup({}, api);
    await user.type(email(), 'ana@example.com');
    await user.type(password(), 'Wrong-password1');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(alertText()).toContain("That e-mail and password don't match.");
    expect(screen.getByRole('alert')).toHaveFocus();
    expect(password()).toHaveValue('');
    expect(email()).toHaveValue('ana@example.com');
  });

  it('disables the button and says so while the request is pending', async () => {
    let resolve!: (v: unknown) => void;
    const api = makeApi({ signIn: vi.fn(() => new Promise((r) => (resolve = r))) });
    const { user } = setup({}, api);
    await user.type(email(), 'ana@example.com');
    await user.type(password(), 'Password123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    const busy = screen.getByRole('button', { name: 'Signing in…' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    await act(async () => resolve(fail('AUTH_UNAVAILABLE')));
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    expect(alertText()).toContain(AUTH_MESSAGES.AUTH_UNAVAILABLE);
  });

  it('keeps what was typed when the service is unavailable', async () => {
    const api = makeApi({
      signIn: vi.fn(async () => {
        throw new Error('network');
      }),
    });
    const { user } = setup({}, api);
    await user.type(email(), 'ana@example.com');
    await user.type(password(), 'Password123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(alertText()).toContain(AUTH_MESSAGES.AUTH_UNAVAILABLE);
    expect(password()).toHaveValue('Password123');
  });

  it('locks the form with a countdown when rate limited, then unlocks (fake timers)', async () => {
    fakeTimers();
    const api = makeApi({
      signIn: vi.fn(async () => fail('AUTH_RATE_LIMITED', { retryAfterSeconds: 3 })),
    });
    const { user } = setup({}, api, true);
    await user.type(email(), 'ana@example.com');
    await user.type(password(), 'Password123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Too many attempts. Try again in 3 seconds.',
    );
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
    expect(email()).toBeDisabled();
    expect(screen.getByText('You can try again in 3 s.')).toBeInTheDocument();
    await act(async () => void vi.advanceTimersByTime(4000));
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    expect(email()).toBeEnabled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('an unverified account goes to Verify e-mail with a warning and the e-mail kept', async () => {
    const api = makeApi({ signIn: vi.fn(async () => fail('AUTH_EMAIL_NOT_VERIFIED')) });
    const { user } = setup({}, api);
    await user.type(email(), 'ana@example.com');
    await user.type(password(), 'Password123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(heading('Check your e-mail')).toHaveFocus();
    expect(notice()).toHaveTextContent(AUTH_MESSAGES.AUTH_EMAIL_NOT_VERIFIED);
    await user.type(screen.getByLabelText(/^6-digit code/), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    // The password was cleared when the mode changed: verification does not sign in.
    expect(api.confirmSignUp).toHaveBeenCalledWith({
      email: 'ana@example.com',
      code: '123456',
      redirect: '/puzzles',
    });
    expect(heading('Sign in')).toBeInTheDocument();
    expect(notice()).toHaveTextContent('Your e-mail is verified. Sign in to continue.');
    expect(email()).toHaveValue('ana@example.com');
  });

  it('a forced reset goes to Forgot password with the e-mail kept', async () => {
    const api = makeApi({ signIn: vi.fn(async () => fail('AUTH_PASSWORD_RESET_REQUIRED')) });
    const { user } = setup({}, api);
    await user.type(email(), 'ana@example.com');
    await user.type(password(), 'Password123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(heading('Reset your password')).toBeInTheDocument();
    expect(notice()).toHaveTextContent('You need to choose a new password.');
    expect(email()).toHaveValue('ana@example.com');
  });

  it('?error shows the message above the form; unverified shows only Sign out', async () => {
    const onSignOut = vi.fn();
    const { user, unmount } = setup({ error: 'provider' });
    expect(screen.getByRole('alert')).toHaveTextContent('Sign-in was cancelled or refused.');
    expect(screen.getByRole('alert')).toHaveFocus();
    expect(email()).toBeInTheDocument();
    unmount();
    setup({ error: 'unverified', onSignOut });
    expect(screen.getByRole('alert')).toHaveTextContent('Your e-mail address must be verified');
    expect(screen.queryByLabelText(/^E-mail/)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Continue with Google' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('show/hide password is a toggle button with a constant name', async () => {
    const { user } = setup();
    const toggle = screen.getByRole('button', { name: 'Show password' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toHaveAttribute('aria-controls', password().id);
    await user.type(password(), 'Secret-Pass1');
    await user.click(toggle);
    expect(password()).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Show password' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(password()).toHaveValue('Secret-Pass1');
  });

  it('works from the keyboard alone: tab order and Enter to submit', async () => {
    const { user, api } = setup();
    await user.tab();
    expect(screen.getByRole('link', { name: 'Continue with Google' })).toHaveFocus();
    await user.tab();
    expect(email()).toHaveFocus();
    await user.keyboard('ana@example.com');
    await user.tab();
    expect(password()).toHaveFocus();
    await user.keyboard('Password123');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Show password' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Sign in' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Forgot password?' })).toHaveFocus();
    await user.click(password());
    await user.keyboard('{Enter}');
    expect(api.signIn).toHaveBeenCalledTimes(1);
  });
});

describe('AuthCard: mode switching', () => {
  it('keeps the e-mail, clears the password, and focuses the new heading', async () => {
    const { user } = setup();
    await user.type(email(), 'ana@example.com');
    await user.type(password(), 'Password123');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(heading('Create your account')).toHaveFocus();
    expect(email()).toHaveValue('ana@example.com');
    expect(password()).toHaveValue('');
    await user.type(password(), 'Another-pass9');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(heading('Sign in')).toHaveFocus();
    expect(email()).toHaveValue('ana@example.com');
    expect(password()).toHaveValue('');
  });

  it('does not move focus on first render (the page owns it)', () => {
    setup();
    expect(heading('Sign in')).not.toHaveFocus();
  });

  it('the h2 variant renders an h2', () => {
    setup({ headingLevel: 'h2', initialMode: 'signUp' });
    expect(heading('Create your account').tagName).toBe('H2');
  });

  it('owns the document title only when asked', async () => {
    const { user } = setup({ ownsTitle: true });
    expect(document.title).toBe('Sign in · Graph Coach');
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }));
    expect(document.title).toBe('Reset your password · Graph Coach');
  });
});

describe('AuthCard: create account', () => {
  const typeSignUp = async (user: ReturnType<typeof userEvent.setup>, pw = 'Password123') => {
    await user.type(email(), 'New@Example.com');
    await user.type(password(), pw);
  };

  it('renders new-password autocomplete, the rules list, the honeypot, and the legal line', () => {
    setup({ initialMode: 'signUp' });
    expect(password()).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByText('or create an account with e-mail')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Password rules' })).toBeInTheDocument();
    expect(screen.getByText(/demonstration site that may be reset/)).toBeInTheDocument();
    const trap = document.querySelector('input[name="website"]')!;
    expect(trap).toHaveAttribute('tabindex', '-1');
    expect(trap).toHaveAttribute('autocomplete', 'off');
    expect(trap.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument();
  });

  it('ticks the rules off as the user types, with text for assistive technology', async () => {
    const { user } = setup({ initialMode: 'signUp' });
    const items = () =>
      within(screen.getByRole('list', { name: 'Password rules' })).getAllByRole('listitem');
    expect(items().map((li) => li.getAttribute('data-met'))).toEqual([
      'false',
      'false',
      'false',
      'false',
    ]);
    expect(items()[0]).toHaveTextContent('At least 10 characters (not met)');
    await user.type(password(), 'abc');
    expect(items().map((li) => li.getAttribute('data-met'))).toEqual([
      'false',
      'true',
      'false',
      'false',
    ]);
    await user.type(password(), 'DEF1234567');
    expect(items().map((li) => li.getAttribute('data-met'))).toEqual([
      'true',
      'true',
      'true',
      'true',
    ]);
    expect(items()[1]).toHaveTextContent('A lower-case letter (met)');
    expect(
      screen.getAllByRole('status').some((s) => s.textContent === 'Password meets all rules'),
    ).toBe(true);
  });

  it('refuses a weak password before calling the server', async () => {
    const { user, api } = setup({ initialMode: 'signUp' });
    await typeSignUp(user, 'short');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(api.signUp).not.toHaveBeenCalled();
    expect(password()).toHaveAccessibleDescription(
      /At least 10 characters, with a lower-case letter/,
    );
    await waitFor(() => expect(password()).toHaveFocus());
  });

  it('sends the normalised e-mail, the password and the guard, then shows Check your e-mail', async () => {
    const { user, api } = setup({ initialMode: 'signUp' });
    await typeSignUp(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(api.signUp).toHaveBeenCalledWith({
      email: 'new@example.com',
      password: 'Password123',
      guard: { website: '', startedAt: 'token' },
    });
    expect(heading('Check your e-mail')).toHaveFocus();
    expect(screen.getByText('We sent a 6-digit code to a***@e***.com.')).toBeInTheDocument();
    const code = screen.getByLabelText(/^6-digit code/);
    expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    expect(code).toHaveAttribute('inputmode', 'numeric');
    expect(code).toHaveAttribute('maxlength', '6');
    expect(code).toHaveAttribute('pattern', '[0-9]*');
  });

  it('sends the honeypot value when something filled it', async () => {
    const { user, api } = setup({ initialMode: 'signUp' });
    await typeSignUp(user);
    await user.type(document.querySelector('input[name="website"]')!, 'spam');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(api.signUp.mock.calls[0]![0].guard.website).toBe('spam');
  });

  it('fetches the guard again at submit when the first fetch failed', async () => {
    const api = makeApi();
    api.start.mockRejectedValueOnce(new Error('down'));
    const { user } = setup({ initialMode: 'signUp' }, api);
    await typeSignUp(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(api.signUp.mock.calls[0]![0].guard.startedAt).toBe('token');
  });

  it('an existing address shows the field error and the three links', async () => {
    const api = makeApi({
      signUp: vi.fn(async () => fail('AUTH_ACCOUNT_EXISTS', { field: 'email' })),
    });
    const { user } = setup({ initialMode: 'signUp' }, api);
    await typeSignUp(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(email()).toHaveAccessibleDescription('An account with this e-mail already exists.');
    expect(email()).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(email()).toHaveFocus());
    expect(screen.getByRole('button', { name: 'Forgot password?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'I have a code' }));
    expect(heading('Check your e-mail')).toBeInTheDocument();
    expect(
      screen.getByText('Enter the 6-digit code we sent to New@Example.com.'),
    ).toBeInTheDocument();
  });

  it('shows a server-side weak-password answer on the password field', async () => {
    const api = makeApi({
      signUp: vi.fn(async () => fail('AUTH_WEAK_PASSWORD', { field: 'password' })),
    });
    const { user } = setup({ initialMode: 'signUp' }, api);
    await typeSignUp(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(password()).toHaveAccessibleDescription(new RegExp(AUTH_MESSAGES.AUTH_WEAK_PASSWORD));
  });

  it('shows the rate limit and the delivery failure', async () => {
    const api = makeApi({
      signUp: vi.fn(async () => fail('AUTH_DELIVERY_FAILED', { field: 'email' })),
    });
    const { user } = setup({ initialMode: 'signUp' }, api);
    await typeSignUp(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(email()).toHaveAccessibleDescription(AUTH_MESSAGES.AUTH_DELIVERY_FAILED);
  });
});

describe('AuthCard: verify e-mail', () => {
  async function toVerify(api: Api, fakeTimers = false) {
    const ctx = setup({ initialMode: 'signUp' }, api, fakeTimers);
    await ctx.user.type(email(), 'new@example.com');
    await ctx.user.type(password(), 'Password123');
    await ctx.user.click(screen.getByRole('button', { name: 'Create account' }));
    await screen.findByRole('heading', { name: 'Check your e-mail' });
    return ctx;
  }

  it('signs in directly with the password still in memory', async () => {
    const api = makeApi({
      confirmSignUp: vi.fn(async () => ({
        ok: true,
        verified: true,
        signedIn: true,
        next: '/puzzles',
      })),
    });
    const { user, onSignedIn } = await toVerify(api);
    await user.type(screen.getByLabelText(/^6-digit code/), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(api.confirmSignUp).toHaveBeenCalledWith({
      email: 'new@example.com',
      code: '123456',
      password: 'Password123',
      redirect: '/puzzles',
    });
    expect(onSignedIn).toHaveBeenCalledWith('/puzzles');
  });

  it('goes to Sign in with a notice when the server could verify but not sign in', async () => {
    const api = makeApi({
      confirmSignUp: vi.fn(async () => ({
        ok: true,
        verified: true,
        signedIn: false,
        notice: 'verifiedSignInFailed',
      })),
    });
    const { user, onSignedIn } = await toVerify(api);
    await user.type(screen.getByLabelText(/^6-digit code/), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(heading('Sign in')).toBeInTheDocument();
    expect(notice()).toHaveTextContent('Your e-mail is verified. Sign in to continue.');
    expect(password()).toHaveValue('');
  });

  it('keeps only digits and six of them', async () => {
    const { user } = await toVerify(makeApi());
    const code = screen.getByLabelText(/^6-digit code/);
    await user.type(code, '12a3-4567');
    expect(code).toHaveValue('123456');
  });

  it('refuses a short code with our message', async () => {
    const { user, api } = await toVerify(makeApi());
    await user.type(screen.getByLabelText(/^6-digit code/), '12');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(api.confirmSignUp).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^6-digit code/)).toHaveAccessibleDescription(
      'Enter the 6-digit code.',
    );
  });

  it('a wrong code is a field error with the code field focused and selected', async () => {
    const api = makeApi({
      confirmSignUp: vi.fn(async () => fail('AUTH_CODE_MISMATCH', { field: 'code' })),
    });
    const { user } = await toVerify(api);
    const code = screen.getByLabelText(/^6-digit code/) as HTMLInputElement;
    await user.type(code, '000000');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(code).toHaveAccessibleDescription("That code isn't right. Check it and try again.");
    await waitFor(() => expect(code).toHaveFocus());
    expect(code.selectionStart).toBe(0);
    expect(code.selectionEnd).toBe(6);
  });

  it('an expired code emphasises Send a new code', async () => {
    const api = makeApi({
      confirmSignUp: vi.fn(async () => fail('AUTH_CODE_EXPIRED', { field: 'code' })),
    });
    const { user } = await toVerify(api);
    await user.type(screen.getByLabelText(/^6-digit code/), '000000');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(screen.getByLabelText(/^6-digit code/)).toHaveAccessibleDescription(
      'That code has expired. Send a new one.',
    );
    expect(screen.getByRole('button', { name: /Send a new code/ })).toHaveClass('font-semibold');
  });

  it('already verified moves to Sign in with the message', async () => {
    const api = makeApi({ confirmSignUp: vi.fn(async () => fail('AUTH_ALREADY_VERIFIED')) });
    const { user } = await toVerify(api);
    await user.type(screen.getByLabelText(/^6-digit code/), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(heading('Sign in')).toBeInTheDocument();
    expect(notice()).toHaveTextContent(AUTH_MESSAGES.AUTH_ALREADY_VERIFIED);
  });

  it('resend: disabled during a 30 s cooldown, enabled after, then cools down again (fake timers)', async () => {
    fakeTimers();
    const { user, api } = await toVerify(makeApi(), true);
    const resend = () => screen.getByRole('button', { name: /Send a new code/ });
    expect(resend()).toHaveTextContent('Send a new code in 30 s');
    expect(resend()).toHaveAttribute('aria-disabled', 'true');
    await user.click(resend());
    expect(api.resendCode).not.toHaveBeenCalled();

    await act(async () => void vi.advanceTimersByTime(10_000));
    expect(resend()).toHaveTextContent('Send a new code in 20 s');
    await act(async () => void vi.advanceTimersByTime(20_000));
    expect(resend()).toHaveTextContent('Send a new code');
    expect(resend()).not.toHaveAttribute('aria-disabled');

    await user.click(resend());
    expect(api.resendCode).toHaveBeenCalledWith({
      email: 'new@example.com',
      guard: { website: '', startedAt: 'token' },
    });
    expect(await screen.findByText('We sent a new code.')).toBeInTheDocument();
    expect(resend()).toHaveTextContent('Send a new code in 30 s');
  });

  it('the cooldown text is not inside a live region', async () => {
    const {} = await toVerify(makeApi());
    const resend = screen.getByRole('button', { name: /Send a new code/ });
    expect(resend.closest('[aria-live]')).toBeNull();
  });

  it('Use a different e-mail returns to Create account with the e-mail kept and the password cleared', async () => {
    const { user } = await toVerify(makeApi());
    await user.click(screen.getByRole('button', { name: 'Use a different e-mail' }));
    expect(heading('Create your account')).toBeInTheDocument();
    expect(email()).toHaveValue('new@example.com');
    expect(password()).toHaveValue('');
  });

  it('Back to sign in works', async () => {
    const { user } = await toVerify(makeApi());
    await user.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(heading('Sign in')).toBeInTheDocument();
  });
});

describe('AuthCard: forgot and reset password', () => {
  async function toReset(api: Api, fakeTimers = false) {
    const ctx = setup({}, api, fakeTimers);
    await ctx.user.type(email(), 'ana@example.com');
    await ctx.user.click(screen.getByRole('button', { name: 'Forgot password?' }));
    await ctx.user.click(screen.getByRole('button', { name: 'Send code' }));
    await screen.findByRole('heading', { name: 'Choose a new password' });
    return ctx;
  }

  it('Forgot password: e-mail field, Google note, honeypot, Send code', async () => {
    const { user, api } = setup();
    await user.type(email(), 'Ana@Example.com');
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }));
    expect(heading('Reset your password')).toHaveFocus();
    expect(screen.getByText("Enter your e-mail and we'll send a code.")).toBeInTheDocument();
    expect(email()).toHaveAttribute('autocomplete', 'username');
    expect(email()).toHaveValue('Ana@Example.com');
    expect(
      screen.getByText(/Signed up with Google\? There is no password to reset/),
    ).toBeInTheDocument();
    expect(document.querySelector('input[name="website"]')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    expect(api.forgotPassword).toHaveBeenCalledWith({
      email: 'ana@example.com',
      guard: { website: '', startedAt: 'token' },
    });
  });

  it('always moves to Choose a new password with the uniform notice', async () => {
    await toReset(makeApi());
    expect(heading('Choose a new password')).toHaveFocus();
    expect(notice()).toHaveTextContent('If an account exists for that address, we sent a code.');
    expect(
      screen.getByText('Enter the code we sent to ana@example.com and a new password.'),
    ).toBeInTheDocument();
    expect(password(/^New password/)).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByRole('list', { name: 'Password rules' })).toBeInTheDocument();
  });

  it('changes the password and returns to Sign in with the e-mail kept and a notice', async () => {
    const api = makeApi();
    const { user } = await toReset(api);
    await user.type(screen.getByLabelText(/^6-digit code/), '123456');
    await user.type(password(/^New password/), 'Another-pass9');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(api.confirmForgotPassword).toHaveBeenCalledWith({
      email: 'ana@example.com',
      code: '123456',
      newPassword: 'Another-pass9',
    });
    expect(heading('Sign in')).toBeInTheDocument();
    expect(notice()).toHaveTextContent('Password changed. Sign in with your new password.');
    expect(email()).toHaveValue('ana@example.com');
    expect(password()).toHaveValue('');
  });

  it('lists several field errors in a summary that links to the fields', async () => {
    const { user, api } = await toReset(makeApi());
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(api.confirmForgotPassword).not.toHaveBeenCalled();
    const summary = screen.getByRole('alert');
    expect(summary).toHaveTextContent('Check the highlighted fields.');
    const links = within(summary).getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', `#${screen.getByLabelText(/^6-digit code/).id}`);
  });

  it('server answers: wrong code on the code field, weak password on the password field', async () => {
    const api = makeApi({
      confirmForgotPassword: vi.fn(async () => fail('AUTH_CODE_MISMATCH', { field: 'code' })),
    });
    const { user } = await toReset(api);
    await user.type(screen.getByLabelText(/^6-digit code/), '000000');
    await user.type(password(/^New password/), 'Another-pass9');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(screen.getByLabelText(/^6-digit code/)).toHaveAccessibleDescription(/isn't right/);
    api.confirmForgotPassword.mockResolvedValueOnce(
      fail('AUTH_WEAK_PASSWORD', { field: 'newPassword' }),
    );
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(password(/^New password/)).toHaveAccessibleDescription(
      new RegExp(AUTH_MESSAGES.AUTH_WEAK_PASSWORD),
    );
  });

  it('Send a new code asks for the reset code again after the cooldown (fake timers)', async () => {
    fakeTimers();
    const { user, api } = await toReset(makeApi(), true);
    expect(api.forgotPassword).toHaveBeenCalledTimes(1);
    const resend = () => screen.getByRole('button', { name: /Send a new code/ });
    expect(resend()).toHaveAttribute('aria-disabled', 'true');
    await act(async () => void vi.advanceTimersByTime(30_000));
    await user.click(resend());
    expect(api.forgotPassword).toHaveBeenCalledTimes(2);
    expect(api.resendCode).not.toHaveBeenCalled();
  });
});

describe('AuthCard: secrets', () => {
  it('never writes the password into the URL, storage, or an attribute of another element', async () => {
    const { user } = setup();
    await user.type(email(), 'ana@example.com');
    await user.type(password(), 'Password123');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(window.location.href).not.toContain('Password123');
    expect(JSON.stringify({ ...localStorage })).not.toContain('Password123');
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('Password123');
    const holders = [...document.querySelectorAll('*')].filter((el) =>
      [...el.attributes].some((a) => a.value.includes('Password123')),
    );
    expect(holders.map((e) => e.tagName)).toEqual(['INPUT']);
  });
});
