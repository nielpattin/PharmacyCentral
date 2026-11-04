import { useMemo, useState } from "react";
import { Cell, Pie, PieChart } from "recharts";

import { cn } from "../cn.ts";
import { donutShares } from "../charts/compare-rows.ts";
import { toneColor, type ChartTone } from "../charts/palette.ts";
import { ChartContainer } from "./chart.tsx";
import type { ChartConfig } from "./chart.tsx";

export type DonutPart = {
  key: string;
  label: string;
  /** The number the slice is sized from. Negative, zero or non-finite values draw no slice. */
  value: number;
  /** The figure as text, already formatted. */
  display: string;
};

export type DonutChartProps = {
  parts: readonly DonutPart[];
  /** Text shown when every part is zero. */
  empty: string;
  /** Formats a part's share of the whole for the legend and tooltip, for example `12.5%`. */
  formatShare: (fraction: number) => string;
  /** A label and figure shown inside the ring, for example the total. */
  centre?: { label: string; value: string } | undefined;
  /** Height of the ring in pixels. Defaults to 200. */
  height?: number | undefined;
  className?: string | undefined;
};

const TONES: readonly ChartTone[] = ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5"];
const toneAt = (index: number): ChartTone => TONES[index % TONES.length] ?? "chart-1";

/** The hole is 62% of the ring; the text box keeps a margin inside it so it never touches the slices. */
const centreWidth = (height: number): number => Math.round(height * 0.62 * 0.84);

/** The figure shrinks (18px down to 10px) until it fits the hole on one line, about 0.6em per character. */
const centreFontSize = (value: string, height: number): number =>
  Math.max(10, Math.min(18, Math.floor(centreWidth(height) / (Math.max(value.length, 1) * 0.6))));

/**
 * A ring split into the parts of a whole, with a legend of label, figure and share beside it. For two to five parts
 * such as prescription against over-the-counter. The legend carries every number, so colour never carries meaning alone.
 */
export const DonutChart = ({
  parts,
  empty,
  formatShare,
  centre,
  height = 200,
  className,
}: DonutChartProps): React.JSX.Element => {
  const { slices, total } = useMemo(() => donutShares(parts), [parts]);
  // The tooltip is drawn here, not by Recharts: Recharts drops it while the pointer crosses a seam between slices, shows
  // the previous slice after a quick move, and restarts its slide from the top-left corner. The slices touch and a
  // surface-coloured stroke draws the seams, so this lookup by angle has no gaps.
  const [hover, setHover] = useState<{ x: number; y: number; index: number } | undefined>(undefined);
  const config = useMemo<ChartConfig>(
    () =>
      Object.fromEntries(
        parts.map((part, index) => [part.key, { label: part.label, color: toneColor(toneAt(index)) }]),
      ),
    [parts],
  );
  if (total <= 0) return <p className={cn("py-4 text-sm text-muted", className)}>{empty}</p>;
  const drawn = slices.filter((slice) => slice.size > 0);

  return (
    <div className={cn("grid items-center gap-4 sm:grid-cols-[auto_1fr]", className)}>
      <div
        className="relative mx-auto w-full sm:w-auto"
        style={{ height, minWidth: height }}
        onMouseMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const x = event.clientX - box.left;
          const y = event.clientY - box.top;
          const outer = Math.min(box.width, box.height) / 2;
          const dx = x - box.width / 2;
          const dy = y - box.height / 2;
          const radius = Math.hypot(dx, dy);
          if (radius > outer || radius < outer * 0.62) {
            setHover(undefined);
            return;
          }
          // Recharts starts at 3 o'clock and runs anticlockwise.
          const turn = ((Math.atan2(-dy, dx) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI);
          const sum = drawn.reduce((acc, slice) => acc + slice.size, 0);
          let edge = 0;
          const hit = drawn.find((slice) => {
            edge += slice.size / sum;
            return turn < edge;
          });
          setHover(hit ? { x, y, index: slices.indexOf(hit) } : undefined);
        }}
        onMouseLeave={() => setHover(undefined)}
      >
        <ChartContainer config={config} className="aspect-square h-full w-full" style={{ height }}>
          <PieChart>
            <Pie
              data={drawn.map((slice) => ({
                name: slice.label,
                value: slice.size,
                fill: toneColor(toneAt(slices.indexOf(slice))),
              }))}
              dataKey="value"
              nameKey="name"
              innerRadius="62%"
              outerRadius="100%"
              paddingAngle={0}
              stroke="var(--color-surface)"
              strokeWidth={drawn.length > 1 ? 3 : 0}
              isAnimationActive={false}
            >
              {drawn.map((slice) => (
                <Cell key={slice.key} fill={toneColor(toneAt(slices.indexOf(slice)))} />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>
        {centre ? (
          <div className="pointer-events-none absolute inset-0 grid place-content-center text-center">
            <div className="grid justify-items-center overflow-hidden" style={{ width: centreWidth(height) }}>
              <span className="max-w-full truncate text-xs text-muted">{centre.label}</span>
              <span
                className="font-semibold whitespace-nowrap text-ink tabular-nums"
                style={{ fontSize: centreFontSize(centre.value, height) }}
              >
                {centre.value}
              </span>
            </div>
          </div>
        ) : null}
        {hover && slices[hover.index] ? (
          <div
            className="pointer-events-none absolute z-20 flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs whitespace-nowrap shadow-md"
            style={{
              left: 0,
              top: 0,
              transform: `translate(${hover.x + 16}px, ${hover.y + 16}px)`,
              transition: "transform 200ms ease-out",
            }}
          >
            <span
              className="size-2.5 shrink-0 rounded-[2px]"
              style={{ backgroundColor: toneColor(toneAt(hover.index)) }}
            />
            <span className="text-muted">{slices[hover.index]?.label}</span>
            <span className="ml-2 font-medium text-ink tabular-nums">
              {slices[hover.index]?.display} · {formatShare(slices[hover.index]?.fraction ?? 0)}
            </span>
          </div>
        ) : null}
      </div>
      <ul className="grid gap-1.5 text-sm">
        {slices.map((slice, index) => (
          <li key={slice.key} className="flex items-center justify-between gap-4">
            <span className="flex min-w-0 items-center gap-2 text-ink">
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: toneColor(toneAt(index)) }}
              />
              <span className="truncate">{slice.label}</span>
            </span>
            <span className="shrink-0 tabular-nums">
              <span className="font-semibold text-ink">{slice.display}</span>
              <span className="ml-2 text-muted">{formatShare(slice.fraction)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};
