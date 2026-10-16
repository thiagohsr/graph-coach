import type { AdminDetailResponse, AdminModelMeta } from '@coach/types';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '~/lib/api/errors';

vi.mock('@tanstack/react-router', async (orig) =>
  (await import('~/test/router-mock')).routerMock(await orig()),
);

import { AdminForm } from './AdminForm';
import { widgetDetail, widgetModel } from './fixtures';

function setup(
  over: {
    model?: AdminModelMeta;
    detail?: AdminDetailResponse;
    onSave?: () => Promise<unknown>;
  } = {},
) {
  const onSave = vi.fn(over.onSave ?? (() => Promise.resolve({})));
  render(
    <AdminForm
      model={over.model ?? widgetModel}
      detail={over.detail ?? widgetDetail}
      onSave={onSave}
    />,
  );
  return onSave;
}

const unprocessable = (issues: { path: string; message: string; code?: string }[]) =>
  new ApiClientError({
    status: 422,
    code: 'VALIDATION_FAILED',
    message: 'The update was rejected.',
    issues: issues.map(({ path, message }) => ({ path, message })),
    issueCodes: Object.fromEntries(issues.flatMap((i) => (i.code ? [[i.path, i.code]] : []))),
  });

describe('AdminForm', () => {
  it('sends only the changed editable fields, after a confirmation listing old and new values', async () => {
    const onSave = setup();
    const name = screen.getByRole('textbox', { name: /Name/ });
    await userEvent.clear(name);
    await userEvent.type(name, 'Gear');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('name: Sprocket → Gear')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ name: 'Gear' });
  });

  it('sends nothing when the confirmation is cancelled', async () => {
    const onSave = setup();
    await userEvent.type(screen.getByRole('textbox', { name: /Name/ }), 'X');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    );
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows a status and sends nothing when nothing changed', async () => {
    const onSave = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('There are no changes to save.')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('renders an enum as a select', async () => {
    const onSave = setup();
    const select = screen.getByRole('combobox', { name: 'Status' });
    await userEvent.selectOptions(select, 'blocked');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('status: active → blocked')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onSave).toHaveBeenCalledWith({ status: 'blocked' });
  });

  it('gives a number field its bounds and refuses an out-of-range value before sending', async () => {
    const onSave = setup();
    const size = screen.getByRole('spinbutton', { name: 'Size' });
    expect(size).toHaveAttribute('min', '1');
    expect(size).toHaveAttribute('max', '10');
    await userEvent.clear(size);
    await userEvent.type(size, '11');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Must be between 1 and 10.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows a 422 out_of_range issue as the bounds message at its field', async () => {
    setup({
      onSave: () =>
        Promise.reject(
          unprocessable([{ path: 'values.size', message: 'server text', code: 'out_of_range' }]),
        ),
    });
    const size = screen.getByRole('spinbutton', { name: 'Size' });
    await userEvent.clear(size);
    await userEvent.type(size, '7');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('Must be between 1 and 10.')).toBeInTheDocument();
    expect(screen.queryByText('server text')).not.toBeInTheDocument();
  });

  it('shows 422 issues at the field named by path minus "values." and "values" issues above the form', async () => {
    setup({
      onSave: () =>
        Promise.reject(
          unprocessable([
            { path: 'values.name', message: 'Name is required.', code: 'required' },
            { path: 'values', message: 'Only drafts can be edited.' },
          ]),
        ),
    });
    await userEvent.type(screen.getByRole('textbox', { name: /Name/ }), 'X');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('Name is required.')).toBeInTheDocument();
    expect(screen.getByText('Only drafts can be edited.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Name/ })).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows the alert for 405 ADMIN_MODEL_READ_ONLY', async () => {
    setup({
      onSave: () =>
        Promise.reject(
          new ApiClientError({
            status: 405,
            code: 'ADMIN_MODEL_READ_ONLY' as never,
            message: 'ro',
          }),
        ),
    });
    await userEvent.type(screen.getByRole('textbox', { name: /Name/ }), 'X');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('This model is read-only.')).toBeInTheDocument();
  });

  it('renders computed fields as read-only values, never inputs', () => {
    setup();
    expect(screen.getByText('Usage')).toBeInTheDocument();
    expect(screen.queryByLabelText('Usage')).not.toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
  });

  it('a read-only model has no Save button and no inputs', () => {
    setup({ model: { ...widgetModel, readOnly: true } });
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByText('Sprocket')).toBeInTheDocument();
  });

  it('renders each action as a button; after confirmation it sends the one field', async () => {
    const onSave = setup({
      detail: { ...widgetDetail, actions: [{ field: 'status', value: 'blocked', label: 'Block' }] },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Block' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Block this record?')).toBeInTheDocument();
    expect(within(dialog).getByText('status: active → blocked')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(onSave).toHaveBeenCalledWith({ status: 'blocked' });
  });

  it('renders no action button when actions is empty', () => {
    setup();
    expect(screen.queryByText('Quick actions')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Block' })).not.toBeInTheDocument();
  });

  it('renders records, count, and route links', () => {
    setup({
      detail: {
        ...widgetDetail,
        links: [
          {
            kind: 'records',
            name: 'parts',
            label: 'Parts',
            model: 'part',
            items: [{ id: 'p-1', title: 'Bolt' }],
            truncated: true,
          },
          {
            kind: 'records',
            name: 'notes',
            label: 'Notes',
            items: [{ id: 'n-1', title: 'Plain note' }],
            truncated: false,
          },
          { kind: 'count', name: 'n', label: 'Produced', count: 6 },
          { kind: 'route', name: 'why', label: 'Why this?', href: '/decisions/d-9' },
        ],
      },
    });
    expect(screen.getByRole('link', { name: 'Bolt' })).toHaveAttribute('href', '/admin/part/p-1');
    expect(screen.getByText('Plain note').closest('a')).toBeNull();
    expect(screen.getByText('More exist.')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Why this?' })).toHaveAttribute(
      'href',
      '/decisions/d-9',
    );
  });
});
