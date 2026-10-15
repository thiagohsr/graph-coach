import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithQuery } from '~/test/render';

const getDevUsersFn = vi.fn();
const devLoginFn = vi.fn();
vi.mock('~/lib/auth/session.functions', () => ({
  getDevUsersFn: (...args: unknown[]) => getDevUsersFn(...args),
  devLoginFn: (...args: unknown[]) => devLoginFn(...args),
}));

import { DevAccountPicker } from './DevAccountPicker';

const users = [
  { email: 'ada@example.com', name: 'Ada Learner', role: 'learner' },
  { email: 'rex@example.com', name: 'Rex Reviewer', role: 'reviewer' },
  { email: 'ann@example.com', name: 'Ann Admin', role: 'admin' },
];

beforeEach(() => {
  getDevUsersFn.mockReset().mockResolvedValue(users);
  devLoginFn.mockReset();
});

describe('DevAccountPicker', () => {
  it('lists the demo accounts by name and role under a development banner', async () => {
    renderWithQuery(<DevAccountPicker redirect="/puzzles" onSignedIn={vi.fn()} />);
    expect(screen.getByText('Development sign-in')).toBeInTheDocument();
    for (const u of users) {
      const button = await screen.findByRole('button', { name: new RegExp(u.name) });
      expect(button).toHaveTextContent(u.role);
    }
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('chooses an account: calls devLoginFn with the e-mail and navigates to the redirect', async () => {
    devLoginFn.mockResolvedValue({ ok: true });
    const onSignedIn = vi.fn();
    renderWithQuery(<DevAccountPicker redirect="/coach" onSignedIn={onSignedIn} />);
    await userEvent.click(await screen.findByRole('button', { name: /Rex Reviewer/ }));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith('/coach'));
    expect(devLoginFn).toHaveBeenCalledWith({ data: { email: 'rex@example.com' } });
  });

  it('disables the chosen account and labels it "Signing in…" while the call is pending', async () => {
    let finish!: (v: unknown) => void;
    devLoginFn.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderWithQuery(<DevAccountPicker redirect="/puzzles" onSignedIn={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: /Ada Learner/ }));
    const pending = await screen.findByRole('button', { name: /Signing in…/ });
    expect(pending).toBeDisabled();
    finish({ ok: true });
  });

  it('shows the seed-data message for a 401 INVALID_CREDENTIALS and does not navigate', async () => {
    devLoginFn.mockResolvedValue({ ok: false, code: 'INVALID_CREDENTIALS', message: 'x' });
    const onSignedIn = vi.fn();
    renderWithQuery(<DevAccountPicker redirect="/puzzles" onSignedIn={onSignedIn} />);
    await userEvent.click(await screen.findByRole('button', { name: /Ada Learner/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That account does not exist in the seed data');
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it('shows a service message when the accounts cannot be loaded', async () => {
    getDevUsersFn.mockRejectedValue(new Error('Service unavailable.'));
    renderWithQuery(<DevAccountPicker redirect="/puzzles" onSignedIn={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Service unavailable');
  });
});
