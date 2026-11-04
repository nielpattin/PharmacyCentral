import { cn } from "../cn.ts";

export type BarListItem = {
  key: string;
  label: React.ReactNode;
  /** The number the bar is drawn from. Negative or non-finite values draw an empty bar. */
  value: number;
  /** The figure as text, already formatted. It is the readable value; the bar only shows proportion. */
  display: React.ReactNode;
  /** A smaller line under the label, such as a share or a count. */
  hint?: React.ReactNode;
};

export type BarListProps = {
  items: readonly BarListItem[];
  /** Text shown when there is nothing to list. */
  empty: string;
  /** The value a full bar stands for. Without it the largest value fills the bar; set it (e.g. 1 for a ratio) when bars are measured against a fixed target. A value above it is capped at a full bar. */
  max?: number | undefined;
  className?: string | undefined;
};

/**
 * Ranked rows, each with a bar scaled to the largest value (Tremor bar-list pattern). For top products, categories or
 * sites, where a table would hide how big the first row is next to the rest. The bar is decoration: the formatted
 * value is always written out.
 */
export const BarList = ({ items, empty, max: fullBar, className }: BarListProps): React.JSX.Element => {
  if (items.length === 0) return <p className={cn("py-4 text-sm text-muted", className)}>{empty}</p>;
  const max =
    fullBar !== undefined && Number.isFinite(fullBar) && fullBar > 0
      ? fullBar
      : Math.max(...items.map((item) => (Number.isFinite(item.value) ? item.value : 0)), 0);
  return (
    <ul className={cn("grid gap-3", className)}>
      {items.map((item) => {
        const share =
          max > 0 && Number.isFinite(item.value) && item.value > 0 ? Math.min(100, (item.value / max) * 100) : 0;
        return (
          <li key={item.key} className="grid gap-1.5">
            <div className="flex items-baseline justify-between gap-4 text-sm">
              <span className="min-w-0 truncate text-ink">{item.label}</span>
              <span className="shrink-0 font-semibold text-ink tabular-nums">{item.display}</span>
            </div>
            <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-line">
              <div className="h-full rounded-full bg-primary" style={{ width: `${share}%` }} />
            </div>
            {item.hint ? <p className="text-xs text-muted">{item.hint}</p> : null}
          </li>
        );
      })}
    </ul>
  );
};
