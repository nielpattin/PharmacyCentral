import { cn } from "../cn.ts";
import type { StatusTone } from "./status-badge.tsx";

export type StatTileTone = StatusTone;

// A small dot before the label. The fill shade for warning, because `warning` itself is the dark text shade.
const TONE_DOT: Record<StatTileTone, string> = {
  success: "bg-success",
  warning: "bg-warning-edge",
  danger: "bg-danger",
  info: "bg-primary",
  neutral: "bg-muted-soft",
};

export type StatTileProps = {
  label: string;
  value: React.ReactNode;
  /** A line under the figure, such as the change against the previous period. */
  hint?: React.ReactNode | undefined;
  /**
   * Marks the tile as needing a look: a dot before the label. Pass a tone only while the figure calls for it (for
   * example a warning when the count is above zero); a dot on a zero tells people to ignore it. The tile itself stays
   * neutral and the value stays ink, so numbers remain readable.
   */
  tone?: StatTileTone | undefined;
  /** The one figure a row is about: taller, with a larger value. */
  featured?: boolean | undefined;
  /** Adds the hover surface, for a tile wrapped in a link or button. The wrapper owns the focus ring. */
  interactive?: boolean | undefined;
  className?: string | undefined;
};

/**
 * Dashboard KPI tile: a soft, borderless surface with the label on top and the figure at the bottom, so the figures of
 * tiles in one row line up even when a label wraps. Lay several out in a grid such as
 * `grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3`.
 */
export const StatTile = ({
  label,
  value,
  hint,
  tone,
  featured,
  interactive,
  className,
}: StatTileProps): React.JSX.Element => (
  <div
    data-tone={tone}
    data-featured={featured ? "" : undefined}
    className={cn(
      "grid min-w-0 content-between gap-4 rounded-2xl bg-surface-soft p-5",
      featured ? "min-h-40" : "min-h-28",
      interactive ? "h-full transition-colors duration-150 hover:bg-line/60" : null,
      className,
    )}
  >
    <p className="flex items-center gap-2 text-sm text-muted">
      {tone ? <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", TONE_DOT[tone])} /> : null}
      {label}
    </p>
    <div className="grid gap-1">
      <p className={cn("font-semibold tracking-tight text-ink tabular-nums", featured ? "text-5xl" : "text-3xl")}>
        {value}
      </p>
      {hint ? <div className="text-xs text-muted">{hint}</div> : null}
    </div>
  </div>
);
