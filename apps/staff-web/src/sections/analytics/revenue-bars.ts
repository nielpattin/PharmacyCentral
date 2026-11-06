/**
 * Pure shaping of the revenue breakdown's rows for the ranked bars and the split bars. The wording and number formats
 * come in as arguments, so node can test these without React or the translation tables. A figure the server did not
 * answer draws no bar and reads "—"; it is never drawn or written as 0.
 */
import type { CompareDatum } from "@pharmacy/ui";

import type {
  AbcRevenueRow,
  CategoryRevenueRow,
  Figure,
  PrescriptionGroup,
  PrescriptionRevenueRow,
  SalesSiteRow,
} from "./contract.ts";
import { isAnswered } from "./figures.ts";
import { isCapped } from "./chart-cap.ts";

export type RevenueBar = {
  key: string;
  label: string;
  value: number;
  display: string;
  hint?: string | undefined;
  /** False when the server did not answer the revenue: the chart then draws no bar for the row. */
  answered: boolean;
};
export type RevenueShare = { key: string; label: string; value: number; display: string };

type Formatters = {
  money: (value: unknown) => string;
  count: (value: unknown) => string;
  rate: (value: unknown) => string;
};

/** The number a bar is drawn from: the answered figure, or 0 so an unanswered row draws an empty bar. */
const barValue = (figure: Figure | undefined): number => (isAnswered(figure) ? figure : 0);

/** Highest revenue first; unanswered revenue last, keeping the input order among equals. */
const byRevenueDesc = <T extends { revenue: Figure }>(rows: readonly T[]): T[] =>
  rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const left = isAnswered(a.row.revenue) ? a.row.revenue : Number.NEGATIVE_INFINITY;
      const right = isAnswered(b.row.revenue) ? b.row.revenue : Number.NEGATIVE_INFINITY;
      return right - left || a.index - b.index;
    })
    .map(({ row }) => row);

export const siteBars = (
  rows: readonly SalesSiteRow[],
  format: Formatters,
  words: { unknownSite: string; orders: string },
): RevenueBar[] =>
  byRevenueDesc(rows).map((row) => ({
    key: row.siteId ?? "unknown",
    label: row.siteName === null ? words.unknownSite : row.siteName,
    value: barValue(row.revenue),
    answered: isAnswered(row.revenue),
    display: format.money(row.revenue),
    hint: `${format.count(row.orderCount)} ${words.orders} · ${format.money(row.averageOrderValue)}`,
  }));

export const categoryBars = (
  rows: readonly CategoryRevenueRow[],
  format: Formatters,
  words: { uncategorized: string; translate?: (category: string) => string },
): RevenueBar[] =>
  byRevenueDesc(rows).map((row) => ({
    key: row.category ?? "uncategorized",
    label: row.category === null ? words.uncategorized : (words.translate?.(row.category) ?? row.category),
    value: barValue(row.revenue),
    answered: isAnswered(row.revenue),
    display: format.money(row.revenue),
    hint: format.rate(row.share),
  }));

/**
 * The first `limit` ranked bars, then one bar that adds up every bar after them, named `other (n)`. The bars must already
 * be ranked. The merged bar is unanswered only when every bar it merges is, so a dash is never turned into 0.
 */
export const capBars = (
  bars: readonly RevenueBar[],
  limit: number,
  words: { other: string; money: (value: unknown) => string },
): RevenueBar[] => {
  // Merging a single bar would only rename it, so one bar over the limit still shows whole.
  if (!isCapped(bars.length, limit)) return [...bars];
  const rest = bars.slice(limit);
  const total = rest.reduce((sum, bar) => sum + bar.value, 0);
  const answered = rest.some((bar) => bar.answered);
  return [
    ...bars.slice(0, limit),
    {
      key: "other",
      label: `${words.other} (${rest.length})`,
      value: total,
      answered,
      display: answered ? words.money(total) : words.money(null),
    },
  ];
};

/**
 * The ranked rows as chart categories, one revenue value each. An unanswered row keeps its place with no bar and a
 * dash after its name, so it is never drawn or read as 0.
 */
export const chartData = (bars: readonly RevenueBar[]): CompareDatum[] =>
  bars.map((bar) => ({
    key: bar.key,
    label: bar.answered ? bar.label : `${bar.label} · —`,
    values: [bar.answered ? bar.value : null],
  }));

const ABC_ORDER = ["A", "B", "C"] as const;

/** A, B, C in that order whatever order the server sent, each with its product count in the label. */
export const abcParts = (
  rows: readonly AbcRevenueRow[],
  format: Pick<Formatters, "money" | "count">,
  words: { classLabel: string; products: string },
): RevenueShare[] =>
  ABC_ORDER.flatMap((abcClass) => {
    const row = rows.find((candidate) => candidate.abcClass === abcClass);
    if (!row) return [];
    return [
      {
        key: abcClass,
        label: `${words.classLabel} ${abcClass} · ${words.products}: ${format.count(row.productCount)}`,
        value: barValue(row.revenue),
        display: format.money(row.revenue),
      },
    ];
  });

const GROUP_ORDER: readonly PrescriptionGroup[] = ["prescription", "otc", "unknown"];

/** Prescription, over the counter, then unknown; a group the server left out is not invented. */
export const prescriptionParts = (
  rows: readonly PrescriptionRevenueRow[],
  format: Pick<Formatters, "money">,
  labels: Record<PrescriptionGroup, string>,
): RevenueShare[] =>
  GROUP_ORDER.flatMap((group) => {
    const row = rows.find((candidate) => candidate.group === group);
    if (!row) return [];
    return [{ key: group, label: labels[group], value: barValue(row.revenue), display: format.money(row.revenue) }];
  });
