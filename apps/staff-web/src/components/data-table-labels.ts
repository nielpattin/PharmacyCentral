import type { DataTableLabels } from "@pharmacy/ui";

import { translateText } from "../i18n.ts";

/** Every visible string of DataTable v2, translated. Staff-web tables pass `labels={dataTableLabels()}`. */
export const dataTableLabels = (): DataTableLabels => ({
  filterAriaLabel: translateText("Filter table"),
  filterPlaceholder: translateText("Filter rows"),
  singularRow: translateText("row"),
  pluralRows: translateText("rows"),
  page: translateText("Page"),
  pageOf: translateText("of"),
  previous: translateText("Previous"),
  next: translateText("Next"),
  loading: translateText("Loading…"),
  sortAscending: translateText("(asc)"),
  sortDescending: translateText("(desc)"),
  sortLoadedRowsOnly: translateText("Sorting applies to loaded rows only"),
  density: translateText("Density"),
  densityCompact: translateText("Compact"),
  densityStandard: translateText("Standard"),
  densityLoose: translateText("Loose"),
  columns: translateText("Columns"),
  columnsMenu: translateText("Show or hide columns"),
  selectAllVisible: translateText("Select all visible rows"),
  selectRow: translateText("Select {name}"),
  selectedCount: translateText("{count} selected"),
  clearSelection: translateText("Clear selection"),
  bulkActions: translateText("Bulk actions"),
  exportCsv: translateText("Export CSV"),
  showingRows: translateText("Showing {count} rows"),
  showingOfTotal: translateText("Showing {count} of {total} rows"),
  moreAvailable: translateText("More available"),
  loadMore: translateText("Load more"),
  loadingMore: translateText("Loading more…"),
});
