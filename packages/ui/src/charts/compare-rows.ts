// Pure data shaping for the bar and donut charts. No React and no DOM, so it can be tested in plain node.

import { seriesDataKey } from "./trend-rows.ts";

export type CompareDatum = {
  key: string;
  label: string;
  /** One value per series, in series order. A missing or non-finite value draws no bar. */
  values: readonly (number | null)[];
};

/** One chart row: the category's key and label plus one value per series under `s<index>`. Unanswered values are null. */
export type CompareRow = { key: string; label: string } & Record<string, string | number | null>;

/** Rows for the grouped bar chart, one per category, with a value for every series (null when unanswered). */
export const compareRows = (data: readonly CompareDatum[], seriesCount: number): CompareRow[] =>
  data.map((datum) => {
    const row: CompareRow = { key: datum.key, label: datum.label };
    for (let index = 0; index < seriesCount; index += 1) {
      const value = datum.values[index];
      row[seriesDataKey(index)] = typeof value === "number" && Number.isFinite(value) ? value : null;
    }
    return row;
  });

/** Shortens an axis label to `max` characters with an ellipsis. Whole labels stay in the tooltip. */
export const truncateLabel = (label: string, max: number): string =>
  max > 1 && label.length > max ? `${label.slice(0, max - 1).trimEnd()}…` : label;

export type DonutInput = { key: string; value: number };

/** Each part's size (zero for negative or non-finite values), its fraction of the whole, and the whole. */
export const donutShares = <T extends DonutInput>(
  parts: readonly T[],
): { slices: (T & { size: number; fraction: number })[]; total: number } => {
  const sized = parts.map((part) => ({
    ...part,
    size: Number.isFinite(part.value) && part.value > 0 ? part.value : 0,
  }));
  const total = sized.reduce((sum, part) => sum + part.size, 0);
  return {
    slices: sized.map((part) => ({ ...part, fraction: total > 0 ? part.size / total : 0 })),
    total,
  };
};
