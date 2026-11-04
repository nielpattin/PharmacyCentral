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
  ProductRevenueRow,
  SalesSiteRow,
} from "./contract.ts";
import { isAnswered } from "./figures.ts";

/** How many products the ranked list shows; the table under it carries the rest. */
export const TOP_PRODUCT_BARS = 8;

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

export const productBars = (
  rows: readonly ProductRevenueRow[],
  format: Formatters,
  limit = TOP_PRODUCT_BARS,
): RevenueBar[] =>
  byRevenueDesc(rows)
    .slice(0, limit)
    .map((row) => ({
      key: row.productId,
      label: row.productName,
      value: barValue(row.revenue),
      answered: isAnswered(row.revenue),
      display: format.money(row.revenue),
      hint: format.rate(row.share),
    }));

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
