import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', async (orig) =>
  (await import('~/test/router-mock')).routerMock(await orig()),
);

import { AdminTable, type AdminTableProps } from './AdminTable';
import { widgetItems, widgetModel } from './fixtures';

function setup(over: Partial<AdminTableProps> = {}) {
  const props: AdminTableProps = {
    model: widgetModel,
    items: widgetItems,
    total: 25,
    page: 1,
    pageSize: 10,
    search: '',
    onSearch: vi.fn(),
    onPage: vi.fn(),
    ...over,
  };
  render(<AdminTable {...props} />);
  return props;
}

describe('AdminTable', () => {
  it('has columns equal to listDisplay, headers from labels, cells from values, and a caption', () => {
    setup();
    const table = screen.getByRole('table', { name: 'Widgets' });
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers).toEqual(['Name', 'Status', 'Size']);
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(
      within(rows[1]!)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['Sprocket', 'active', '3']);
    expect(
      within(rows[2]!)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['Cog', 'blocked', '5']);
  });

  it('links each row to /admin/<model>/<id>', () => {
    setup();
    expect(screen.getByRole('link', { name: 'Sprocket' })).toHaveAttribute(
      'href',
      '/admin/widget/w-1',
    );
    expect(screen.getByRole('link', { name: 'Cog' })).toHaveAttribute('href', '/admin/widget/w-2');
  });

  it('never shows a computed field as a column', () => {
    setup({ model: { ...widgetModel, listDisplay: ['name', 'usage'] } });
    expect(screen.queryByRole('columnheader', { name: 'Usage' })).not.toBeInTheDocument();
  });

  it('shows the search box only when searchFields is non-empty, limited to maxSearchLength', async () => {
    const props = setup();
    const box = screen.getByRole('searchbox', { name: 'Search' });
    expect(box).toHaveAttribute('maxlength', '50');
    await userEvent.type(box, ' cog ');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(props.onSearch).toHaveBeenCalledWith('cog');
  });

  it('has no search box without searchFields', () => {
    setup({ model: { ...widgetModel, searchFields: [] } });
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('pages: "Page p of n", Next requests the next page, Previous is disabled on page 1', async () => {
    const props = setup();
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(props.onPage).toHaveBeenCalledWith(2);
  });

  it('disables Next on the last page', () => {
    setup({ page: 3 });
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('shows the empty state', () => {
    setup({ items: [], total: 0 });
    expect(screen.getByText('No records')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('Page 1 of 1')).toBeInTheDocument();
  });

  it('shows the no-match state with a Clear search button', async () => {
    const props = setup({ items: [], total: 0, search: 'zzz' });
    expect(screen.getByText('No records match "zzz"')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(props.onSearch).toHaveBeenCalledWith('');
  });
});
