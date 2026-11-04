import { describe, expect, it } from "vitest";

import { collapseActivity, dayOffset, groupByDay } from "./dashboard-activity.ts";

const event = (key: string, action: string, occurredAt: string) => ({ key, action, occurredAt });

describe("collapseActivity", () => {
  it("folds a run of the same action into one row with the newest key and time", () => {
    const rows = collapseActivity([
      event("a", "Create action plan", "2026-11-03T06:39:00.000Z"),
      event("b", "Create action plan", "2026-11-03T06:41:00.000Z"),
      event("c", "Create action plan", "2026-11-03T06:40:00.000Z"),
      event("d", "Sign in", "2026-11-03T07:56:00.000Z"),
    ]);
    expect(rows).toEqual([
      { key: "d", action: "Sign in", occurredAt: "2026-11-03T07:56:00.000Z", count: 1 },
      { key: "b", action: "Create action plan", occurredAt: "2026-11-03T06:41:00.000Z", count: 3 },
    ]);
  });

  it("keeps two runs of the same action apart when another action sits between them", () => {
    const rows = collapseActivity([
      event("a", "Sign in", "2026-11-03T09:00:00.000Z"),
      event("b", "Change order status", "2026-11-03T08:00:00.000Z"),
      event("c", "Sign in", "2026-11-03T07:00:00.000Z"),
    ]);
    expect(rows.map((row) => [row.action, row.count])).toEqual([
      ["Sign in", 1],
      ["Change order status", 1],
      ["Sign in", 1],
    ]);
  });

  it("puts an unreadable time last and does not throw", () => {
    const rows = collapseActivity([
      event("a", "Change order status", "not a date"),
      event("b", "Sign in", "2026-11-03T09:00:00.000Z"),
    ]);
    expect(rows.map((row) => row.key)).toEqual(["b", "a"]);
  });

  it("returns an empty list for no events", () => {
    expect(collapseActivity([])).toEqual([]);
  });
});

describe("dayOffset", () => {
  const now = new Date(2026, 10, 3, 15, 0);
  it("counts local calendar days, not 24-hour spans", () => {
    expect(dayOffset(new Date(2026, 10, 3, 0, 5), now)).toBe(0);
    expect(dayOffset(new Date(2026, 10, 2, 23, 55), now)).toBe(1);
    expect(dayOffset(new Date(2026, 9, 30, 12, 0), now)).toBe(4);
  });

  it("treats a future time as today", () => {
    expect(dayOffset(new Date(2026, 10, 4, 9, 0), now)).toBe(0);
  });
});

describe("groupByDay", () => {
  const now = new Date(2026, 10, 3, 15, 0);
  it("splits the list at each change of day and keeps the order", () => {
    const groups = groupByDay(
      [
        { occurredAt: new Date(2026, 10, 3, 14, 0).toISOString() },
        { occurredAt: new Date(2026, 10, 3, 9, 0).toISOString() },
        { occurredAt: new Date(2026, 10, 2, 18, 0).toISOString() },
      ],
      now,
    );
    expect(groups.map((group) => [group.offset, group.items.length])).toEqual([
      [0, 2],
      [1, 1],
    ]);
  });

  it("attaches an unreadable time to the group before it", () => {
    const groups = groupByDay(
      [{ occurredAt: new Date(2026, 10, 3, 14, 0).toISOString() }, { occurredAt: "garbage" }],
      now,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.items).toHaveLength(2);
  });
});
