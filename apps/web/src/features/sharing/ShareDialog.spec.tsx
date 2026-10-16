import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { keys } from '~/lib/query/keys';
import { renderWithQuery } from '~/test/render';
import { ShareDialog } from './ShareDialog';

const fetchMock = vi.fn();
const json = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status });
const apiError = (code: string, message: string, details?: unknown) => ({ error: { code, message, ...(details ? { details } : {}) } });

type Handler = (init: RequestInit) => Response | Promise<Response>;
let handlers: Record<string, Handler> = {};

const bea = { userId: 'u-2', name: 'Bea Souza', email: 'bea@example.com', withSource: false, sharedAt: '2026-10-12T10:00:00.000Z' };
const carl = { userId: 'u-3', name: 'Carl Dias', email: 'carl@example.com', withSource: true, sharedAt: '2026-10-13T10:00:00.000Z' };

const puzzle = { id: 'pz-1', name: 'My interview notes', sourceShared: true };
const calls = (method: string) => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit).method === method);
const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);

function serve(list: unknown[] = [bea], extra: Record<string, Handler> = {}) {
  handlers = { 'GET /api/puzzles/pz-1/shares': () => json(200, list), ...extra };
}

async function open(props: Partial<{ puzzle: typeof puzzle }> = {}) {
  const view = renderWithQuery(<ShareDialog puzzle={props.puzzle ?? puzzle} ownEmail="me@example.com" />);
  await userEvent.click(screen.getByRole('button', { name: 'Share My interview notes' }));
  return view;
}

