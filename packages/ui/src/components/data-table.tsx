import type { ReactNode } from "react";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table.tsx";

export type DataColumn<T> = {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
};

const formatCell = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

export const DataTable = <T,>({
  rows,
  columns,
  empty = "No records found",
  getKey,
}: {
  rows: T[];
  columns: Array<DataColumn<T>>;
  empty?: string;
  getKey?: (row: T, index: number) => string;
}): React.JSX.Element => {
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted">{empty}</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead key={column.key}>{column.label}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow key={getKey ? getKey(row, index) : index}>
            {columns.map((column) => (
              <TableCell key={column.key}>
                {column.render ? column.render(row) : formatCell((row as Record<string, unknown>)[column.key])}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};
