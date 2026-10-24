import { cn } from "../cn.ts";
import type { StatusTone } from "./status-badge.tsx";

const TONE_BORDER: Record<StatusTone, string> = {
  success: "border-t-success",
  warning: "border-t-warning",
  danger: "border-t-danger",
  info: "border-t-primary",
  neutral: "border-t-line",
  accent: "border-t-chart-3",
};

export type StatTileProps = {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode | undefined;
  /** Colours the top edge only; the value stays ink so numbers remain readable. */
  tone?: StatusTone | undefined;
  className?: string | undefined;
};

/** Dashboard KPI tile. Lay several out in a grid such as `grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-2.5`. */
export const StatTile = ({ label, value, hint, tone, className }: StatTileProps): React.JSX.Element => (
  <div
    className={cn(
      "grid min-w-0 gap-1 rounded-lg border border-line border-t-2 bg-surface px-4 py-3 shadow-sm",
      tone ? TONE_BORDER[tone] : "border-t-line",
      className,
    )}
  >
    <p className="text-xs font-semibold tracking-wide text-muted uppercase">{label}</p>
    <p className="text-2xl font-semibold tracking-tight text-ink tabular-nums">{value}</p>
    {hint ? <p className="text-xs text-muted">{hint}</p> : null}
  </div>
);
