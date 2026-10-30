/**
 * Pure period rules for the Analytics screen: presets, the local-day boundaries sent to the API, and the checks on a
 * custom range. No React or API imports, so node can test them.
 *
 * A range is two calendar days in local time, both ends inclusive ("YYYY-MM-DD"). The API takes `from` inclusive and
 * `to` exclusive, so `to` is sent as the local midnight after the last day.
 */

export const PERIOD_PRESETS = ["7d", "30d", "90d", "month", "custom"] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

/**
 * The longest range the screen asks for, in inclusive days. The API allows 366 days between `from` and `to`; 365 keeps
 * a daylight-saving change inside a range from pushing the elapsed time past that limit.
 */
export const MAX_PERIOD_DAYS = 365;

export type DayRange = { fromDay: string; toDay: string };

export type PeriodRangeError = "missing" | "invalid" | "order" | "tooLong";

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The local calendar day of a date, as "YYYY-MM-DD". */
export const formatDay = (date: Date): string => {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
};

/** The local midnight starting a "YYYY-MM-DD" day, or undefined when the text is not a real calendar day. */
export const parseDay = (value: string): Date | undefined => {
  const match = DAY_PATTERN.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  // `new Date` rolls 2026-02-30 over to March; a real day reads back as the same numbers.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return undefined;
  return date;
};

export const addDays = (date: Date, days: number): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

/** Whole calendar days from `fromDay` to `toDay`, both inclusive. Counted in UTC so a daylight-saving change cannot shift it. */
export const inclusiveDayCount = (range: DayRange): number | undefined => {
  const from = parseDay(range.fromDay);
  const to = parseDay(range.toDay);
  if (!from || !to) return undefined;
  const fromUtc = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const toUtc = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((toUtc - fromUtc) / MS_PER_DAY) + 1;
};

/** The day range a preset stands for, ending today. `today` is injected so the rule is testable. */
export const presetRange = (preset: Exclude<PeriodPreset, "custom">, today: Date): DayRange => {
  const end = formatDay(today);
  if (preset === "month") {
    return { fromDay: formatDay(new Date(today.getFullYear(), today.getMonth(), 1)), toDay: end };
  }
  const days = preset === "7d" ? 7 : preset === "30d" ? 30 : 90;
  return { fromDay: formatDay(addDays(today, 1 - days)), toDay: end };
};

/** Why a range cannot be queried, or undefined when it can. */
export const periodRangeError = (range: DayRange): PeriodRangeError | undefined => {
  if (range.fromDay === "" || range.toDay === "") return "missing";
  const count = inclusiveDayCount(range);
  if (count === undefined) return "invalid";
  if (count < 1) return "order";
  if (count > MAX_PERIOD_DAYS) return "tooLong";
  return undefined;
};

/**
 * The API bounds for a range: `from` is the local midnight of the first day, `to` the local midnight after the last day
 * (exclusive). Only call this for a range whose `periodRangeError` is undefined.
 */
export const periodBounds = (range: DayRange): { from: string; to: string } => {
  const from = parseDay(range.fromDay);
  const to = parseDay(range.toDay);
  if (!from || !to) throw new Error(`periodBounds needs valid days, got ${range.fromDay} to ${range.toDay}`);
  return { from: from.toISOString(), to: addDays(to, 1).toISOString() };
};

/** A day as the screen's locale writes it, for example "22 thg 10, 2026" or "Oct 22, 2026". */
export const formatDayLabel = (day: string, locale: string): string => {
  const date = parseDay(day);
  return date ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date) : day;
};

/**
 * The last day an API period covers, from its exclusive `to` bound, as "YYYY-MM-DD". Used to label the periods the
 * server answered, so the screen shows the days the figures cover.
 */
export const lastDayBefore = (exclusiveIso: string): string => formatDay(new Date(Date.parse(exclusiveIso) - 1));

/** The first day of an API period, from its inclusive `from` bound, as "YYYY-MM-DD". */
export const firstDayOf = (inclusiveIso: string): string => formatDay(new Date(Date.parse(inclusiveIso)));

export const isPeriodPreset = (value: string): value is PeriodPreset =>
  (PERIOD_PRESETS as readonly string[]).includes(value);

/** The local calendar month of a date, as "YYYY-MM". */
export const monthOf = (date: Date): string => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

/** The inclusive day range of a "YYYY-MM" month, or undefined when the text is not a real month. */
export const monthRange = (month: string): DayRange | undefined => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return undefined;
  const first = parseDay(`${month}-01`);
  if (!first) return undefined;
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  return { fromDay: `${month}-01`, toDay: formatDay(last) };
};

export const isMonth = (value: string): boolean => monthRange(value) !== undefined;
