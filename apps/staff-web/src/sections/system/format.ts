// Display formatting for the System page. Numbers follow the staff member's language through formatQuantity.
import { getLanguage } from "../../i18n.ts";
import { formatQuantity } from "../../staff-api.ts";

export const DASH = "-";

const BYTES_PER_MIB = 1024 * 1024;

const isMissing = (value: number | null | undefined): value is null | undefined =>
  value === null || value === undefined;

export const formatMilliseconds = (ms: number | null | undefined): string =>
  isMissing(ms) ? DASH : `${formatQuantity(ms)} ms`;

/** CPU as millicores (1000 m is one core), so a lightly loaded service does not read as 0. */
export const formatMillicores = (cores: number | null | undefined): string =>
  isMissing(cores) ? DASH : `${formatQuantity(Math.round(cores * 1000))} m`;

export const formatMebibytes = (bytes: number | null | undefined): string =>
  isMissing(bytes) ? DASH : formatQuantity(bytes / BYTES_PER_MIB);

const chartLocale = (): string => (getLanguage() === "vi" ? "vi-VN" : "en-US");

/** Chart axis label. Windows longer than six hours include the date, so ticks stay unambiguous. */
export const formatChartTime = (unixSeconds: number, includeDate: boolean): string => {
  const date = new Date(unixSeconds * 1000);
  const time = date.toLocaleTimeString(chartLocale(), { hour: "2-digit", minute: "2-digit", hour12: false });
  if (!includeDate) return time;
  return `${date.toLocaleDateString(chartLocale(), { day: "2-digit", month: "2-digit" })} ${time}`;
};
