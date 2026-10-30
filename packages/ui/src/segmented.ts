import { cn } from "./cn.ts";

/**
 * The one look of every segmented control and tab group: a soft track with the chosen item raised on it, no outlines.
 * `ToggleGroup` (pick a setting) and `Tabs` (switch a view) both build on it, so they always match. The raised pill is
 * a separate `SEGMENT_THUMB` element that `placeThumb` slides under the chosen segment.
 */
export const SEGMENT_TRACK =
  "relative inline-flex w-fit max-w-full items-center gap-0.5 rounded-md bg-surface-soft p-0.5";

/** The raised pill. It is the first child of the track and sits behind the segments. */
export const SEGMENT_THUMB =
  "pointer-events-none absolute inset-y-0.5 left-0 w-(--thumb-w) translate-x-(--thumb-x) rounded-[5px] bg-surface shadow-sm";

export const segmentClass = (selected: boolean, className?: string): string =>
  cn(
    "relative z-10 inline-flex h-7 shrink-0 items-center justify-center rounded-[5px] px-2.5 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:pointer-events-none disabled:opacity-50",
    selected ? "text-ink" : "text-muted hover:text-ink",
    className,
  );
