import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BlockedNotice } from './BlockedNotice';

describe('BlockedNotice', () => {
  it('shows the blocked message and a Sign out button, with no navigation', async () => {
    const onSignOut = vi.fn();
    render(<BlockedNotice onSignOut={onSignOut} />);
    const heading = screen.getByRole('heading', { level: 1, name: 'Your account is blocked' });
    expect(heading).toHaveFocus();
    expect(
      screen.getByText('An administrator has blocked this account. You cannot use the site.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});
