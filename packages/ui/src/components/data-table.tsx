import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type PaginationState,
  type SortingState,
} from "@tanstack/react-table";
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { Button } from "./button.tsx";
import { Input } from "./input.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table.tsx";

export type DataColumn<T> = {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
  enableSorting?: boolean;
};

const formatCell = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "function") return value.name;
  if (typeof value === "string") return value;
  if (typeof value === "number") return value.toString();
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "symbol") return value.description ?? "";
  return "";
};

export const DataTable = <T,>({
  rows,
  columns,
  empty = "No records found",
  getKey,
  virtualize = false,
  interactive = false,
}: {
  rows: T[];
  columns: Array<DataColumn<T>>;
  empty?: string;
  getKey?: (row: T, index: number) => string;
  virtualize?: boolean;
  interactive?: boolean;
}): React.JSX.Element => {
  const [globalFilter, setGlobalFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 25 });
  const tableColumns: Array<ColumnDef<T, unknown>> = columns.map((column) => ({
    accessorKey: column.key,
    enableSorting: interactive && column.enableSorting !== false,
    header: column.label,
    cell: ({ getValue, row }) => (column.render ? column.render(row.original) : formatCell(getValue())),
  }));
  const table = useReactTable({
    data: rows,
    columns: tableColumns,
    state: { globalFilter, pagination, sorting },
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  const tableRows = table.getRowModel().rows;
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: virtualize ? tableRows.length : 0,
    estimateSize: () => 44,
    getScrollElement: () => scrollRef.current,
    overscan: 8,
  });

  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted">{empty}</p>;

  const header = (
    <TableHeader>
      {table.getHeaderGroups().map((headerGroup) => (
        <TableRow key={headerGroup.id}>
          {headerGroup.headers.map((headerCell) => {
            const sorted = headerCell.column.getIsSorted();
            const canSort = headerCell.column.getCanSort();
            const label = flexRender(headerCell.column.columnDef.header, headerCell.getContext());
            return (
              <TableHead
                key={headerCell.id}
                aria-sort={sorted ? (sorted === "asc" ? "ascending" : "descending") : "none"}
              >
                {headerCell.isPlaceholder ? null : canSort ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-left"
                    onClick={headerCell.column.getToggleSortingHandler()}
                  >
                    {label}
                    <span aria-hidden="true">{sorted === "asc" ? "(asc)" : sorted === "desc" ? "(desc)" : ""}</span>
                  </button>
                ) : (
                  label
                )}
              </TableHead>
            );
          })}
        </TableRow>
      ))}
    </TableHeader>
  );
  const renderRow = (row: (typeof tableRows)[number], ref?: (element: HTMLTableRowElement | null) => void) => (
    <TableRow
      key={getKey ? getKey(row.original, row.index) : row.id}
      ref={ref}
      data-index={ref ? row.index : undefined}
    >
      {row.getVisibleCells().map((cell) => (
        <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
      ))}
    </TableRow>
  );
  const toolbar = interactive ? (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <Input
        aria-label="Filter table"
        value={globalFilter}
        onChange={(event) => setGlobalFilter(event.target.value)}
        placeholder="Filter rows"
        className="max-w-sm"
      />
      <span className="text-xs text-muted">
        {tableRows.length} {tableRows.length === 1 ? "row" : "rows"}
      </span>
    </div>
  ) : null;
  const paginationControls = interactive ? (
    <div className="mt-3 flex items-center justify-between gap-3 text-sm text-muted">
      <span>
        Page {pagination.pageIndex + 1} of {Math.max(table.getPageCount(), 1)}
      </span>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
        >
          Previous
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
        >
          Next
        </Button>
      </div>
    </div>
  ) : null;

  if (tableRows.length === 0) {
    return (
      <>
        {toolbar}
        <p className="py-6 text-center text-sm text-muted">{empty}</p>
      </>
    );
  }

  if (!virtualize) {
    return (
      <>
        {toolbar}
        <Table>
          {header}
          <TableBody>{tableRows.map((row) => renderRow(row))}</TableBody>
        </Table>
        {paginationControls}
      </>
    );
  }

  const virtualRows = rowVirtualizer.getVirtualItems();
  const firstRow = virtualRows[0];
  const lastRow = virtualRows[virtualRows.length - 1];
  const topPadding = firstRow?.start ?? 0;
  const bottomPadding = lastRow ? rowVirtualizer.getTotalSize() - lastRow.end : 0;

  return (
    <>
      {toolbar}
      <div ref={scrollRef} className="max-h-[32rem] overflow-auto">
        <Table>
          {header}
          <TableBody>
            {topPadding > 0 ? (
              <tr aria-hidden="true">
                <td colSpan={columns.length} style={{ height: topPadding, padding: 0 }} />
              </tr>
            ) : null}
            {virtualRows.map((virtualRow) => renderRow(tableRows[virtualRow.index]!, rowVirtualizer.measureElement))}
            {bottomPadding > 0 ? (
              <tr aria-hidden="true">
                <td colSpan={columns.length} style={{ height: bottomPadding, padding: 0 }} />
              </tr>
            ) : null}
          </TableBody>
        </Table>
      </div>
      {paginationControls}
    </>
  );
};
