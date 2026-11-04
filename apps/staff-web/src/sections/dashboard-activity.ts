/** One recorded event, already labelled for display. `occurredAt` is an ISO 8601 instant. */
export type ActivityEvent = { key: string; action: string; occurredAt: string };

/** A run of identical events seen as one row: the newest one's key and time, and how many it stands for. */
export type CollapsedEvent = ActivityEvent & { count: number };

const time = (event: { occurredAt: string }): number => Date.parse(event.occurredAt);

/**
 * Newest first, with each run of consecutive events of the same action folded into one row. Seven "Create action plan"
 * in a row read as "Create action plan ×7", not seven copies. Events with an unreadable time go last, in input order.
 */
export const collapseActivity = (events: readonly ActivityEvent[]): CollapsedEvent[] => {
  const sorted = [...events].sort((a, b) => {
    const left = Number.isNaN(time(a)) ? Number.NEGATIVE_INFINITY : time(a);
    const right = Number.isNaN(time(b)) ? Number.NEGATIVE_INFINITY : time(b);
    return right - left;
  });
  const rows: CollapsedEvent[] = [];
  for (const event of sorted) {
    const last = rows[rows.length - 1];
    if (last && last.action === event.action) last.count += 1;
    else rows.push({ ...event, count: 1 });
  }
  return rows;
};

/** Whole local calendar days from `date` to `now`: 0 is today, 1 is yesterday. A future time counts as today. */
export const dayOffset = (date: Date, now: Date): number => {
  const start = (value: Date): number => Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  return Math.max(0, Math.round((start(now) - start(date)) / 86_400_000));
};

export type DayGroup<T> = { key: string; offset: number; sample: Date; items: T[] };

/**
 * Groups events by local calendar day, keeping the input order. Events with an unreadable time join the oldest group
 * seen so far, or a group of their own at offset 0 when they come first.
 */
export const groupByDay = <T extends { occurredAt: string }>(items: readonly T[], now: Date): DayGroup<T>[] => {
  const groups: DayGroup<T>[] = [];
  for (const item of items) {
    const date = new Date(item.occurredAt);
    const valid = !Number.isNaN(date.getTime());
    const last = groups[groups.length - 1];
    if (!valid) {
      if (last) last.items.push(item);
      else groups.push({ key: "unknown", offset: 0, sample: now, items: [item] });
      continue;
    }
    const offset = dayOffset(date, now);
    if (last && last.offset === offset) last.items.push(item);
    else groups.push({ key: `${offset}:${date.toDateString()}`, offset, sample: date, items: [item] });
  }
  return groups;
};
