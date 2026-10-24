import { cn } from "../cn.ts";
import type { StatusTone } from "./status-badge.tsx";

/** `accent` is left out: it borrows a chart identity colour, and chart colours must not signal status. */
export type StatTileTone = Exclude<StatusTone, "accent">;

const TONE_EDGE: Record<StatTileTone, string> = {
  success: "bg-success",
  // The fill shade; `warning` itself is the dark text shade and reads brown as a bar.
  warning: "bg-warning-edge",
  danger: "bg-danger",
  info: "bg-primary",
  neutral: "bg-line",
};

export type StatTileProps = {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode | undefined;
  /**
   * Marks the tile as needing a look. Pass a tone only while the figure calls for it (for example a warning when the
   * count is above zero); a coloured edge on a zero tells people to ignore the colour. Colours the top edge only; the
   * value stays ink so numbers remain readable.
   */
  tone?: StatTileTone | undefined;
  className?: string | undefined;
};

/** Dashboard KPI tile. Lay several out in a grid such as `grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-2.5`. */
export const StatTile = ({ label, value, hint, tone, className }: StatTileProps): React.JSX.Element => (
  <div
    data-tone={tone}
    className={cn(
      "relative grid min-w-0 gap-1 overflow-hidden rounded-lg border border-line bg-surface px-4 py-3",
      className,
    )}
  >
    {/* A bar clipped by the rounded corners, because a thick top border bends into a crescent at the corners. */}
    {tone ? <span aria-hidden="true" className={cn("absolute inset-x-0 top-0 h-0.5", TONE_EDGE[tone])} /> : null}
    <p className="text-xs font-semibold tracking-wide text-muted uppercase">{label}</p>
    <p className="text-2xl font-semibold tracking-tight text-ink tabular-nums">{value}</p>
    {hint ? <p className="text-xs text-muted">{hint}</p> : null}
  </div>
);
