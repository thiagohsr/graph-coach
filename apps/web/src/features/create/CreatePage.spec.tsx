import { PROMPT_ORIGIN_NOTICE, UPLOAD_NOTICE } from '@coach/types';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { navigateMock } from '~/test/router-mock';
import { renderWithQuery } from '~/test/render';

vi.mock('@tanstack/react-router', async (orig) =>
  (await import('~/test/router-mock')).routerMock(await orig()),
);
// RouteFocus reads router state; its behaviour is covered with the routes.
vi.mock('~/components/a11y/RouteFocus', () => ({ RouteFocus: () => null }));

import { CreatePage } from './CreatePage';

const fetchMock = vi.fn();
const json = (status: number, body?: unknown) => new Response(JSON.stringify(body), { status });
const apiError = (code: string, message: string, details?: unknown) => ({
  error: { code, message, ...(details ? { details } : {}) },
});

const RESETS = '2026-11-01T00:00:00.000Z';
const resetText = new Date(RESETS).toLocaleDateString();
const available = {
  upload: { used: 1, allowance: 3, bonus: 0, resetsAt: RESETS },
  prompt: { used: 0, allowance: 5, bonus: 0, resetsAt: RESETS },
  hourly: { used: 0, limit: 4 },
  creationEnabled: true,
};

type Handler = (init: RequestInit) => Response;
let handlers: Record<string, Handler> = {};
const serve = (allowance: unknown, extra: Record<string, Handler> = {}) => {
  handlers = { 'GET /api/me/allowance': () => json(200, allowance), ...extra };
};
const calls = (method: string, url: string) =>
  fetchMock.mock.calls.filter(([u, init]) => u === url && (init as RequestInit).method === method);

beforeEach(() => {
  handlers = {};
  navigateMock.mockReset();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
    const handler = handlers[`${init.method} ${url}`];
    if (!handler) throw new Error(`unexpected fetch ${init.method} ${url}`);
    return handler(init);
  });
  vi.stubGlobal('fetch', fetchMock);
});

async function choose(name: string) {
  await userEvent.click(await screen.findByRole('button', { name }));
}

