import type { AdminModelMeta, AdminRecordDto } from '@coach/types';
import { Link } from '@tanstack/react-router';
import { tableFeatures, useTable, type ColumnDef } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table';
import { displayFormValue, toFormValue } from './fields';

// Pagination is manual: the server pages, the table only renders the page it is given.
const features = tableFeatures({});

export interface AdminTableProps {
  model: AdminModelMeta;
  items: AdminRecordDto[];
  total: number;
  page: number;
  pageSize: number;
  search: string;
  onSearch: (term: string) => void;
  onPage: (page: number) => void;
}

export function AdminTable({
  model,
  items,
  total,
  page,
  pageSize,
  search,
  onSearch,
  onPage,
}: AdminTableProps) {
  const [term, setTerm] = useState(search);

  // Columns are `listDisplay`, headers are field labels; computed fields are never columns.
  const columns = useMemo<ColumnDef<typeof features, AdminRecordDto>[]>(() => {
    const shown = model.listDisplay.flatMap((name, index) => {
      const field = model.fields.find((f) => f.name === name);
      if (!field || field.computed) return [];
      const col: ColumnDef<typeof features, AdminRecordDto> = {
        id: name,
        header: field.label,
        cell: ({ row }) => {
          const text = displayFormValue(field, toFormValue(field, row.original.values[name]));
          // The first column carries the link to the record.
          if (index === 0) {
            return (
              <Link
                to="/admin/$model/$id"
                params={{ model: model.name, id: row.original.id }}
                className="font-medium text-primary underline underline-offset-4 hover:text-primary-hover"
              >
                {text || row.original.title}
              </Link>
            );
          }
          return text;
        },
      };
      return [col];
    });
    return shown;
  }, [model]);

  const table = useTable({ features, columns, data: items });

  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const hasSearch = model.searchFields.length > 0;

  return (
    <div className="flex flex-col gap-4">
      {hasSearch && (
        <form
          role="search"
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onSearch(term.trim());
          }}
        >
          <label className="flex flex-col gap-1 text-sm font-medium" htmlFor="admin-search">
            Search
            <Input
              id="admin-search"
              type="search"
              value={term}
              maxLength={model.maxSearchLength}
              onChange={(e) => setTerm(e.target.value)}
              className="w-64"
            />
          </label>
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
      )}

      {items.length === 0 ? (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed p-6">
          <p>{search ? `No records match "${search}"` : 'No records'}</p>
          {search && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setTerm('');
                onSearch('');
              }}
            >
              Clear search
            </Button>
          )}
        </div>
      ) : (
        <Table>
          <TableCaption>{model.label}</TableCaption>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => (
                  <TableHead key={header.id} scope="col">
                    <table.FlexRender header={header} />
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id}>
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <nav aria-label="Pagination" className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </Button>
        <span aria-live="polite">
          Page {page} of {pages}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      </nav>
    </div>
  );
}
