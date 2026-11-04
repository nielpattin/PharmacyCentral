import { getLanguage, translateText } from "../../i18n.ts";
import { formatDate, formatDateTime } from "../../staff-api.ts";
import type { FigurePair } from "../analytics/contract.ts";
import { formatPercentChange, percentChange } from "../analytics/figures.ts";

/** The most feed rows a dashboard lists after identical neighbours are folded together. */
export const FEED_ROWS = 8;

/** A count from the server, or "—" when it did not answer one. A missing figure is never shown as zero. */
export const figureText = (value: unknown, format: (value: unknown) => string): string =>
  typeof value === "number" && Number.isFinite(value) ? format(value) : "—";

const RELATIVE_UNITS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

const relativeFormatter = (): Intl.RelativeTimeFormat =>
  new Intl.RelativeTimeFormat(getLanguage() === "vi" ? "vi-VN" : "en-US", { numeric: "auto" });

/** "5 minutes ago" in the app language. */
export const formatRelative = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return formatDateTime(iso);
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const formatter = relativeFormatter();
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.trunc(seconds / size), unit);
  }
  return formatter.format(0, "second");
};

/** "Today", "Yesterday", then the date. Today and yesterday come from Intl, so they follow the app language. */
export const dayLabel = (offset: number, sample: Date): string => {
  if (offset > 1) return formatDate(sample.toISOString());
  const label = relativeFormatter().format(-offset, "day");
  return label.charAt(0).toLocaleUpperCase() + label.slice(1);
};

/** The change against the previous period, green up and red down, with the previous figure after it. */
export const Change = ({
  pair,
  format,
  locale,
}: {
  pair: FigurePair | undefined;
  format: (value: unknown) => string;
  locale: string;
}): React.JSX.Element => {
  const change = percentChange(pair?.current, pair?.previous);
  return (
    <span className="flex flex-wrap gap-x-2 tabular-nums">
      <span className={change === null ? undefined : change < 0 ? "text-danger-ink" : "text-success"}>
        {formatPercentChange(change, locale)}
      </span>
      <span>
        {translateText("Previous period")}: {format(pair?.previous)}
      </span>
    </span>
  );
};

export const SectionHeading = ({ title, note }: { title: string; note?: string | undefined }): React.JSX.Element => (
  <h2 className="flex flex-wrap items-baseline gap-x-2 text-base font-semibold text-ink">
    {translateText(title)}
    {note ? <span className="text-sm font-normal text-muted">{note}</span> : null}
  </h2>
);
