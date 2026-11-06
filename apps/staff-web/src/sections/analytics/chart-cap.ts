/**
 * Keeps a bar chart at a fixed height however many rows the server sends: the first bars are drawn and the rest merge into
 * one "Other" bar. No React imports, so node can test it.
 */
import type { ChartRow } from "./inventory-chart.ts";

/** How many ranked bars a chart draws before the rest is merged into one "Other" bar. */
export const MAX_CHART_BARS = 8;

/** Whether a list of `count` bars is cut: it is when merging hides at least two of them, since merging one only renames it. */
export const isCapped = (count: number, limit: number): boolean => count > limit + 1;

/**
 * The first `limit` chart rows, then one row named `other (n)` that adds up every row after them, series by series. The
 * rows must already be ranked. A series with no answered value in the merged rows stays null, so a missing figure is
 * never turned into 0.
 */
export const capChartRows = (rows: readonly ChartRow[], limit: number, other: string): ChartRow[] => {
  if (!isCapped(rows.length, limit)) return [...rows];
  const rest = rows.slice(limit);
  const width = Math.max(...rest.map((row) => row.values.length));
  const values = Array.from({ length: width }, (_, series) => {
    const answered = rest.flatMap((row) => {
      const value = row.values[series];
      return typeof value === "number" ? [value] : [];
    });
    return answered.length === 0 ? null : answered.reduce((sum, value) => sum + value, 0);
  });
  return [...rows.slice(0, limit), { key: "other", label: `${other} (${rest.length})`, values }];
};
