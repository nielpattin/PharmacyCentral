// Config and tooltip content for AreaTrend. Recharts finds Tooltip and Legend among the chart's direct
// children, so those elements are created inline by the charts and only their content comes from here.

import { ChartTooltipContent, type ChartConfig } from "./chart.tsx";
import { toneColor } from "../charts/palette.ts";
import { seriesDataKey, type TrendSeries } from "../charts/trend-rows.ts";

export type TrendChartProps = {
  series: readonly TrendSeries[];
  /** Height in pixels. Defaults to 250. */
  height?: number | undefined;
  /** Formats a value for the axis and tooltip, for example "12.5 req/s" or "3.2%". */
  formatValue: (value: number) => string;
  /** Formats a unix-seconds timestamp for the x axis and tooltip. */
  formatTime: (unixSeconds: number) => string;
  /** Stack the series instead of drawing them over each other. */
  stacked?: boolean | undefined;
  className?: string | undefined;
};

export const trendConfig = (series: readonly TrendSeries[]): ChartConfig =>
  Object.fromEntries(
    series.map((entry, index) => [seriesDataKey(index), { label: entry.label, color: toneColor(entry.tone) }]),
  );

/** Hovered timestamp, read from the row under the pointer. Empty when the row carries no time. */
const hoveredTime = (
  payload: readonly { payload?: unknown }[] | undefined,
  formatTime: (unixSeconds: number) => string,
): string => {
  const row: unknown = payload?.[0]?.payload;
  if (typeof row !== "object" || row === null || !("time" in row) || typeof row.time !== "number") return "";
  return formatTime(row.time);
};

/** Tooltip body: a header with the time, then one row per series with its colour dot, name, and formatted value. */
export const trendTooltipContent = (
  formatValue: (value: number) => string,
  formatTime: (unixSeconds: number) => string,
): React.ReactElement => (
  <ChartTooltipContent
    indicator="dot"
    labelFormatter={(_, payload) => hoveredTime(payload, formatTime)}
    formatter={(value, name, item) =>
      typeof value === "number" ? (
        <>
          <span className="size-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: item.color }} />
          <span className="flex flex-1 items-center justify-between gap-3 leading-none">
            <span className="text-muted">{String(name)}</span>
            <span className="font-medium text-ink tabular-nums">{formatValue(value)}</span>
          </span>
        </>
      ) : null
    }
  />
);
