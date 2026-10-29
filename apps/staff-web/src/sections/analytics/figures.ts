/**
 * Pure figure rules for the Analytics screen: the change against the previous period, and the formatting of figures
 * that may be unanswered. A figure that is not a finite number shows "—"; it is never shown as 0 (reporting decision 4).
 * No React or API imports, so node can test them.
 */
import { formatAmount } from "../sales/rules.ts";
import type { Figure } from "./contract.ts";

/** The mark for a figure the server did not answer. */
export const UNANSWERED = "—";

export const isAnswered = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/**
 * The percentage change from the previous period to the current one. `null` when either figure is unanswered or the
 * previous figure is 0, because there is then no base to change from.
 */
export const percentChange = (current: Figure | undefined, previous: Figure | undefined): number | null => {
  if (!isAnswered(current) || !isAnswered(previous) || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
};

/** A count or quantity in the locale's digits. */
export const formatCount = (value: unknown, locale: string): string =>
  isAnswered(value) ? new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value) : UNANSWERED;

/** An amount in its currency, for example "1.750.000 ₫" in Vietnamese. */
export const formatMoney = (value: unknown, currency: string, locale: string): string =>
  isAnswered(value) ? formatAmount(value, currency, locale) : UNANSWERED;

/** A share given as a fraction (0.25 is 25%). */
export const formatRate = (fraction: unknown, locale: string): string =>
  isAnswered(fraction)
    ? new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(fraction)
    : UNANSWERED;

/** A change already in percent (12.3 is +12.3%), signed so a rise and a fall read at a glance. */
export const formatPercentChange = (change: number | null, locale: string): string =>
  isAnswered(change)
    ? `${new Intl.NumberFormat(locale, { signDisplay: "exceptZero", maximumFractionDigits: 1 }).format(change)}%`
    : UNANSWERED;

/**
 * The whole percent of revenue that gross profit covers, or null when it covers all of it or the coverage is unknown.
 * Rounded down, so a coverage just under 100% never reads as complete.
 */
export const partialCoveragePercent = (coverage: Figure | undefined): number | null => {
  if (!isAnswered(coverage) || coverage >= 1) return null;
  return Math.floor(Math.max(coverage, 0) * 100);
};
