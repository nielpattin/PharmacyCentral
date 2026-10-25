import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type Cell,
  type ColumnDef,
  type PaginationState,
  type Row,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useRef, useState, type ReactNode } from "react";

import { cn } from "../cn.ts";
import { downloadCsv, toCsv, type CsvColumn } from "../data-table/csv.ts";
import { toPlainText } from "../data-table/plain-text.ts";
import {
  DEFAULT_TABLE_PREFERENCES,
  readTablePreferences,
  writeTablePreferences,
  type TableDensity,
  type TablePreferences,
} from "../data-table/preferences.ts";
import { selectionState, setVisibleSelection, toggleSelectionKey } from "../data-table/selection.ts";
import { Button } from "./button.tsx";
import { Input } from "./input.tsx";
import { Popover } from "./popover.tsx";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table.tsx";
import { ToggleGroup, ToggleGroupItem } from "./toggle-group.tsx";

export type DataColumn<T> = {
  key: string;
  label: string;
  /** Custom cell content. Without it the cell shows the plain value of `row[key]`. */
  render?: ((row: T) => ReactNode) | undefined;
  /** Plain-text value for CSV export and the truncation tooltip. Defaults to `row[key]`. */
  text?: ((row: T) => unknown) | undefined;
  /** Sorting applies to the loaded rows. Default true. Never applies to "actions" or pinned columns. */
  enableSorting?: boolean | undefined;
  /** Whether the Columns menu can hide the column. Default false for "actions" and pinned columns, true otherwise. */
  hideable?: boolean | undefined;
  /** Sticks the column to the right edge, for row actions. */
  pinned?: "right" | undefined;
  /** Ellipsis for long text with the full text in a title. `true` caps the width at 20rem; a number caps it in `ch`. */
  truncate?: boolean | number | undefined;
  align?: "left" | "right" | "center" | undefined;
  /** Pixels for a number, any CSS length for a string. */
  width?: number | string | undefined;
  /**
   * Hides the column while the table's own container is narrower than 48rem (`md`), 64rem (`lg`) or 80rem (`xl`), so
   * the table fits without sideways scrolling. It follows the container, not the window, so an open sidebar counts.
   * The Columns menu and the CSV export still include the column. Keep the key identifying columns and actions free of it.
   */
  hideBelow?: "md" | "lg" | "xl" | undefined;
};

// Every visible string is a label with an English default. Staff-web passes translated values.
const DEFAULT_LABELS = {
  filterAriaLabel: "Filter table",
  filterPlaceholder: "Filter rows",
  singularRow: "row",
  pluralRows: "rows",
  page: "Page",
  pageOf: "of",
  previous: "Previous",
  next: "Next",
  loading: "Loading…",
  sortLoadedRowsOnly: "Sorting applies to loaded rows only",
  density: "Density",
  densityCompact: "Compact",
  densityStandard: "Standard",
  densityLoose: "Loose",
  columns: "Columns",
  view: "Display",
  viewMenu: "Table view options",
  selectAllVisible: "Select all visible rows",
  selectRow: "Select {name}",
  selectedCount: "{count} selected",
  clearSelection: "Clear selection",
  bulkActions: "Bulk actions",
  exportCsv: "Export CSV",
  showingRows: "Showing {count} rows",
  showingOneRow: "Showing 1 row",
  showingOfTotal: "Showing {count} of {total} rows",
  moreAvailable: "More available",
  loadMore: "Load more",
  loadingMore: "Loading more…",
};

export type DataTableLabels = { [K in keyof typeof DEFAULT_LABELS]?: string | undefined };

/** Row selection, controlled by the caller. Keys come from `getKey`. */
export type DataTableSelection = {
  keys: ReadonlySet<string>;
  onChange: (keys: ReadonlySet<string>) => void;
};

/** Server-side search. The caller debounces the value and refetches. */
export type DataTableSearch = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string | undefined;
};

/** Cursor paging. The footer shows "Load more" while `hasMore` is true. */
export type DataTablePaging = {
  hasMore: boolean;
  loadingMore?: boolean | undefined;
  onLoadMore: () => void;
  total?: number | undefined;
};

