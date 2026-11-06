import { toPlainText } from "./plain-text.ts";

/** Written first so Excel reads the file as UTF-8 and shows Vietnamese diacritics correctly. */
export const CSV_BYTE_ORDER_MARK = "\uFEFF";

export type CsvColumn<T> = {
  label: string;
  value: (row: T) => unknown;
};

export const toCsv = <T>(rows: readonly T[], columns: ReadonlyArray<CsvColumn<T>>): string => {
  const table = [
    columns.map((column) => column.label),
    ...rows.map((row) =>
      columns.map((column) => {
        const value = column.value(row);
        // A string that a spreadsheet would read as a formula gets a leading apostrophe. Numbers are left alone, and so is
        // a lone "-", the table's "no value" mark, which no spreadsheet reads as a formula.
        return typeof value === "string" && value !== "-" && /^[=+\-@\t\r]/.test(value)
          ? `'${value}`
          : toPlainText(value);
      }),
    ),
  ];
  // RFC 4180: fields containing a comma, quote, CR or LF are wrapped in quotes with inner quotes doubled; records end in CRLF.
  const lines = table.map(
    (cells) =>
      cells.map((cell) => (/[",\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell)).join(",") + "\r\n",
  );
  return CSV_BYTE_ORDER_MARK + lines.join("");
};

/** Saves CSV text as a file through a temporary object URL. Call it from a click handler. */
export const downloadCsv = (filename: string, csv: string): void => {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};
