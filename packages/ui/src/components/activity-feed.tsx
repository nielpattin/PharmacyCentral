import { cn } from "../cn.ts";

export type ActivityFeedItem = {
  key: string;
  /** What happened, in a short phrase. */
  title: React.ReactNode;
  /** How many identical events the row stands for. Shown as "×n" from two up. */
  count?: number | undefined;
  /** When, as short text such as "5 minutes ago". */
  time: React.ReactNode;
  /** The exact time, shown as a tooltip and read by assistive tech. */
  timeTitle?: string | undefined;
  /** Machine-readable time for the `<time>` element. */
  dateTime?: string | undefined;
};

export type ActivityFeedGroup = {
  key: string;
  /** The day the items belong to, for example "Today". */
  label: string;
  items: readonly ActivityFeedItem[];
};

export type ActivityFeedProps = {
  groups: readonly ActivityFeedGroup[];
  /** Text shown when there is nothing to list. */
  empty: string;
  /** Renders the "view all" link. It gets the class that styles it, so the router stays the caller's. */
  viewAll?: ((className: string) => React.ReactNode) | undefined;
  className?: string | undefined;
};

const VIEW_ALL_CLASS =
  "inline-flex rounded-sm text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary/50";

/**
 * A short, day-grouped list of what happened lately, one phrase per row with the time on the right. For a handful of
 * recent events on a dashboard; a table with paging stays the tool for the full history.
 */
export const ActivityFeed = ({ groups, empty, viewAll, className }: ActivityFeedProps): React.JSX.Element => (
  <div className={cn("grid gap-4", className)}>
    {groups.length === 0 ? (
      <p className="py-6 text-sm text-muted">{empty}</p>
    ) : (
      groups.map((group) => (
        <section key={group.key} aria-label={group.label} className="grid gap-1">
          <h3 className="text-sm font-semibold text-ink">{group.label}</h3>
          <ul className="divide-y divide-line">
            {group.items.map((item) => (
              <li key={item.key} className="flex items-baseline justify-between gap-4 py-2.5">
                <p className="min-w-0 text-sm text-ink">
                  {item.title}
                  {item.count !== undefined && item.count > 1 ? (
                    <span className="ml-1.5 text-muted tabular-nums">×{item.count}</span>
                  ) : null}
                </p>
                <time
                  dateTime={item.dateTime}
                  title={item.timeTitle}
                  className="shrink-0 text-sm text-muted tabular-nums"
                >
                  {item.time}
                </time>
              </li>
            ))}
          </ul>
        </section>
      ))
    )}
    {viewAll ? <div>{viewAll(VIEW_ALL_CLASS)}</div> : null}
  </div>
);
