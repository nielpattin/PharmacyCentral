import { useId, useMemo } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { cn } from "../cn.ts";
import { trendRows, seriesDataKey, type TrendSeries } from "../charts/trend-rows.ts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip } from "./chart.tsx";
import { trendConfig, trendTooltipContent, type TrendChartProps } from "./trend-parts.tsx";

export type AreaTrendProps = TrendChartProps & { series: readonly TrendSeries[] };

/** Gradient area chart over time, one area per series. Stacked series add up to the total. */
export const AreaTrend = ({
  series,
  height = 250,
  formatValue,
  formatTime,
  stacked = false,
  className,
}: AreaTrendProps): React.JSX.Element => {
  const uid = useId().replace(/:/g, "");
  const rows = useMemo(() => trendRows(series), [series]);
  const config = useMemo(() => trendConfig(series), [series]);
  const gradientId = (index: number): string => `${uid}-fill-${index}`;
  // A stack id is only passed when stacking, so unstacked series carry no stackId prop at all.
  const stackProps = stacked ? { stackId: "stack" } : {};

  return (
    <ChartContainer config={config} className={cn("aspect-auto w-full", className)} style={{ height }}>
      <AreaChart accessibilityLayer data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          {series.map((_, index) => (
            <linearGradient key={gradientId(index)} id={gradientId(index)} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={`var(--color-${seriesDataKey(index)})`} stopOpacity={0.35} />
              <stop offset="95%" stopColor={`var(--color-${seriesDataKey(index)})`} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="time"
          type="number"
          domain={["dataMin", "dataMax"]}
          scale="time"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={32}
          tickFormatter={formatTime}
        />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} width={64} tickFormatter={formatValue} />
        <ChartTooltip cursor={{ stroke: "var(--color-line)" }} content={trendTooltipContent(formatValue, formatTime)} />
        {series.length > 1 ? <ChartLegend content={<ChartLegendContent />} /> : null}
        {series.map((entry, index) => (
          <Area
            key={seriesDataKey(index)}
            name={entry.label}
            dataKey={seriesDataKey(index)}
            type="monotone"
            stroke={`var(--color-${seriesDataKey(index)})`}
            strokeWidth={2}
            fill={`url(#${gradientId(index)})`}
            {...stackProps}
            connectNulls={false}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </ChartContainer>
  );
};
