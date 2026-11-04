import { cn } from "../cn.ts";

export type SharePart = {
  key: string;
  label: React.ReactNode;
  /** The number the segment is sized from. Negative, zero or non-finite values draw no segment. */
  value: number;
  /** The figure as text, already formatted. */
  display: React.ReactNode;
};

export type ShareBarProps = {
  parts: readonly SharePart[];
  /** Text shown when every part is zero. */
  empty: string;
  /** Formats a part's share of the whole for the legend, for example `12.5%`. */
  formatShare: (fraction: number) => string;
  className?: string | undefined;
};

// Identity colours from the chart palette, so no segment looks like a status.
const SEGMENT_CLASSES = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5"] as const;

/**
 * One bar split into the parts of a whole, with a legend of label, figure and share. For two to five parts such as the
 * channels or the A/B/C classes. The legend carries every number, so the colours never carry meaning alone.
 */
export const ShareBar = ({ parts, empty, formatShare, className }: ShareBarProps): React.JSX.Element => {
  const sized = parts.map((part) => ({
    ...part,
    size: Number.isFinite(part.value) && part.value > 0 ? part.value : 0,
  }));
  const total = sized.reduce((sum, part) => sum + part.size, 0);
  if (total <= 0) return <p className={cn("py-4 text-sm text-muted", className)}>{empty}</p>;
  return (
    <div className={cn("grid gap-3", className)}>
      <div aria-hidden="true" className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full">
        {sized.map((part, index) =>
          part.size > 0 ? (
            <span
              key={part.key}
              className={cn("h-full", SEGMENT_CLASSES[index % SEGMENT_CLASSES.length])}
              style={{ width: `${(part.size / total) * 100}%` }}
            />
          ) : null,
        )}
      </div>
      <ul className="grid gap-1.5 text-sm">
        {sized.map((part, index) => (
          <li key={part.key} className="flex items-center justify-between gap-4">
            <span className="flex min-w-0 items-center gap-2 text-ink">
              <span
                aria-hidden="true"
                className={cn("size-2 shrink-0 rounded-full", SEGMENT_CLASSES[index % SEGMENT_CLASSES.length])}
              />
              <span className="truncate">{part.label}</span>
            </span>
            <span className="shrink-0 tabular-nums">
              <span className="font-semibold text-ink">{part.display}</span>
              <span className="ml-2 text-muted">{formatShare(part.size / total)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};