beforeEach(() => {
  handlers = {};
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
    const handler = handlers[`${init.method} ${url}`];
    if (!handler) throw new Error(`unexpected fetch ${init.method} ${url}`);
    return handler(init);
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('ShareDialog', () => {
  it('is labelled with the puzzle name and has an e-mail field; the list is fetched when it opens', async () => {
    serve();
    await open();
    expect(await screen.findByRole('dialog', { name: 'Share My interview notes' })).toBeInTheDocument();
    const field = screen.getByLabelText('E-mail address');
    expect(field).toHaveAttribute('type', 'email');
    await screen.findByText('Bea Souza');
    expect(calls('GET')).toHaveLength(1);
  });

  it('shows each row with name, address, source option and date', async () => {
    serve([bea, carl]);
    await open();
    const rows = await screen.findAllByRole('listitem');
    expect(within(rows[0]!).getByText('Bea Souza')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('bea@example.com')).toBeInTheDocument();
    expect(within(rows[0]!).getByText(new Date(bea.sharedAt).toLocaleDateString())).toBeInTheDocument();
    expect(within(rows[0]!).getByRole('checkbox', { name: 'Share the source with Bea Souza' })).not.toBeChecked();
    expect(within(rows[1]!).getByRole('checkbox', { name: 'Share the source with Carl Dias' })).toBeChecked();
  });

  it('shows "Not shared with anyone yet." for an empty list', async () => {
    serve([]);
    await open();
    expect(await screen.findByText('Not shared with anyone yet.')).toBeInTheDocument();
  });

  it('adds an address with PUT { email, withSource }, shows the new row, clears the field, and announces it', async () => {
    serve([bea], { 'PUT /api/puzzles/pz-1/shares': () => json(200, carl) });
    const { queryClient } = await open();
    await screen.findByText('Bea Souza');
    await userEvent.type(screen.getByLabelText('E-mail address'), '  Carl@Example.com ');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Share the source too' }));
    await userEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(await screen.findByText('Carl Dias')).toBeInTheDocument();
    expect(bodyOf(calls('PUT')[0]!)).toEqual({ email: 'carl@example.com', withSource: true });
    expect(screen.getByLabelText('E-mail address')).toHaveValue('');
    expect(screen.getByRole('status')).toHaveTextContent('Shared with Carl Dias.');
    expect(queryClient.getQueryData(keys.puzzles.shares('pz-1'))).toHaveLength(2);
  });

  it('refuses a malformed, own, or already-shared address before any request', async () => {
    serve();
    await open();
    await screen.findByText('Bea Souza');
    const field = screen.getByLabelText('E-mail address');
    await userEvent.type(field, 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(await screen.findByText('Enter an e-mail address.')).toBeInTheDocument();
    await userEvent.clear(field);
    await userEvent.type(field, 'Me@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(await screen.findByText('You already own this puzzle.')).toBeInTheDocument();
    await userEvent.clear(field);
    await userEvent.type(field, 'bea@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(await screen.findByText(/Already shared with Bea Souza/)).toBeInTheDocument();
    expect(calls('PUT')).toHaveLength(0);
    expect(field).toHaveValue('bea@example.com');
  });

  it('toggling a row sends PUT with that row address and the new value', async () => {
    serve([bea], { 'PUT /api/puzzles/pz-1/shares': () => json(200, { ...bea, withSource: true }) });
    await open();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Share the source with Bea Souza' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Share the source with Bea Souza' })).toBeChecked());
    expect(bodyOf(calls('PUT')[0]!)).toEqual({ email: 'bea@example.com', withSource: true });
  });

  it('Revoke asks for confirmation, then calls DELETE with the userId and removes the row', async () => {
    serve([bea, carl], { 'DELETE /api/puzzles/pz-1/shares/u-2': () => json(204) });
    await open();
    await userEvent.click(await screen.findByRole('button', { name: 'Revoke Bea Souza' }));
    expect(screen.getByText('Bea Souza will lose the puzzle and its source at once.')).toBeInTheDocument();
    expect(calls('DELETE')).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm revoke Bea Souza' }));
    await waitFor(() => expect(screen.queryByText('bea@example.com')).not.toBeInTheDocument());
    expect(calls('DELETE')).toHaveLength(1);
    expect(screen.getByText('carl@example.com')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Revoked Bea Souza.');
  });

  it('cancelling the revoke confirmation sends nothing', async () => {
    serve();
    await open();
    await userEvent.click(await screen.findByRole('button', { name: 'Revoke Bea Souza' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(calls('DELETE')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Revoke Bea Souza' })).toBeInTheDocument();
  });

  it('disables the source option with an explanation when the puzzle has no source', async () => {
    serve();
    await open({ puzzle: { ...puzzle, sourceShared: false } });
    await screen.findByText('Bea Souza');
    expect(screen.getByRole('checkbox', { name: 'Share the source too' })).toBeDisabled();
    expect(screen.getByText('This puzzle has no source')).toBeInTheDocument();
  });

  it('shows the 422 email message next to the field and keeps the typed address', async () => {
    serve([bea], {
      'PUT /api/puzzles/pz-1/shares': () =>
        json(422, apiError('VALIDATION_FAILED', 'Invalid', { issues: [{ path: 'email', message: 'Nobody has signed in with that address yet.' }] })),
    });
    await open();
    await screen.findByText('Bea Souza');
    await userEvent.type(screen.getByLabelText('E-mail address'), 'ghost@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Share' }));
    const message = await screen.findByText('Nobody has signed in with that address yet. Ask them to sign in once.');
    expect(screen.getByLabelText('E-mail address')).toHaveValue('ghost@example.com');
    expect(screen.getByLabelText('E-mail address').getAttribute('aria-describedby')).toContain(message.id);
  });

  it('shows the 422 withSource message at the checkbox', async () => {
    serve([bea], {
      'PUT /api/puzzles/pz-1/shares': () =>
        json(422, apiError('VALIDATION_FAILED', 'Invalid', { issues: [{ path: 'withSource', message: 'no source' }] })),
    });
    await open();
    await screen.findByText('Bea Souza');
    await userEvent.type(screen.getByLabelText('E-mail address'), 'carl@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(await screen.findByText('This puzzle has no source to share.')).toBeInTheDocument();
    expect(screen.getByLabelText('E-mail address')).toHaveValue('carl@example.com');
  });

  it('shows the 409 message and the 429 retry time inline', async () => {
    serve([bea], {
      'PUT /api/puzzles/pz-1/shares': () => json(409, apiError('CONFLICT', 'The puzzle is not published')),
    });
    await open();
    await screen.findByText('Bea Souza');
    await userEvent.type(screen.getByLabelText('E-mail address'), 'carl@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(await screen.findByText('This puzzle is not published yet, so it cannot be shared.')).toBeInTheDocument();

    handlers['PUT /api/puzzles/pz-1/shares'] = () =>
      json(429, apiError('RATE_LIMITED', 'Too many', { retryAfterSeconds: 60, resetAt: '2026-10-12T10:30:00.000Z' }));
    await userEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(await screen.findByText('You are sharing too fast.')).toBeInTheDocument();
    expect(screen.getByText(/You can try again at/)).toBeInTheDocument();
    expect(screen.getByLabelText('E-mail address')).toHaveValue('carl@example.com');
  });

  it('shows ErrorState with Retry when the list cannot be loaded', async () => {
    serve([], { 'GET /api/puzzles/pz-1/shares': () => json(503, apiError('SQL_UNAVAILABLE', 'down')) });
    await open();
    expect(await screen.findByText('Accounts are unavailable.')).toBeInTheDocument();
    handlers['GET /api/puzzles/pz-1/shares'] = () => json(200, [bea]);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Bea Souza')).toBeInTheDocument();
  });
});