/** Adds an "Export CSV" button that exports the table's filtered rows (all pages, not only the one on screen). */
export type DataTableExport = {
  filename: string;
  /** Column keys to export, in this order. Defaults to the visible, non-pinned columns. */
  columns?: readonly string[] | undefined;
};

export type DataTableProps<T> = {
  rows: T[];
  columns: Array<DataColumn<T>>;
  empty?: string | undefined;
  getKey?: ((row: T, index: number) => string) | undefined;
  /** Renders only the rows in view. The body always scrolls inside its container. */
  virtualize?: boolean | undefined;
  /** Client-side filter, sorting and pagination over the rows passed in. Off in server mode. */
  interactive?: boolean | undefined;
  loading?: boolean | undefined;
  labels?: DataTableLabels | undefined;
  /** Keeps the header visible while the body scrolls inside a max-height container. Default true. */
  stickyHeader?: boolean | undefined;
  /** Persists density and hidden columns in localStorage under this key. Without it they live in memory only. */
  storageKey?: string | undefined;
  selection?: DataTableSelection | undefined;
  /** Actions shown in the bar that appears above the table while rows are selected. */
  bulkActions?: ReactNode | undefined;
  /** Server mode: the caller owns the filter. */
  search?: DataTableSearch | undefined;
  /** Server mode: the caller owns paging. */
  paging?: DataTablePaging | undefined;
  exportCsv?: DataTableExport | undefined;
  /** Extra controls in the toolbar, before the density and column controls (for example a saved-views menu). */
  toolbarExtra?: ReactNode | undefined;
  /** Filter controls at the start of the toolbar, so a page's filters and the table controls share one row. */
  toolbarStart?: ReactNode | undefined;
};

type ColumnLayout = Pick<DataColumn<unknown>, "align" | "pinned" | "width" | "hideBelow">;

// Static class names, so Tailwind can see them. Container query sizes: 3xl = 48rem, 5xl = 64rem, 7xl = 80rem.
const HIDE_BELOW_CLASS = {
  md: "@max-3xl:hidden",
  lg: "@max-5xl:hidden",
  xl: "@max-7xl:hidden",
} as const;

const EMPTY_KEYS: ReadonlySet<string> = new Set();
const ALIGN_CLASS = { left: "text-left", right: "text-right", center: "text-center" } as const;
const DENSITY_CELL: Record<TableDensity, string> = { compact: "py-1", standard: "py-2", loose: "py-3.5" };
// The edge line only shows while the table scrolls sideways, which is when the pinned column overlaps other cells.
const PINNED_CELL = "sticky right-0 z-[1] bg-surface";
const PINNED_EDGE = "border-l border-line";
const EMPTY_STATE_CLASS =
  "my-8 rounded-lg border border-dashed border-line bg-surface-soft px-6 py-12 text-center text-sm text-muted";

const fill = (template: string, values: Record<string, number | string>): string =>
  template.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));

const readCell = (row: unknown, key: string): unknown =>
  typeof row === "object" && row !== null ? (row as Record<string, unknown>)[key] : undefined;

const widthStyle = (column: ColumnLayout | undefined): { width: string } | undefined => {
  if (column?.width === undefined) return undefined;
  return { width: typeof column.width === "number" ? `${column.width}px` : column.width };
};

const useTablePreferences = (storageKey: string | undefined): [TablePreferences, (next: TablePreferences) => void] => {
  const [preferences, setPreferences] = useState<TablePreferences>(() =>
    storageKey === undefined
      ? DEFAULT_TABLE_PREFERENCES
      : (readTablePreferences(storageKey) ?? DEFAULT_TABLE_PREFERENCES),
  );
  const update = (next: TablePreferences): void => {
    setPreferences(next);
    if (storageKey !== undefined) writeTablePreferences(storageKey, next);
  };
  return [preferences, update];
};

const SortIcon = ({ direction }: { direction: false | "asc" | "desc" }): React.JSX.Element => (
  <svg
    aria-hidden="true"
    viewBox="0 0 12 12"
    className={cn("size-3 shrink-0", direction ? "text-ink" : "text-muted-soft")}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 4.5 6 1.5l3 3" className={direction === "desc" ? "opacity-25" : undefined} />
    <path d="M3 7.5 6 10.5l3-3" className={direction === "asc" ? "opacity-25" : undefined} />
  </svg>
);

