import { DataTable as UiTable, type DataColumn } from "@pharmacy/ui";

import { translateText } from "../i18n.ts";
import { idOf, text, type JsonRecord } from "../staff-api.ts";

export type Column = { key: string; label: string; render?: (row: JsonRecord) => React.ReactNode };

export const DataTable = ({
  rows,
  columns,
  empty = "No records found",
}: {
  rows: JsonRecord[];
  columns: Column[];
  empty?: string;
}): React.JSX.Element => {
  const uiColumns: Array<DataColumn<JsonRecord>> = columns.map((column) => ({
    key: column.key,
    label: translateText(column.label),
    render: column.render ?? ((row) => translateText(text(row[column.key]))),
  }));
  return (
    <UiTable
      rows={rows}
      columns={uiColumns}
      empty={translateText(empty)}
      getKey={(row, index) => idOf(row) + "-" + index}
      interactive
      virtualize
    />
  );
};
