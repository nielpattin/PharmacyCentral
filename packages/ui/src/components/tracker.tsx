import { cn } from "../cn.ts";
import { TONE_BG, type Tone } from "../charts/palette.ts";

export type TrackerDatum = {
  key: string;
  tone: Tone;
  /** Shown on hover and focus, and read by assistive tech. */
  tooltip: string;
};

export type TrackerProps = {
  data: readonly TrackerDatum[];
  className?: string | undefined;
};

/** Row of status blocks, one per time slice (Tremor tracker pattern). Hover or focus shows the block's tooltip. */
export const Tracker = ({ data, className }: TrackerProps): React.JSX.Element => (
  <div className={cn("flex h-8 w-full items-stretch gap-[3px]", className)}>
    {data.map((datum) => (
      <span
        key={datum.key}
        role="img"
        aria-label={datum.tooltip}
        tabIndex={0}
        className="group relative flex-1 rounded-[3px] outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        <span aria-hidden="true" className={cn("block h-full w-full rounded-[3px]", TONE_BG[datum.tone])} />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 rounded-md border border-line bg-surface px-2 py-1 text-xs whitespace-nowrap text-ink shadow-md group-hover:block group-focus-visible:block"
        >
          {datum.tooltip}
        </span>
      </span>
    ))}
  </div>
);