type ViewMenuLabels = {
  button: string;
  menu: string;
  density: string;
  compact: string;
  standard: string;
  loose: string;
  columns: string;
};

/** One menu for how the table looks: row density, then which columns show. */
const ViewMenu = ({
  options,
  hidden,
  visibleCount,
  density,
  labels,
  onDensityChange,
  onToggle,
}: {
  options: ReadonlyArray<{ key: string; label: string }>;
  hidden: ReadonlySet<string>;
  visibleCount: number;
  density: TableDensity;
  labels: ViewMenuLabels;
  onDensityChange: (next: TableDensity) => void;
  onToggle: (key: string) => void;
}): React.JSX.Element => (
  <Popover buttonLabel={labels.button} panelLabel={labels.menu} panelClassName="grid w-64 gap-3 p-3">
    <div className="grid gap-1.5">
      <p className="text-xs font-semibold tracking-wide text-muted uppercase">{labels.density}</p>
      <ToggleGroup aria-label={labels.density} value={density} onValueChange={onDensityChange} className="w-full">
        <ToggleGroupItem value="compact" className="flex-1">
          {labels.compact}
        </ToggleGroupItem>
        <ToggleGroupItem value="standard" className="flex-1">
          {labels.standard}
        </ToggleGroupItem>
        <ToggleGroupItem value="loose" className="flex-1">
          {labels.loose}
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
    {options.length > 0 ? (
      <div className="grid gap-0.5">
        <p className="text-xs font-semibold tracking-wide text-muted uppercase">{labels.columns}</p>
        {options.map((option) => {
          const checked = !hidden.has(option.key);
          return (
            <label key={option.key} className="flex items-center gap-2 rounded-sm px-1 py-1 text-sm text-ink">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={checked}
                disabled={checked && visibleCount <= 1}
                onChange={() => onToggle(option.key)}
              />
              {option.label}
            </label>
          );
        })}
      </div>
    ) : null}
  </Popover>
);

/**
 * Table with optional client features (`interactive`), server-driven search and paging, row selection, density and
 * column visibility (persisted per `storageKey`), and CSV export of the filtered rows.
 */
