import { describe, expect, it } from "vitest";

import { addDays, defaultDueDate, expiryState, isIsoDate, isOverdue, todayIsoDate } from "./plan-state.ts";

describe("calendar dates", () => {
  it("accepts a real YYYY-MM-DD date and refuses the rest", () => {
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-1-05")).toBe(false);
    expect(isIsoDate("")).toBe(false);
  });

  it("adds whole days across month ends", () => {
    expect(addDays("2026-10-28", 7)).toBe("2026-11-04");
    expect(addDays("2026-10-28", 30)).toBe("2026-11-27");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("reads today's date in local time", () => {
    expect(todayIsoDate(new Date(2026, 9, 5, 12, 0))).toBe("2026-10-05");
  });

  it("sets the default due date seven days ahead of today", () => {
    expect(defaultDueDate("2026-10-28")).toBe("2026-11-04");
  });
});

describe("isOverdue", () => {
  it("flags an open or in-progress plan whose due date has passed", () => {
    expect(isOverdue({ status: "open", dueDate: "2026-10-27" }, "2026-10-28")).toBe(true);
    expect(isOverdue({ status: "in_progress", dueDate: "2026-10-27" }, "2026-10-28")).toBe(true);
  });

  it("does not flag a plan due today, nor a done plan whatever its date", () => {
    expect(isOverdue({ status: "open", dueDate: "2026-10-28" }, "2026-10-28")).toBe(false);
    expect(isOverdue({ status: "done", dueDate: "2026-10-01" }, "2026-10-28")).toBe(false);
  });
});

describe("expiryState", () => {
  const today = "2026-10-28";

  it("reads a batch past its expiry date as expired", () => {
    expect(expiryState("2026-10-27", today)).toBe("expired");
  });

  it("reads a batch expiring within 30 days, the last day included, as expiring", () => {
    expect(expiryState("2026-10-28", today)).toBe("expiring");
    expect(expiryState("2026-11-27", today)).toBe("expiring");
  });

  it("reads a batch expiring later than 30 days as ok", () => {
    expect(expiryState("2026-11-28", today)).toBe("ok");
  });
});
