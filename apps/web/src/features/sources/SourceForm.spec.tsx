import { UPLOAD_NOTICE } from '@coach/types';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithQuery } from '~/test/render';
import { navigateMock } from '~/test/router-mock';

vi.mock('@tanstack/react-router', async (orig) => (await import('~/test/router-mock')).routerMock(await orig()));

import { SourceForm } from './SourceForm';

const fetchMock = vi.fn();

const SENTENCES = [
  'A database index is a separate structure that speeds up lookups on one or more columns.',
  'Without an index the engine must scan every row of the table to find the matching ones.',
  'A balanced tree keeps its leaves at the same depth so every search costs a similar amount.',
  'Writes become slower because each insert must also update every index that covers the row.',
  'A covering index contains all the columns a query needs and avoids touching the table itself.',
  'Choosing the order of columns in a composite index decides which queries can use its prefix.',
  'Statistics collected by the planner estimate how many rows a condition is expected to match.',
  'A transaction groups several statements so that either all of them apply or none of them do.',
  'Isolation levels define which anomalies a concurrent reader may observe while others are writing.',
  'Replication copies changes to other servers so reads can be spread and failures can be survived.',
];
const LONG_TEXT = SENTENCES.join(' ');

function respond(status: number, body?: unknown) {
  fetchMock.mockResolvedValueOnce(
    new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );
}

const apiError = (status: number, code: string, message: string, details?: unknown) => ({
  error: { code, message, ...(details ? { details } : {}) },
});

async function fill(title = 'Database notes', content = LONG_TEXT) {
  if (title) await userEvent.type(screen.getByRole('textbox', { name: 'Title' }), title);
  const area = screen.getByRole('textbox', { name: 'Content' });
  await userEvent.click(area);
  await userEvent.paste(content);
}

const submit = () => userEvent.click(screen.getByRole('button', { name: 'Create puzzle' }));

beforeEach(() => {
  fetchMock.mockReset();
  navigateMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('SourceForm', () => {
  it('always shows the upload notice from @coach/types above the submit button', () => {
    renderWithQuery(<SourceForm />);
    const notice = screen.getByText(UPLOAD_NOTICE);
    const button = screen.getByRole('button', { name: 'Create puzzle' });
    expect(notice.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows a live word count', async () => {
    renderWithQuery(<SourceForm />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Content' }), 'one two three');
    expect(screen.getByText('3 words')).toBeInTheDocument();
  });

  it('lists the failures of the shared guard and does not send the request', async () => {
    renderWithQuery(<SourceForm />);
    await fill('Short', 'Far too short.');
    await submit();
    const list = await screen.findByRole('list', { name: 'Problems with the text' });
    expect(within(list).getByText(/at least 80 words/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('runs the guard when the content loses focus', async () => {
    renderWithQuery(<SourceForm />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Content' }), 'tiny');
    await userEvent.tab();
    expect(await screen.findByText(/at least 80 words/)).toBeInTheDocument();
  });

  it('asks for a title', async () => {
    renderWithQuery(<SourceForm />);
    await fill('', LONG_TEXT);
    await submit();
    expect(await screen.findByText('Enter a title.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the upload and navigates to the task on 202', async () => {
    respond(202, { taskId: 't-9', sourceId: 'src-9' });
    renderWithQuery(<SourceForm />);
    await fill();
    await submit();
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: '/tasks/$taskId', params: { taskId: 't-9' } }));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/sources');
    expect(JSON.parse(String(init.body))).toEqual({ title: 'Database notes', kind: 'text', content: LONG_TEXT });
  });

  it('on 200 duplicate shows the notice linked to the task, or to the sources when there is none', async () => {
    respond(200, { duplicateOf: 'src-1', taskId: 't-1' });
    const { unmount } = renderWithQuery(<SourceForm />);
    await fill();
    await submit();
    expect(await screen.findByText(/You already added this material/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View the run' })).toHaveAttribute('href', '/tasks/t-1');
    expect(navigateMock).not.toHaveBeenCalled();
    unmount();

    respond(200, { duplicateOf: 'src-1' });
    renderWithQuery(<SourceForm />);
    await fill();
    await submit();
    expect(await screen.findByRole('link', { name: 'See your sources' })).toHaveAttribute('href', '/sources');
  });

  it('lists the 422 SOURCE_REJECTED reasons even though the pre-check passed, keeping the values', async () => {
    respond(
      422,
      apiError(422, 'SOURCE_REJECTED', 'The text was not accepted', {
        reasons: ['low_diversity'],
        issues: [{ path: 'content', message: 'The text looks like repeated or non-text characters.', code: 'low_diversity' }],
      }),
    );
    renderWithQuery(<SourceForm />);
    await fill();
    await submit();
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('The text looks like repeated or non-text characters.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Database notes');
    expect(screen.getByRole('textbox', { name: 'Content' })).toHaveValue(LONG_TEXT);
  });

  it('shows 422 VALIDATION_FAILED issues at their fields', async () => {
    respond(
      422,
      apiError(422, 'VALIDATION_FAILED', 'Invalid', { issues: [{ path: 'title', message: 'Title is too long.' }] }),
    );
    renderWithQuery(<SourceForm />);
    await fill();
    await submit();
    expect(await screen.findByText('Title is too long.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveAccessibleDescription('Title is too long.');
  });

  it('names the window and the reset time on 429 CREATION_LIMIT_REACHED', async () => {
    respond(
      429,
      apiError(429, 'CREATION_LIMIT_REACHED', 'Limit', {
        window: 'hour',
        kind: 'upload',
        resetAt: '2026-10-15T14:30:00.000Z',
        canRedeemCode: true,
      }),
    );
    const { queryClient } = renderWithQuery(<SourceForm />);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    await fill();
    await submit();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('this hour');
    expect(alert).toHaveTextContent('uploads');
    expect(alert).toHaveTextContent(/You can try again at/);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['me', 'allowance'] });
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Database notes');
  });

  it('names "this month" for the monthly window', async () => {
    respond(429, apiError(429, 'CREATION_LIMIT_REACHED', 'Limit', { window: 'month', kind: 'upload', resetAt: '2026-11-01T00:00:00.000Z' }));
    renderWithQuery(<SourceForm />);
    await fill();
    await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('this month');
  });

  it.each([
    ['CREATION_PAUSED', /Puzzle creation is paused/],
    ['PROVIDER_UNAVAILABLE', /language or embedding service is unavailable/],
    ['GRAPH_UNAVAILABLE', /knowledge graph is unavailable/],
  ])('shows the message of a 503 %s and keeps the form', async (code, text) => {
    respond(503, apiError(503, code, 'x'));
    renderWithQuery(<SourceForm />);
    await fill();
    await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    expect(screen.getByRole('textbox', { name: 'Content' })).toHaveValue(LONG_TEXT);
    expect(screen.getByRole('button', { name: 'Create puzzle' })).toBeEnabled();
  });

  it('renders the redeem slot between the notice and the submit button', () => {
    renderWithQuery(<SourceForm redeemSlot={<p>redeem here</p>} />);
    expect(screen.getByText('redeem here')).toBeInTheDocument();
  });
});
