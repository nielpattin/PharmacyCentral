import { cn } from "./cn.ts";

/**
 * The one look of every segmented control and tab group: a soft track with the chosen item raised on it, no outlines.
 * `ToggleGroup` (pick a setting) and `Tabs` (switch a view) both build on it, so they always match.
 */
export const SEGMENT_TRACK = "inline-flex w-fit max-w-full items-center gap-0.5 rounded-md bg-surface-soft p-0.5";

export const segmentClass = (selected: boolean, className?: string): string =>
  cn(
    "inline-flex h-7 shrink-0 items-center justify-center rounded-[5px] px-2.5 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:pointer-events-none disabled:opacity-50",
    selected ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
    className,
  );
