import { describe, expect, it } from "vitest";

import { DEAD_STOCK_DAYS, expiryBucket, expiryWindows } from "./stock-health.ts";

const asOf = new Date("2026-10-28T12:00:00Z");

describe("expiryWindows", () => {
  it("cuts the buckets on the UTC calendar day 30, 60 and 90 days out", () => {
    expect(expiryWindows(asOf)).toEqual({
      today: "2026-10-28",
      within30: "2026-11-27",
      within60: "2026-12-27",
      within90: "2027-01-26",
    });
  });

  it("takes the calendar day in UTC, not the local day", () => {
    // 23:30 on 28 October at UTC-5 is 04:30 on 29 October in UTC.
    expect(expiryWindows(new Date("2026-10-28T23:30:00-05:00")).today).toBe("2026-10-29");
  });
});

describe("expiryBucket", () => {
  it("buckets each boundary day: today and 30 days out in expiring30, 31 and 60 in expiring60, 61 and 90 in expiring90", () => {
    expect(expiryBucket("2026-10-28", asOf)).toBe("expiring30"); // 0 days
    expect(expiryBucket("2026-11-27", asOf)).toBe("expiring30"); // 30 days
    expect(expiryBucket("2026-11-28", asOf)).toBe("expiring60"); // 31 days
    expect(expiryBucket("2026-12-27", asOf)).toBe("expiring60"); // 60 days
    expect(expiryBucket("2026-12-28", asOf)).toBe("expiring90"); // 61 days
    expect(expiryBucket("2027-01-26", asOf)).toBe("expiring90"); // 90 days
    expect(expiryBucket("2027-01-27", asOf)).toBeNull(); // 91 days
  });

  it("counts a batch that expired before today as expired, however long ago", () => {
    expect(expiryBucket("2026-10-27", asOf)).toBe("expired"); // yesterday
    expect(expiryBucket("2000-01-01", asOf)).toBe("expired");
  });

  it("compares against the UTC day of asOf, so a batch expiring today is not yet expired", () => {
    expect(expiryBucket("2026-10-28", new Date("2026-10-28T23:59:59Z"))).toBe("expiring30");
    expect(expiryBucket("2026-10-28", new Date("2026-10-29T00:00:00Z"))).toBe("expired");
  });
});

describe("DEAD_STOCK_DAYS", () => {
  it("is the 90-day dead stock window of the design", () => {
    expect(DEAD_STOCK_DAYS).toBe(90);
  });
});
