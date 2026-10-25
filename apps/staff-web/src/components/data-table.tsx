import { DataTable as UiTable, type DataColumn, type DataTableLabels, type DataTableProps } from "@pharmacy/ui";

import { translateText } from "../i18n.ts";
import { idOf, text, type JsonRecord } from "../staff-api.ts";

export type Column = Pick<
  DataColumn<JsonRecord>,
  | "key"
  | "label"
  | "render"
  | "text"
  | "enableSorting"
  | "hideable"
  | "pinned"
  | "truncate"
  | "align"
  | "width"
  | "hideBelow"
>;

// Every key the UI can show, translated here so the shared package stays free of i18n.
const translatedLabels = (): DataTableLabels => ({
  filterAriaLabel: translateText("Filter table"),
  filterPlaceholder: translateText("Filter rows"),
  singularRow: translateText("row"),
  pluralRows: translateText("rows"),
  page: translateText("Page"),
  pageOf: translateText("of"),
  previous: translateText("Previous"),
  next: translateText("Next"),
  loading: translateText("Loading…"),
  sortLoadedRowsOnly: translateText("Sorting applies to loaded rows only"),
  density: translateText("Density"),
  densityCompact: translateText("Compact"),
  densityStandard: translateText("Standard"),
  densityLoose: translateText("Loose"),
  columns: translateText("Columns"),
  view: translateText("Display"),
  viewMenu: translateText("Table view options"),
  selectAllVisible: translateText("Select all visible rows"),
  selectRow: translateText("Select {name}"),
  selectedCount: translateText("{count} selected"),
  clearSelection: translateText("Clear selection"),
  bulkActions: translateText("Bulk actions"),
  exportCsv: translateText("Export CSV"),
  showingRows: translateText("Showing {count} rows"),
  showingOneRow: translateText("Showing 1 row"),
  showingOfTotal: translateText("Showing {count} of {total} rows"),
  moreAvailable: translateText("More available"),
  loadMore: translateText("Load more"),
  loadingMore: translateText("Loading more…"),
});

type WrapperProps = Omit<DataTableProps<JsonRecord>, "rows" | "columns" | "labels" | "empty"> & {
  rows: JsonRecord[];
  columns: Column[];
  empty?: string | undefined;
};

/** Staff-web table. Client filtering, sorting, pagination and virtualization stay on unless a caller overrides them. */
export const DataTable = ({
  rows,
  columns,
  empty = "No records found",
  loading = false,
  interactive = true,
  virtualize = true,
  getKey = (row: JsonRecord, index: number) => idOf(row) + "-" + index,
  ...rest
}: WrapperProps): React.JSX.Element => {
  const uiColumns: Array<DataColumn<JsonRecord>> = columns.map((column) => ({
    ...column,
    label: translateText(column.label),
    render: column.render ?? ((row) => translateText(text(row[column.key]))),
  }));
  return (
    <UiTable
      {...rest}
      rows={rows}
      columns={uiColumns}
      empty={translateText(empty)}
      loading={loading}
      labels={translatedLabels()}
      getKey={getKey}
      interactive={interactive}
      virtualize={virtualize}
    />
  );
};
