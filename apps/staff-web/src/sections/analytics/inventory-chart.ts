/**
 * Pure data shaping for the charts of the Inventory and Targets tabs. An unanswered figure is a missing bar (null), never
 * a zero bar. No React imports, so node can test them.
 */
import type { Figure } from "./contract.ts";
import { isAnswered } from "./figures.ts";

/** A chart row: a category and one value per series. */
export type ChartRow = { key: string; label: string; values: Array<number | null> };

/** The value a bar is drawn from: the answered figure, or null so an unanswered figure draws no bar. */
export const barValue = (figure: Figure | undefined): number | null => (isAnswered(figure) ? figure : null);

/** A short number for a chart axis or tooltip, for example "12,5 Tr" in Vietnamese or "12.5M" in English. */
export const compactNumber = (value: number, locale: string): string =>
  new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value);

/** One row per site, largest value first, an unanswered value last. A single series. */
export const siteStockChartRows = (
  rows: ReadonlyArray<{ siteId: string; siteName: string; value: Figure }>,
): ChartRow[] =>
  rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const left = isAnswered(a.row.value);
      const right = isAnswered(b.row.value);
      if (left && right) return (b.row.value as number) - (a.row.value as number) || a.index - b.index;
      if (left !== right) return left ? -1 : 1;
      return a.index - b.index;
    })
    .map(({ row }) => ({ key: row.siteId, label: row.siteName, values: [barValue(row.value)] }));

/** One row per expiry group, in the order given. A single series of the bucket's value. */
export const expiryChartRows = (
  rows: ReadonlyArray<{ key: string; label: string; bucket: { value: Figure } | undefined }>,
): ChartRow[] => rows.map((row) => ({ key: row.key, label: row.label, values: [barValue(row.bucket?.value)] }));
