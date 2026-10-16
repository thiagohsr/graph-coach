import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { keys } from '~/lib/query/keys';
import { renderWithQuery } from '~/test/render';
import { RedeemCodeForm } from './RedeemCodeForm';

const fetchMock = vi.fn();
const json = (status: number, body?: unknown) => new Response(JSON.stringify(body), { status });
const apiError = (code: string, message: string, details?: unknown) => ({ error: { code, message, ...(details ? { details } : {}) } });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

async function redeem(text: string) {
  await userEvent.type(screen.getByLabelText('Code'), text);
  await userEvent.click(screen.getByRole('button', { name: 'Redeem' }));
}

describe('RedeemCodeForm', () => {
  it('has an off-autocomplete field named Code and a Redeem button', () => {
    renderWithQuery(<RedeemCodeForm />);
    expect(screen.getByLabelText('Code')).toHaveAttribute('autocomplete', 'off');
  });

  it('posts the trimmed code, lists only what was granted, clears the field, and invalidates the allowance', async () => {
    fetchMock.mockResolvedValue(json(200, { sourceRuns: 2, promptRuns: 0, limitsLiftedUntil: '2026-10-16T00:00:00.000Z' }));
    const onGranted = vi.fn();
    const { queryClient } = renderWithQuery(<RedeemCodeForm onGranted={onGranted} />);
    queryClient.setQueryData(keys.me.allowance, {});
    await redeem('  ABC-123  ');
    const status = await screen.findByRole('status');
    await waitFor(() => expect(status).toHaveTextContent('+2 uploads'));
    expect(status).toHaveTextContent(/Hourly limit lifted until/);
    expect(status).not.toHaveTextContent('prompt puzzles');
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ code: 'ABC-123' });
    expect(screen.getByLabelText('Code')).toHaveValue('');
    expect(queryClient.getQueryState(keys.me.allowance)?.isInvalidated).toBe(true);
    expect(onGranted).toHaveBeenCalledTimes(1);
  });

  it('lists prompt runs when granted', async () => {
    fetchMock.mockResolvedValue(json(200, { sourceRuns: 0, promptRuns: 3 }));
    renderWithQuery(<RedeemCodeForm />);
    await redeem('X');
    expect(await screen.findByText('+3 prompt puzzles')).toBeInTheDocument();
    expect(screen.queryByText(/uploads/)).not.toBeInTheDocument();
  });

  it('shows the single message for CODE_INVALID and keeps the typed code', async () => {
    fetchMock.mockResolvedValue(json(422, apiError('CODE_INVALID', 'Whatever the server said')));
    renderWithQuery(<RedeemCodeForm />);
    await redeem('WRONG');
    expect(await screen.findByText('That code cannot be used.')).toBeInTheDocument();
    expect(screen.queryByText('Whatever the server said')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Code')).toHaveValue('WRONG');
  });

  it('shows the time to try again for a 429', async () => {
    fetchMock.mockResolvedValue(
      json(429, apiError('RATE_LIMITED', 'Too many attempts.', { retryAfterSeconds: 60, resetAt: '2026-10-15T12:30:00.000Z' })),
    );
    renderWithQuery(<RedeemCodeForm />);
    await redeem('ABC');
    expect(await screen.findByText('Too many attempts.')).toBeInTheDocument();
    expect(screen.getByText(/You can try again at/)).toBeInTheDocument();
    expect(screen.getByLabelText('Code')).toHaveValue('ABC');
  });

  it('does not send an empty code', async () => {
    renderWithQuery(<RedeemCodeForm />);
    await userEvent.click(screen.getByRole('button', { name: 'Redeem' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await screen.findByText('Enter a code.')).toBeInTheDocument();
  });
});
