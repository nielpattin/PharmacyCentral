/**
 * Pure shaping of the overview's day-by-day series for the line charts. The server labels each day in UTC+7 (Vietnam,
 * no daylight saving), so a day starts at that date's midnight there. No React imports, so node can test it.
 */
import type { TrendSeries } from "@pharmacy/ui";

import type { DailyPoint } from "./contract.ts";

type Chart = TrendSeries["points"][number];

/** Unix seconds of the start of a `YYYY-MM-DD` day in UTC+7, or null for a label that is not a date. */
export const dayStartSeconds = (date: string): number | null => {
  const milliseconds = Date.parse(`${date}T00:00:00+07:00`);
  return Number.isFinite(milliseconds) ? milliseconds / 1000 : null;
};

/** One chart point per day for the chosen figure, `shift` seconds later. A day with an unreadable label is left out. */
export const dailyPoints = (points: readonly DailyPoint[], field: "revenue" | "orders", shift = 0): Chart[] =>
  points.flatMap((point) => {
    const start = dayStartSeconds(point.date);
    return start === null ? [] : [[start + shift, point[field]] as const];
  });

/**
 * Seconds between the first day of the previous period and the first day of the current one. Moving the previous
 * period's days forward by this puts day 1 over day 1, so the two lines read against each other. Zero when either
 * period has no readable first day.
 */
export const periodShift = (current: readonly DailyPoint[], previous: readonly DailyPoint[]): number => {
  const now = current[0] ? dayStartSeconds(current[0].date) : null;
  const before = previous[0] ? dayStartSeconds(previous[0].date) : null;
  return now === null || before === null ? 0 : now - before;
};

/** The current period and, laid over it, the previous one, for one figure. */
export const comparedSeries = (
  series: { current: readonly DailyPoint[]; previous: readonly DailyPoint[] },
  field: "revenue" | "orders",
  labels: { current: string; previous: string },
): TrendSeries[] => [
  { key: "current", label: labels.current, tone: "chart-1", points: dailyPoints(series.current, field) },
  {
    key: "previous",
    label: labels.previous,
    tone: "neutral",
    points: dailyPoints(series.previous, field, periodShift(series.current, series.previous)),
  },
];

/** True when there is no day to draw: both periods are empty. */
export const hasNoDays = (series: { current: readonly DailyPoint[]; previous: readonly DailyPoint[] }): boolean =>
  series.current.length === 0 && series.previous.length === 0;

/** Compact money for an axis: "750K ₫". Falls back to the plain number when the currency code is not valid. */
export const compactMoney = (value: number, currency: string, locale: string): string => {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return String(value);
  }
};

/** A day for the x axis and tooltip: day and month in the Vietnamese pharmacy's own zone. */
export const formatDay = (unixSeconds: number, locale: string): string =>
  new Intl.DateTimeFormat(locale, { day: "numeric", month: "numeric", timeZone: "Asia/Ho_Chi_Minh" }).format(
    new Date(unixSeconds * 1000),
  );
