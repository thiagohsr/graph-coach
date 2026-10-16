import { PROMPT_ORIGIN_NOTICE } from '@coach/types';
import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { summaries } from '~/features/play/fixtures';
import { renderWithQuery } from '~/test/render';

vi.mock('@tanstack/react-router', async (orig) => (await import('~/test/router-mock')).routerMock(await orig()));
// RouteFocus reads router state; its behaviour is covered with the routes.
vi.mock('~/components/a11y/RouteFocus', () => ({ RouteFocus: () => null }));

import { promptDetail, uploadDetail } from './fixtures';
import { SourceView } from './SourceView';

const fetchMock = vi.fn();

function route(handlers: Record<string, () => Response>) {
  fetchMock.mockImplementation(async (url: string) => {
    const handler = handlers[url];
    if (!handler) throw new Error(`unexpected fetch ${url}`);
    return handler();
  });
}
const json = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status });

const playable = [{ ...summaries[0]!, id: 'pz-1' }];

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('SourceView', () => {
  it('shows title, kind, date, "Yours", and the content as read-only text with no edit control', async () => {
    route({ '/api/sources/src-1': json(200, uploadDetail), '/api/puzzles': json(200, playable) });
    renderWithQuery(<SourceView sourceId="src-1" />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Interview notes' })).toBeInTheDocument();
    expect(screen.getByText(/Yours/)).toBeInTheDocument();
    expect(screen.getByText(/Markdown/)).toBeInTheDocument();
    expect(screen.getByLabelText('Source text')).toHaveTextContent('First line of the notes.');
    expect(screen.getByLabelText('Source text')).toHaveTextContent('Second line, with **markdown** kept as text.');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('marks a shared source "Shared by <ownerName>"', async () => {
    route({
      '/api/sources/src-1': json(200, { ...uploadDetail, access: 'shared', ownerName: 'Bea Souza' }),
      '/api/puzzles': json(200, []),
    });
    renderWithQuery(<SourceView sourceId="src-1" />);
    expect(await screen.findByText(/Shared by Bea Souza/)).toBeInTheDocument();
  });

  it('links Play only when the puzzle is in the playable list', async () => {
    route({ '/api/sources/src-1': json(200, uploadDetail), '/api/puzzles': json(200, playable) });
    const first = renderWithQuery(<SourceView sourceId="src-1" />);
    expect(await screen.findByRole('link', { name: 'Play' })).toHaveAttribute('href', '/puzzles/pz-1/play');
    first.unmount();

    route({ '/api/sources/src-1': json(200, uploadDetail), '/api/puzzles': json(200, []) });
    renderWithQuery(<SourceView sourceId="src-1" />);
    await screen.findByRole('heading', { level: 1, name: 'Interview notes' });
    expect(screen.queryByRole('link', { name: 'Play' })).not.toBeInTheDocument();
  });

  it('shows the brief of a prompt as a description list with the origin notice, and no passage text', async () => {
    route({ '/api/sources/src-3': json(200, promptDetail), '/api/puzzles': json(200, []) });
    renderWithQuery(<SourceView sourceId="src-3" />);
    expect(await screen.findByRole('heading', { level: 2, name: 'What was asked for' })).toBeInTheDocument();
    expect(screen.getByText(PROMPT_ORIGIN_NOTICE)).toBeInTheDocument();
    expect(screen.getByText('B-tree indexes')).toBeInTheDocument();
    expect(screen.getByText('page splits')).toBeInTheDocument();
    expect(screen.getByText('Medium')).toBeInTheDocument();
    expect(screen.queryByLabelText('Source text')).not.toBeInTheDocument();
  });

  it('renders the Not found state and no content on 404, and refreshes the source list', async () => {
    route({
      '/api/sources/src-9': json(404, { error: { code: 'NOT_FOUND', message: 'Not found' } }),
      '/api/puzzles': json(200, []),
    });
    const { queryClient } = renderWithQuery(<SourceView sourceId="src-9" />);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    expect(await screen.findByRole('heading', { name: 'Not found' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Source text')).not.toBeInTheDocument();
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['sources', 'list'] }));
  });

  it('reports a response with neither content nor brief as a contract error', async () => {
    const { content: _c, ...bare } = uploadDetail;
    route({ '/api/sources/src-1': json(200, bare), '/api/puzzles': json(200, []) });
    renderWithQuery(<SourceView sourceId="src-1" />);
    expect(await screen.findByText(/no text and no brief/)).toBeInTheDocument();
  });
});
