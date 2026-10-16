import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithQuery } from '~/test/render';
import { AccountPage } from './AccountPage';

// RouteFocus reads router state; its behaviour is covered with the routes.
vi.mock('~/components/a11y/RouteFocus', () => ({ RouteFocus: () => null }));

const fetchMock = vi.fn();
const json = (status: number, body?: unknown) => new Response(JSON.stringify(body), { status });
const user = { name: 'Ana Lima', email: 'ana@example.com' };
const RESETS = '2026-11-01T00:00:00.000Z';

const allowance = {
  upload: { used: 1, allowance: 3, bonus: 2, resetsAt: RESETS },
  prompt: { used: 4, allowance: 5, bonus: 0, resetsAt: RESETS },
  hourly: { used: 1, limit: 4 },
  creationEnabled: true,
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

function serve(body: unknown, status = 200) {
  fetchMock.mockImplementation(async () => json(status, body));
}

describe('AccountPage', () => {
  it('shows the user name and e-mail, and a row per kind with used, allowance, bonus, and reset date', async () => {
    serve(allowance);
    renderWithQuery(<AccountPage user={user} />);
    expect(screen.getByText('Ana Lima')).toBeInTheDocument();
    expect(screen.getByText('ana@example.com')).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: 'This month' });
    const prompt = within(table).getByRole('row', { name: /Prompt puzzles/ });
    expect(
      within(prompt)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['4', '5', '0', new Date(RESETS).toLocaleDateString()]);
    const upload = within(table).getByRole('row', { name: /Uploads/ });
    expect(
      within(upload)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['1', '3', '2', new Date(RESETS).toLocaleDateString()]);
  });

  it('shows the hourly usage', async () => {
    serve(allowance);
    renderWithQuery(<AccountPage user={user} />);
    expect(await screen.findByText('1 of 4 creations this hour')).toBeInTheDocument();
  });

  it('shows "Limit lifted until" when the hourly limit is lifted', async () => {
    serve({ ...allowance, hourly: { used: 9, limit: 4, liftedUntil: '2999-01-01T00:00:00.000Z' } });
    renderWithQuery(<AccountPage user={user} />);
    expect(await screen.findByText(/limit lifted until/i)).toBeInTheDocument();
  });

  it('shows "Unlimited" in place of the numbers for a kind whose allowance is null', async () => {
    serve({ ...allowance, prompt: { used: 7, allowance: null, bonus: 0, resetsAt: RESETS } });
    renderWithQuery(<AccountPage user={user} />);
    const table = await screen.findByRole('table', { name: 'This month' });
    const prompt = within(table).getByRole('row', { name: /Prompt puzzles/ });
    expect(within(prompt).getByText('Unlimited')).toBeInTheDocument();
    expect(within(prompt).queryByText('7')).not.toBeInTheDocument();
  });

  it('says creation is paused when it is disabled', async () => {
    serve({ ...allowance, creationEnabled: false });
    renderWithQuery(<AccountPage user={user} />);
    expect(await screen.findByText('Puzzle creation is paused.')).toBeInTheDocument();
  });

  it('has the redeem form, a loading skeleton, and an error state with Retry', async () => {
    serve({ error: { code: 'SQL_UNAVAILABLE', message: 'down' } }, 503);
    renderWithQuery(<AccountPage user={user} />);
    expect(screen.getByLabelText('Loading allowance')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByLabelText('Code')).toBeInTheDocument();
  });
});
