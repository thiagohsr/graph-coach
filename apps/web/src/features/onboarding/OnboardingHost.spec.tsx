import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeDto } from '@coach/types';

vi.mock('@tanstack/react-router', async (orig) =>
  (await import('~/test/router-mock')).routerMock(await orig()),
);
vi.mock('~/lib/auth/use-sign-out', () => ({ useSignOut: () => vi.fn() }));

import { AppShell } from '~/components/layout/AppShell';
import { keys } from '~/lib/query/keys';
import { navigateMock } from '~/test/router-mock';
import { renderWithQuery } from '~/test/render';
import { OnboardingHost } from './OnboardingHost';

const fetchMock = vi.fn();
const base: MeDto = {
  id: '2f1f6a52-8c1e-4d6e-9d5f-0a6f6d9c1b11',
  name: 'Ada Lovelace',
  email: 'ada@example.test',
  role: 'learner',
  status: 'active',
  onboardedAt: null,
};

beforeEach(() => {
  fetchMock.mockReset();
  navigateMock.mockReset();
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
});

function mount(user: MeDto = base) {
  return renderWithQuery(
    <OnboardingHost user={user}>
      <AppShell user={user}>
        <p>Page</p>
      </AppShell>
    </OnboardingHost>,
  );
}

const posted = () => fetchMock.mock.calls.filter(([url]) => String(url) === '/api/me/onboarding');

describe('OnboardingHost', () => {
  it('opens on the first load when onboardedAt is null', async () => {
    mount();
    expect(await screen.findByRole('dialog', { name: /Study with a coach/ })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not open when the account has already onboarded', () => {
    mount({ ...base, onboardedAt: '2026-10-01T00:00:00.000Z' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('closes at once on Skip and records "skipped" once', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Skip' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(posted()).toHaveLength(1));
    const init = posted()[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ outcome: 'skipped' });
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('records "completed" and navigates when the last slide is finished', async () => {
    const user = userEvent.setup();
    const { queryClient } = mount();
    queryClient.setQueryData(keys.session, base);
    await screen.findByRole('dialog');
    for (let i = 0; i < 6; i += 1) await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Play a puzzle' }));
    await waitFor(() => expect(posted()).toHaveLength(1));
    expect(JSON.parse((posted()[0]![1] as RequestInit).body as string)).toEqual({
      outcome: 'completed',
    });
    expect(navigateMock).toHaveBeenCalledWith({ to: '/puzzles' });
    await waitFor(() =>
      expect((queryClient.getQueryData(keys.session) as MeDto).onboardedAt).not.toBeNull(),
    );
  });

  it('does not reopen after a failed write in the same session', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(posted()).toHaveLength(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('reopens from "How it works" in the user menu without recording anything', async () => {
    const user = userEvent.setup();
    mount({ ...base, onboardedAt: '2026-10-01T00:00:00.000Z' });
    await user.click(screen.getByRole('button', { name: 'User menu' }));
    await user.click(await screen.findByRole('button', { name: 'How it works' }));
    expect(await screen.findByRole('dialog', { name: /Study with a coach/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(posted()).toHaveLength(0);
  });

  it('a menu reopen after the first-run skip in the same session records nothing more', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(posted()).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'User menu' }));
    await user.click(await screen.findByRole('button', { name: 'How it works' }));
    await user.click(await screen.findByRole('button', { name: 'Skip' }));
    expect(posted()).toHaveLength(1);
  });
});