describe('CreatePage', () => {
  it('shows both choices with their names, allowance lines, and the difference lines', async () => {
    serve(available);
    renderWithQuery(<CreatePage />);
    const group = screen.getByRole('group', { name: 'How do you want to create a puzzle?' });
    expect(
      within(group).getByRole('heading', { name: 'Describe what to practise' }),
    ).toBeInTheDocument();
    expect(
      within(group).getByRole('heading', { name: 'Use your own material' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(`2 of 3 left this month · Resets on ${resetText}`),
    ).toBeInTheDocument();
    expect(screen.getByText(`5 of 5 left this month · Resets on ${resetText}`)).toBeInTheDocument();
    expect(screen.getByText(PROMPT_ORIGIN_NOTICE)).toBeInTheDocument();
    expect(
      screen.getByText(
        'Questions are checked against your material and show the passage they came from.',
      ),
    ).toBeInTheDocument();
  });

  it('available: the prompt choice shows its fields; a valid submit posts the prompt body and goes to the task', async () => {
    serve(available, {
      'POST /api/sources': () => json(202, { taskId: 't-9', sourceId: 'src-9' }),
    });
    renderWithQuery(<CreatePage />);
    await screen.findByText(/2 of 3 left/);
    await choose('Describe what to practise');
    expect(screen.getByLabelText('Subject')).toBeInTheDocument();
    expect(screen.getByLabelText('Focus (optional)')).toBeInTheDocument();
    expect(screen.getByLabelText('Difficulty')).toBeInTheDocument();
    expect(screen.getByLabelText('Number of sentences')).toHaveAttribute('min', '3');
    expect(screen.getByLabelText('Number of sentences')).toHaveAttribute('max', '10');
    await userEvent.type(screen.getByLabelText('Title'), 'Trees');
    await userEvent.type(screen.getByLabelText('Subject'), 'B-tree indexes');
    await userEvent.click(screen.getByRole('button', { name: 'Create puzzle' }));
    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith({
        to: '/tasks/$taskId',
        params: { taskId: 't-9' },
      }),
    );
    expect(
      JSON.parse((calls('POST', '/api/sources')[0]![1] as RequestInit).body as string),
    ).toEqual({
      title: 'Trees',
      kind: 'prompt',
      brief: { subject: 'B-tree indexes', difficulty: 'medium', sentences: 5 },
    });
  });

  it('refuses a brief the shared rules reject, before any request, keeping the values', async () => {
    serve(available);
    renderWithQuery(<CreatePage />);
    await screen.findByText(/2 of 3 left/);
    await choose('Describe what to practise');
    await userEvent.type(screen.getByLabelText('Title'), 'Trees');
    await userEvent.type(screen.getByLabelText('Subject'), '12');
    await userEvent.click(screen.getByRole('button', { name: 'Create puzzle' }));
    expect(await screen.findByText(/Name the subject in a few words/)).toBeInTheDocument();
    expect(calls('POST', '/api/sources')).toHaveLength(0);
    expect(screen.getByLabelText('Subject')).toHaveValue('12');
  });

  it('the upload choice shows the upload form with the upload notice', async () => {
    serve(available);
    renderWithQuery(<CreatePage />);
    await screen.findByText(/2 of 3 left/);
    await choose('Use your own material');
    expect(screen.getByText(UPLOAD_NOTICE)).toBeInTheDocument();
    expect(screen.getByLabelText('Content')).toBeInTheDocument();
  });

  it('exhausted: shows the reset date and the redeem field, has no submit button, and leaves the other choice usable', async () => {
    serve({ ...available, upload: { used: 3, allowance: 3, bonus: 0, resetsAt: RESETS } });
    renderWithQuery(<CreatePage />);
    expect(
      await screen.findByText(`Nothing left this month. Resets on ${resetText}.`),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Code')).toBeInTheDocument();
    await choose('Use your own material');
    expect(screen.queryByRole('button', { name: 'Create puzzle' })).not.toBeInTheDocument();
    await choose('Describe what to practise');
    expect(screen.getByRole('button', { name: 'Create puzzle' })).toBeEnabled();
  });

  it('after a successful redemption the exhausted choice shows its submit button again, without a reload', async () => {
    let current: unknown = {
      ...available,
      upload: { used: 3, allowance: 3, bonus: 0, resetsAt: RESETS },
    };
    handlers = {
      'GET /api/me/allowance': () => json(200, current),
      'POST /api/me/codes/redeem': () => {
        current = { ...available, upload: { used: 3, allowance: 3, bonus: 2, resetsAt: RESETS } };
        return json(200, { sourceRuns: 2, promptRuns: 0 });
      },
    };
    renderWithQuery(<CreatePage />);
    await screen.findByText(`Nothing left this month. Resets on ${resetText}.`);
    await choose('Use your own material');
    expect(screen.queryByRole('button', { name: 'Create puzzle' })).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Code'), 'GIFT-1');
    await userEvent.click(screen.getByRole('button', { name: 'Redeem' }));
    expect(await screen.findByRole('button', { name: 'Create puzzle' })).toBeEnabled();
    expect(screen.getByText('+2 uploads')).toBeInTheDocument();
  });

  it('paused: both choices say so and offer no submit and no redeem field', async () => {
    serve({ ...available, creationEnabled: false });
    renderWithQuery(<CreatePage />);
    await waitFor(() => expect(screen.getAllByText('Puzzle creation is paused.')).toHaveLength(2));
    await choose('Describe what to practise');
    await choose('Use your own material');
    expect(screen.queryByRole('button', { name: 'Create puzzle' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Code')).not.toBeInTheDocument();
  });

  it('hourly limit: both submits are replaced by one message and one redeem field', async () => {
    serve({ ...available, hourly: { used: 4, limit: 4 } });
    renderWithQuery(<CreatePage />);
    await waitFor(() => expect(screen.getAllByText('Hourly limit reached.')).toHaveLength(2));
    expect(screen.getAllByLabelText('Code')).toHaveLength(1);
    await choose('Use your own material');
    expect(screen.queryByRole('button', { name: 'Create puzzle' })).not.toBeInTheDocument();
  });

  it('429 CREATION_LIMIT_REACHED shows window, kind, and reset time, and the redeem field only when allowed', async () => {
    const limit = (canRedeemCode: boolean) =>
      json(
        429,
        apiError('CREATION_LIMIT_REACHED', 'Limit', {
          retryAfterSeconds: 600,
          resetAt: '2026-10-15T12:30:00.000Z',
          window: 'hour',
          kind: 'prompt',
          canRedeemCode,
        }),
      );
    serve(available, { 'POST /api/sources': () => limit(true) });
    renderWithQuery(<CreatePage />);
    await screen.findByText(/2 of 3 left/);
    await choose('Describe what to practise');
    await userEvent.type(screen.getByLabelText('Title'), 'Trees');
    await userEvent.type(screen.getByLabelText('Subject'), 'B-tree indexes');
    await userEvent.click(screen.getByRole('button', { name: 'Create puzzle' }));
    expect(
      await screen.findByText('You have reached the limit for prompt puzzles this hour.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/You can try again at/)).toBeInTheDocument();
    expect(screen.getByLabelText('Code')).toBeInTheDocument();
    expect(screen.getByLabelText('Subject')).toHaveValue('B-tree indexes');

    handlers['POST /api/sources'] = () => limit(false);
    await userEvent.click(screen.getByRole('button', { name: 'Create puzzle' }));
    await waitFor(() => expect(screen.queryByLabelText('Code')).not.toBeInTheDocument());
    expect(
      screen.getByText('You have reached the limit for prompt puzzles this hour.'),
    ).toBeInTheDocument();
  });

  it('503 CREATION_PAUSED shows the paused message', async () => {
    serve(available, {
      'POST /api/sources': () => json(503, apiError('CREATION_PAUSED', 'paused')),
    });
    renderWithQuery(<CreatePage />);
    await screen.findByText(/2 of 3 left/);
    await choose('Describe what to practise');
    await userEvent.type(screen.getByLabelText('Title'), 'Trees');
    await userEvent.type(screen.getByLabelText('Subject'), 'B-tree indexes');
    await userEvent.click(screen.getByRole('button', { name: 'Create puzzle' }));
    expect(
      await screen.findByText('Puzzle creation is paused. Try again later.'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Code')).not.toBeInTheDocument();
  });

  it('keeps the forms usable when the allowance cannot be loaded', async () => {
    serve(available, {
      'GET /api/me/allowance': () => json(503, apiError('SQL_UNAVAILABLE', 'down')),
    });
    renderWithQuery(<CreatePage />);
    await choose('Describe what to practise');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Create puzzle' })).toBeEnabled(),
    );
  });

  it('disables submit until the allowance has loaded', async () => {
    let release: (r: Response) => void = () => {};
    handlers = {
      'GET /api/me/allowance': () =>
        new Promise<Response>((resolve) => (release = resolve)) as never,
    };
    fetchMock.mockImplementation(async (url: string, init: RequestInit) =>
      handlers[`${init.method} ${url}`]!(init),
    );
    renderWithQuery(<CreatePage initialChoice="prompt" />);
    expect(screen.getByRole('button', { name: 'Create puzzle' })).toBeDisabled();
    release(json(200, available));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Create puzzle' })).toBeEnabled(),
    );
  });
});
