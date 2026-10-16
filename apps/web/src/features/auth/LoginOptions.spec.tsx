import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LoginOptions } from './LoginOptions';

describe('LoginOptions (provider mode)', () => {
  it('shows two links to /auth/login carrying the redirect, and no credential field', () => {
    render(<LoginOptions redirect="/coach?x=1" onSignOut={vi.fn()} />);
    const google = screen.getByRole('link', { name: 'Continue with Google' });
    const email = screen.getByRole('link', { name: 'Continue with e-mail' });
    expect(google).toHaveAttribute('href', '/auth/login?provider=google&redirect=%2Fcoach%3Fx%3D1');
    expect(email).toHaveAttribute('href', '/auth/login?provider=email&redirect=%2Fcoach%3Fx%3D1');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it.each([
    ['state', 'Sign-in could not be completed. Please try again.'],
    ['provider', 'Sign-in was cancelled or refused.'],
    ['exchange', 'Sign-in failed. Please try again in a moment.'],
    ['account', 'We could not set up your account. Please try again.'],
  ] as const)('error=%s shows its message together with the sign-in options', (error, message) => {
    render(<LoginOptions redirect="/puzzles" error={error} onSignOut={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('link', { name: 'Continue with Google' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue with e-mail' })).toBeInTheDocument();
  });

  it('error=unverified shows the verification message with Sign out and no sign-in options', async () => {
    const onSignOut = vi.fn();
    render(<LoginOptions redirect="/puzzles" error="unverified" onSignOut={onSignOut} />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Your e-mail address must be verified before you can use the site.',
    );
    expect(screen.queryByRole('link', { name: 'Continue with Google' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Continue with e-mail' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('moves focus to the error message', () => {
    render(<LoginOptions redirect="/puzzles" error="provider" onSignOut={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveFocus();
  });
});
