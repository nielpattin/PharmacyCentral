import type { JsonRecord } from "../../staff-api.ts";

export type IssueLocation = { row?: number; field: string };

export type SummaryEntry = { key: string; value: number };

/**
 * The service reports a failing row as `products.3.sku`. Staff read the row as the line of their file: the first data
 * row is row 1, because the header line is not counted. A path with no row index keeps the whole path as the field.
 */
export const parseIssuePath = (path: string): IssueLocation => {
  const segments = path.split(".");
  const position = segments.findIndex((segment) => /^\d+$/.test(segment));
  if (position === -1) return { field: path };
  return { row: Number(segments[position]) + 1, field: segments.slice(position + 1).join(".") };
};

// Numeric entries of the service summary, in the order the service wrote them (one entry per import step).
export const summaryEntries = (summary: JsonRecord): SummaryEntry[] =>
  Object.entries(summary)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    .map(([key, value]) => ({ key, value }));
