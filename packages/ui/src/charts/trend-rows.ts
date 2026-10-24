// Pure data shaping for the time-series charts: merges several sampled series into one row per timestamp, keyed by
// series position. No React and no DOM, so it can be tested in plain node.

import type { ChartTone, Tone } from "./palette.ts";

/** A sample as the metrics API returns it: [unix seconds, value], where value is null when the series has no data. */
type ChartPoint = readonly [unixSeconds: number, value: number | null];

export type TrendSeries = {
  key: string;
  label: string;
  tone: ChartTone | Tone;
  points: readonly ChartPoint[];
};

/** One chart row: `time` plus one value per series under `s<index>`. Missing samples are null. */
export type TrendRow = Record<string, number | null>;

/** The data key of the series at `index`. Keys are position-based so they are always safe as CSS identifiers. */
export const seriesDataKey = (index: number): string => `s${index}`;

/** Rows sorted by time. A timestamp missing from a series is null in that series. */
export const trendRows = (series: readonly TrendSeries[]): TrendRow[] => {
  const rows = new Map<number, TrendRow>();
  series.forEach((entry, index) => {
    for (const [time, value] of entry.points) {
      const row = rows.get(time) ?? { time };
      row[seriesDataKey(index)] = value;
      rows.set(time, row);
    }
  });
  return [...rows.values()]
    .sort((a, b) => (a.time ?? 0) - (b.time ?? 0))
    .map((row) => {
      for (let index = 0; index < series.length; index += 1) {
        const key = seriesDataKey(index);
        if (!(key in row)) row[key] = null;
      }
      return row;
    });
};
