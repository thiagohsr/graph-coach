import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { summaries } from '~/features/play/fixtures';
import { renderWithQuery } from '~/test/render';

vi.mock('@tanstack/react-router', async (orig) => (await import('~/test/router-mock')).routerMock(await orig()));

import { sourceSummaries } from './fixtures';
import { SourceList } from './SourceList';

const fetchMock = vi.fn();
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function serve(sources: unknown, puzzles: unknown[] = []) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/api/sources') return json(200, sources);
    if (url === '/api/puzzles') return json(200, puzzles);
    throw new Error(`unexpected fetch ${url}`);
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('SourceList', () => {
  it('shows the access marker, links every title to its source, newest first', async () => {
    serve(sourceSummaries);
    renderWithQuery(<SourceList />);
    const list = await screen.findByRole('list', { name: 'Sources' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByRole('link', { name: 'Interview notes' })).toHaveAttribute('href', '/sources/src-1');
    expect(within(rows[0]!).getByText(/Yours/)).toBeInTheDocument();
    expect(within(rows[1]!).getByRole('link', { name: 'Shared reading' })).toHaveAttribute('href', '/sources/src-2');
    expect(within(rows[1]!).getByText(/Shared by Bea Souza/)).toBeInTheDocument();
    expect(within(rows[2]!).getByText(/Prompt/)).toBeInTheDocument();
  });

  it('renders "View run" and "Review drafts" only for own rows (review only when awaiting_review)', async () => {
    serve(sourceSummaries);
    renderWithQuery(<SourceList />);
    const rows = within(await screen.findByRole('list', { name: 'Sources' })).getAllByRole('listitem');
    expect(within(rows[0]!).getByRole('link', { name: 'View run' })).toHaveAttribute('href', '/tasks/t-1');
    expect(within(rows[0]!).getByRole('link', { name: 'Review drafts' })).toHaveAttribute('href', '/review?taskId=t-1');
    // shared row: no run, no review
    expect(within(rows[1]!).queryByRole('link', { name: 'View run' })).not.toBeInTheDocument();
    expect(within(rows[1]!).queryByRole('link', { name: 'Review drafts' })).not.toBeInTheDocument();
    // own row that is done: run link, no review link
    expect(within(rows[2]!).getByRole('link', { name: 'View run' })).toBeInTheDocument();
    expect(within(rows[2]!).queryByRole('link', { name: 'Review drafts' })).not.toBeInTheDocument();
  });

  it('shows "Play" only for a puzzle in the playable list', async () => {
    serve(sourceSummaries, [{ ...summaries[0]!, id: 'pz-3' }]);
    renderWithQuery(<SourceList />);
    const rows = within(await screen.findByRole('list', { name: 'Sources' })).getAllByRole('listitem');
    await within(rows[2]!).findByRole('link', { name: 'Play' });
    expect(within(rows[2]!).getByRole('link', { name: 'Play' })).toHaveAttribute('href', '/puzzles/pz-3/play');
    expect(within(rows[1]!).queryByRole('link', { name: 'Play' })).not.toBeInTheDocument();
  });

  it('shows the empty state with a Create a puzzle link', async () => {
    serve([]);
    renderWithQuery(<SourceList />);
    expect(await screen.findByText('You have not created anything yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create a puzzle' })).toHaveAttribute('href', '/sources/new');
  });
});
