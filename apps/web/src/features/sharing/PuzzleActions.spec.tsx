import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { summaries } from '~/features/play/fixtures';
import type { PuzzleSummary } from '~/lib/api/gameplay-schemas';
import { keys } from '~/lib/query/keys';
import { renderWithQuery } from '~/test/render';
import { PuzzleActions } from './PuzzleActions';

const fetchMock = vi.fn();
const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });
const apiError = (code: string, message: string) => ({ error: { code, message } });

const base = summaries[0] as PuzzleSummary;
const owned: PuzzleSummary = {
  ...base,
  id: 'pz-own',
  name: 'Mine',
  access: 'owner',
  visibility: 'private',
  origin: 'upload',
  sourceShared: true,
};

type Handler = () => Response;
let handlers: Record<string, Handler> = {};

beforeEach(() => {
  handlers = {};
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
    const handler = handlers[`${init.method} ${url}`];
    if (!handler) throw new Error(`unexpected fetch ${init.method} ${url}`);
    return handler();
  });
  vi.stubGlobal('fetch', fetchMock);
});

const render = (puzzle: PuzzleSummary, role: 'learner' | 'reviewer' | 'admin') =>
  renderWithQuery(<PuzzleActions puzzle={puzzle} role={role} ownEmail="me@example.com" />);

describe('PuzzleActions', () => {
  it('a learner owner sees Share and no visibility button', () => {
    render(owned, 'learner');
    expect(screen.getByRole('button', { name: 'Share Mine' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Make (public|private)/ })).not.toBeInTheDocument();
  });

  it('a reviewer or admin owner sees "Make public" on a private puzzle and "Make private" on a public one', () => {
    for (const role of ['reviewer', 'admin'] as const) {
      const { unmount } = render(owned, role);
      expect(screen.getByRole('button', { name: 'Make public Mine' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Share Mine' })).toBeInTheDocument();
      unmount();
      const second = render({ ...owned, visibility: 'public' }, role);
      expect(screen.getByRole('button', { name: 'Make private Mine' })).toBeInTheDocument();
      second.unmount();
    }
  });

  it('shows no control at all for a shared or public puzzle the viewer does not own, whatever the role', () => {
    for (const access of ['shared', 'public'] as const) {
      for (const role of ['learner', 'reviewer', 'admin'] as const) {
        const { container, unmount } = render({ ...owned, access }, role);
        expect(container).toBeEmptyDOMElement();
        unmount();
      }
    }
  });

  it('confirms before changing visibility, states that the source is never made public, then refreshes the list', async () => {
    handlers['POST /api/puzzles/pz-own/visibility'] = () =>
      json(200, { id: 'pz-own', visibility: 'public', origin: 'upload' });
    const { queryClient } = render(owned, 'reviewer');
    queryClient.setQueryData(keys.puzzles.list, [owned]);
    await userEvent.click(screen.getByRole('button', { name: 'Make public Mine' }));
    expect(screen.getByText(/source is never made public/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Make public' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)).toEqual({
      visibility: 'public',
    });
    await waitFor(() =>
      expect(queryClient.getQueryState(keys.puzzles.list)?.isInvalidated).toBe(true),
    );
  });

  it('shows an inline alert for a 403 or 404 from the visibility endpoint', async () => {
    handlers['POST /api/puzzles/pz-own/visibility'] = () =>
      json(403, apiError('FORBIDDEN', 'Your role cannot do this.'));
    render(owned, 'reviewer');
    await userEvent.click(screen.getByRole('button', { name: 'Make public Mine' }));
    await userEvent.click(screen.getByRole('button', { name: 'Make public' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your role cannot do this.');

    handlers['POST /api/puzzles/pz-own/visibility'] = () =>
      json(404, apiError('NOT_FOUND', 'Puzzle not found'));
    await userEvent.click(screen.getByRole('button', { name: 'Make public Mine' }));
    await userEvent.click(screen.getByRole('button', { name: 'Make public' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('This puzzle is no longer available.'),
    );
  });
});