export const DataTable = <T,>({
  rows,
  columns,
  empty = "No records found",
  getKey,
  virtualize = false,
  interactive = false,
  loading = false,
  labels = {},
  stickyHeader = true,
  storageKey,
  selection,
  bulkActions,
  search,
  paging,
  exportCsv,
  toolbarExtra,
  toolbarStart,
}: DataTableProps<T>): React.JSX.Element => {
  const text = <K extends keyof typeof DEFAULT_LABELS>(key: K): string => labels[key] ?? DEFAULT_LABELS[key];

  // Server mode: search or paging is owned by the caller, so the client filter and pagination step aside.
  const serverMode = search !== undefined || paging !== undefined;
  const clientMode = interactive && !serverMode;
  const sortingEnabled = interactive || serverMode;

  const [preferences, updatePreferences] = useTablePreferences(storageKey);
  const [globalFilter, setGlobalFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 25 });
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollsSideways, setScrollsSideways] = useState(false);
  // Ref callback with cleanup: remeasures when the container or the table inside it changes size.
  const attachScroller = useCallback((element: HTMLDivElement | null): (() => void) | undefined => {
    scrollRef.current = element;
    if (element === null) return undefined;
    const measure = (): void => setScrollsSideways(element.scrollWidth > element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, []);

  const hiddenKeys = new Set(preferences.hiddenColumns);
  const hideableKeys = new Set(
    columns
      .filter((column) => column.hideable ?? (column.key !== "actions" && column.pinned === undefined))
      .map((column) => column.key),
  );
  const columnVisibility: VisibilityState = Object.fromEntries(
    columns.map((column) => [column.key, !(hideableKeys.has(column.key) && hiddenKeys.has(column.key))] as const),
  );
  const columnByKey = new Map(columns.map((column) => [column.key, column]));
  const tableColumns: Array<ColumnDef<T, unknown>> = columns.map((column) => ({
    id: column.key,
    accessorFn: (row: T) => readCell(row, column.key),
    enableSorting:
      sortingEnabled && column.enableSorting !== false && column.key !== "actions" && column.pinned === undefined,
    header: column.label,
  }));

  const table = useReactTable({
    data: rows,
    columns: tableColumns,
    // The row id is the caller's key, so selection keys and React keys come from one place.
    getRowId: getKey ?? ((_row: T, index: number) => String(index)),
    state: { globalFilter, pagination, sorting, columnVisibility },
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
    manualFiltering: !clientMode,
    manualPagination: !clientMode,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const filteredRows = table.getPrePaginationRowModel().rows;
  const pageRows = table.getRowModel().rows;
  const visibleCount = table.getVisibleLeafColumns().length;
  const density = preferences.density;
  const pageKeys = pageRows.map((row) => row.id);
  const selectedKeys = selection?.keys ?? EMPTY_KEYS;
  const headerState = selectionState(pageKeys, selectedKeys);
  const nameColumn = columns.find((column) => columnVisibility[column.key] !== false && column.pinned === undefined);
  const rowName = (row: T): string => {
    if (nameColumn === undefined) return "";
    return toPlainText(nameColumn.text ? nameColumn.text(row) : readCell(row, nameColumn.key));
  };
  const stickyHeaderClass = stickyHeader ? "sticky top-0 z-10" : undefined;

  const rowVirtualizer = useVirtualizer({
    count: virtualize ? pageRows.length : 0,
    estimateSize: () => 44,
    getScrollElement: () => scrollRef.current,
    overscan: 8,
  });

  const toggleColumn = (key: string): void => {
    const hidden = preferences.hiddenColumns.includes(key)
      ? preferences.hiddenColumns.filter((item) => item !== key)
      : [...preferences.hiddenColumns, key];
    updatePreferences({ ...preferences, hiddenColumns: hidden });
  };

  const exportColumns =
    exportCsv === undefined
      ? []
      : exportCsv.columns !== undefined
        ? exportCsv.columns.flatMap((key) => columnByKey.get(key) ?? [])
        : columns.filter(
            (column) =>
              columnVisibility[column.key] !== false && column.pinned === undefined && column.key !== "actions",
          );

  const exportCurrentRows = (): void => {
    if (exportCsv === undefined) return;
    const csvColumns: Array<CsvColumn<T>> = exportColumns.map((column) => ({
      label: column.label,
      value: (row: T) => (column.text ? column.text(row) : readCell(row, column.key)),
    }));
    downloadCsv(
      exportCsv.filename,
      toCsv(
        filteredRows.map((row) => row.original),
        csvColumns,
      ),
    );
  };

  const colSpan = visibleCount + (selection ? 1 : 0);

  const renderCell = (cell: Cell<T, unknown>, row: Row<T>): ReactNode => {
    const column = columnByKey.get(cell.column.id);
    if (column === undefined) return null;
    const value = cell.getValue();
    const content = column.render ? column.render(row.original) : toPlainText(value);
    if (!column.truncate) return content;
    return (
      <span
        className={cn("block truncate", column.truncate === true && "max-w-80")}
        style={typeof column.truncate === "number" ? { maxWidth: `${column.truncate}ch` } : undefined}
        title={toPlainText(column.text ? column.text(row.original) : value)}
      >
        {content}
      </span>
    );
  };

  const renderRow = (row: Row<T>, ref?: (element: HTMLTableRowElement | null) => void): React.JSX.Element => {
    const isSelected = selectedKeys.has(row.id);
    return (
      <TableRow
        key={row.id}
        ref={ref}
        data-index={ref ? row.index : undefined}
        className={cn(isSelected && "bg-primary-soft/40")}
      >
        {selection ? (
          <TableCell className={cn(DENSITY_CELL[density], "w-10")}>
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={isSelected}
              aria-label={fill(text("selectRow"), { name: rowName(row.original) || String(row.index + 1) })}
              onChange={() => selection.onChange(toggleSelectionKey(selectedKeys, row.id))}
            />
          </TableCell>
        ) : null}
        {row.getVisibleCells().map((cell) => {
          const column = columnByKey.get(cell.column.id);
          return (
            <TableCell
              key={cell.id}
              className={cn(
                DENSITY_CELL[density],
                column?.align !== undefined && ALIGN_CLASS[column.align],
                column?.pinned === "right" && cn(PINNED_CELL, scrollsSideways && PINNED_EDGE),
                column?.hideBelow && HIDE_BELOW_CLASS[column.hideBelow],
              )}
            >
              {renderCell(cell, row)}
            </TableCell>
          );
        })}
      </TableRow>
    );
  };

  const headerRows = table.getHeaderGroups().map((group) => (
    <TableRow key={group.id}>
      {selection ? (
        <TableHead className={cn("w-10 whitespace-nowrap bg-surface", stickyHeaderClass)}>
          <input
            type="checkbox"
            className="size-4 accent-primary"
            aria-label={text("selectAllVisible")}
            checked={headerState === "all"}
            ref={(element) => {
              if (element) element.indeterminate = headerState === "some";
            }}
            onChange={() => selection.onChange(setVisibleSelection(selectedKeys, pageKeys, headerState !== "all"))}
          />
        </TableHead>
      ) : null}
      {group.headers.map((header) => {
        const column = columnByKey.get(header.column.id);
        const sorted = header.column.getIsSorted();
        const canSort = header.column.getCanSort();
        const label = header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext());
        return (
          <TableHead
            key={header.id}
            aria-sort={
              canSort ? (sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none") : undefined
            }
            className={cn(
              "whitespace-nowrap bg-surface",
              stickyHeaderClass,
              column?.align !== undefined && ALIGN_CLASS[column.align],
              column?.pinned === "right" && cn("sticky right-0 z-20", scrollsSideways && PINNED_EDGE),
              column?.hideBelow && HIDE_BELOW_CLASS[column.hideBelow],
            )}
            style={widthStyle(column)}
          >
            {canSort ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-sm text-left [text-transform:inherit] outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                onClick={header.column.getToggleSortingHandler()}
              >
                {label}
                <SortIcon direction={sorted} />
              </button>
            ) : (
              label
            )}
          </TableHead>
        );
      })}
    </TableRow>
  ));

  const renderBodyRows = (): ReactNode => {
    if (!virtualize) return pageRows.map((row) => renderRow(row));
    const virtualRows = rowVirtualizer.getVirtualItems();
    const firstRow = virtualRows[0];
    const lastRow = virtualRows[virtualRows.length - 1];
    const topPadding = firstRow?.start ?? 0;
    const bottomPadding = lastRow ? rowVirtualizer.getTotalSize() - lastRow.end : 0;
    return (
      <>
        {topPadding > 0 ? (
          <tr aria-hidden="true">
            <td colSpan={colSpan} style={{ height: topPadding, padding: 0 }} />
          </tr>
        ) : null}
        {virtualRows.map((virtualRow) => renderRow(pageRows[virtualRow.index]!, rowVirtualizer.measureElement))}
        {bottomPadding > 0 ? (
          <tr aria-hidden="true">
            <td colSpan={colSpan} style={{ height: bottomPadding, padding: 0 }} />
          </tr>
        ) : null}
      </>
    );
  };

  let body: ReactNode;
  if (loading && rows.length === 0) {
    body = (
      <p className={EMPTY_STATE_CLASS} role="status">
        {text("loading")}
      </p>
    );
  } else if (pageRows.length === 0) {
    body = (
      <p className={EMPTY_STATE_CLASS} role="status">
        {empty}
      </p>
    );
  } else {
    // The scroll container bounds the height, so sticky header cells pin inside it.
    body = (
      <div
        ref={attachScroller}
        className={cn("overflow-auto", stickyHeader && "max-h-[max(24rem,calc(100dvh-21rem))]")}
      >
        <table className="w-full border-collapse text-left text-sm">
          <TableHeader>{headerRows}</TableHeader>
          <TableBody>{renderBodyRows()}</TableBody>
        </table>
      </div>
    );
  }

  const filterInput =
    search !== undefined ? (
      <Input
        type="search"
        aria-label={text("filterAriaLabel")}
        value={search.value}
        onChange={(event) => search.onChange(event.target.value)}
        placeholder={search.placeholder ?? text("filterPlaceholder")}
        className="max-w-sm"
      />
    ) : interactive && !serverMode ? (
      <Input
        aria-label={text("filterAriaLabel")}
        value={globalFilter}
        onChange={(event) => setGlobalFilter(event.target.value)}
        placeholder={text("filterPlaceholder")}
        className="max-w-sm"
      />
    ) : null;

  // Wide table: filters at the start and the table controls at the end of one row. Narrower than 56rem the two groups
  // stack, each aligned to the start, so the controls never float at the right edge of a second row.
  const toolbar = (
    <div className="@container mb-3">
      <div className="flex flex-col gap-2 @4xl:flex-row @4xl:items-center @4xl:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2 @4xl:flex-1">
          {toolbarStart}
          {filterInput}
        </div>
        <div className="flex flex-wrap items-center gap-2 @4xl:shrink-0">
          {clientMode ? (
            <span className="text-xs text-muted">
              {filteredRows.length} {filteredRows.length === 1 ? text("singularRow") : text("pluralRows")}
            </span>
          ) : null}
          {serverMode && sortingEnabled && paging?.hasMore ? (
            <span className="text-xs text-muted">{text("sortLoadedRowsOnly")}</span>
          ) : null}
          {toolbarExtra}
          <ViewMenu
            options={columns
              .filter((column) => hideableKeys.has(column.key))
              .map((column) => ({ key: column.key, label: column.label }))}
            hidden={hiddenKeys}
            visibleCount={visibleCount}
            density={density}
            labels={{
              button: text("view"),
              menu: text("viewMenu"),
              density: text("density"),
              compact: text("densityCompact"),
              standard: text("densityStandard"),
              loose: text("densityLoose"),
              columns: text("columns"),
            }}
            onDensityChange={(next) => updatePreferences({ ...preferences, density: next })}
            onToggle={toggleColumn}
          />
          {exportCsv ? (
            <Button type="button" variant="secondary" onClick={exportCurrentRows}>
              {text("exportCsv")}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );

  const bulkBar =
    selection && selection.keys.size > 0 ? (
      <div
        role="region"
        aria-label={text("bulkActions")}
        className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary-soft px-3 py-2 text-sm text-primary-dark"
      >
        <span className="font-medium">{fill(text("selectedCount"), { count: selection.keys.size })}</span>
        {bulkActions ? <div className="flex flex-wrap items-center gap-2">{bulkActions}</div> : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ms-auto"
          onClick={() => selection.onChange(EMPTY_KEYS)}
        >
          {text("clearSelection")}
        </Button>
      </div>
    ) : null;

  const clientFooter =
    clientMode && filteredRows.length > 0 ? (
      <div className="mt-3 flex items-center justify-between gap-3 text-sm text-muted">
        <span>
          {`${text("page")} ${pagination.pageIndex + 1} ${text("pageOf")} ${Math.max(table.getPageCount(), 1)}`}
        </span>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            {text("previous")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            {text("next")}
          </Button>
        </div>
      </div>
    ) : null;

  const serverFooter = paging ? (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
      <span aria-live="polite">
        {rows.length === 1 && (paging.total === undefined || paging.total === 1)
          ? text("showingOneRow")
          : paging.total !== undefined
            ? fill(text("showingOfTotal"), { count: rows.length, total: paging.total })
            : fill(text("showingRows"), { count: rows.length })}
      </span>
      <div className="flex items-center gap-2">
        {paging.hasMore ? <span className="text-xs font-medium text-primary-dark">{text("moreAvailable")}</span> : null}
        {paging.hasMore ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={paging.loadingMore ?? false}
            onClick={paging.onLoadMore}
          >
            {paging.loadingMore ? text("loadingMore") : text("loadMore")}
          </Button>
        ) : null}
      </div>
    </div>
  ) : null;

  return (
    <>
      {toolbar}
      {bulkBar}
      {/* Container for the hideBelow column queries: they follow the table's width, not the window's. */}
      <div className="@container">{body}</div>
      {clientFooter}
      {serverFooter}
    </>
  );
};
