import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { cn } from "../cn.ts";
import { toneColor, type ChartTone, type Tone } from "../charts/palette.ts";
import { compareRows, wrapLabel, type CompareDatum } from "../charts/compare-rows.ts";
import { seriesDataKey } from "../charts/trend-rows.ts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "./chart.tsx";
import type { ChartConfig } from "./chart.tsx";

export type BarChartCompareSeries = { label: string; tone: ChartTone | Tone };

export type BarChartCompareProps = {
  /** One entry per category (a site, a product), with one value per series. */
  data: readonly CompareDatum[];
  /** One bar per series inside each category, so a site can show revenue next to its target. */
  series: readonly BarChartCompareSeries[];
  /** Height in pixels. Defaults to 250. */
  height?: number | undefined;
  /** Formats a value for the axis and tooltip, for example "12,5 tr" or "3,2%". */
  formatValue: (value: number) => string;
  /** `vertical` draws upright bars with the categories along the bottom; `horizontal` draws bars running sideways, for long labels such as product names. Defaults to `vertical`. */
  layout?: "vertical" | "horizontal" | undefined;
  className?: string | undefined;
};

// A category name wraps onto at most two lines, then ends in an ellipsis; the tooltip holds the whole name.
const VERTICAL_LABEL_CHARS = 14;
const HORIZONTAL_LABEL_CHARS = 26;
const LABEL_LINES = 2;
const LINE_HEIGHT = 13;
// About 6.2px per character at the axis font size, plus the gap to the bars.
const sidewaysAxisWidth = (chars: number): number => Math.round(chars * 6.2 + 20);
const UPRIGHT_AXIS_HEIGHT = 44;

type CategoryTickProps = { x?: number | string; y?: number | string; payload?: { value?: unknown } };

/** An axis label that wraps onto two lines instead of cutting at the first, so a long name stays readable. */
const categoryTick =
  (anchor: "end" | "middle", maxChars: number) =>
  ({ x: rawX = 0, y: rawY = 0, payload }: CategoryTickProps): React.JSX.Element => {
    const [x, y] = [Number(rawX), Number(rawY)];
    const value = payload?.value;
    const lines = wrapLabel(
      typeof value === "string" || typeof value === "number" ? String(value) : "",
      maxChars,
      LABEL_LINES,
    );
    // Sideways, the lines centre on the bar; upright, they hang below the axis.
    const first = anchor === "end" ? 4 - ((lines.length - 1) * LINE_HEIGHT) / 2 : 12;
    return (
      <text x={x} y={y} textAnchor={anchor}>
        {lines.map((line, index) => (
          <tspan key={`${index}-${line}`} x={x} dy={index === 0 ? first : LINE_HEIGHT}>
            {line}
          </tspan>
        ))}
      </text>
    );
  };

const categoryLabel = (payload: readonly { payload?: unknown }[] | undefined): string => {
  const row: unknown = payload?.[0]?.payload;
  return typeof row === "object" && row !== null && "label" in row && typeof row.label === "string" ? row.label : "";
};

/**
 * Grouped bar chart over categories, one bar per series. A null value draws no bar. Colours come from the tone of each
 * series, so the legend (shown from two series up) and the tooltip carry every number.
 */
export const BarChartCompare = ({
  data,
  series,
  height = 250,
  formatValue,
  layout = "vertical",
  className,
}: BarChartCompareProps): React.JSX.Element => {
  const rows = useMemo(() => compareRows(data, series.length), [data, series.length]);
  const config = useMemo<ChartConfig>(
    () =>
      Object.fromEntries(
        series.map((entry, index) => [seriesDataKey(index), { label: entry.label, color: toneColor(entry.tone) }]),
      ),
    [series],
  );
  const sideways = layout === "horizontal";
  const tooltip = (
    <ChartTooltipContent
      indicator="dot"
      labelFormatter={(_, payload) => categoryLabel(payload)}
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

  return (
    <ChartContainer config={config} className={cn("aspect-auto w-full", className)} style={{ height }}>
      <BarChart
        accessibilityLayer
        data={rows}
        layout={sideways ? "vertical" : "horizontal"}
        margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
        barGap={4}
        barCategoryGap="24%"
      >
        <CartesianGrid vertical={sideways} horizontal={!sideways} />
        {sideways ? (
          <>
            <XAxis type="number" tickLine={false} axisLine={false} tickMargin={8} tickFormatter={formatValue} />
            <YAxis
              type="category"
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              width={sidewaysAxisWidth(HORIZONTAL_LABEL_CHARS)}
              interval={0}
              tick={categoryTick("end", HORIZONTAL_LABEL_CHARS)}
            />
          </>
        ) : (
          <>
            <XAxis
              type="category"
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              interval={0}
              height={UPRIGHT_AXIS_HEIGHT}
              tick={categoryTick("middle", VERTICAL_LABEL_CHARS)}
            />
            <YAxis
              type="number"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              width={64}
              tickFormatter={formatValue}
            />
          </>
        )}
        <ChartTooltip cursor={{ fill: "var(--color-surface-soft)" }} content={tooltip} />
        {series.length > 1 ? <ChartLegend content={<ChartLegendContent />} /> : null}
        {series.map((entry, index) => (
          <Bar
            key={seriesDataKey(index)}
            name={entry.label}
            dataKey={seriesDataKey(index)}
            fill={`var(--color-${seriesDataKey(index)})`}
            radius={sideways ? [0, 4, 4, 0] : [4, 4, 0, 0]}
            maxBarSize={40}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
};
