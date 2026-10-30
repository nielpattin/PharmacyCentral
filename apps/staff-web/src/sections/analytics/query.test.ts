import { describe, expect, it } from "vitest";

import { analyticsPath, isAnalyticsChannel, salesTargetsPath } from "./query.ts";

const BOUNDS = { from: "2026-09-29T00:00:00.000Z", to: "2026-10-29T00:00:00.000Z" };

describe("analyticsPath", () => {
  it("sends the section, the bounds and the channel, and the site when one is chosen", () => {
    const url = new URL(analyticsPath(BOUNDS, "site-1", "online", "revenue"), "http://staff.local");
    expect(url.pathname).toBe("/api/dashboard/analytics");
    expect(url.searchParams.get("section")).toBe("revenue");
    expect(url.searchParams.get("from")).toBe(BOUNDS.from);
    expect(url.searchParams.get("to")).toBe(BOUNDS.to);
    expect(url.searchParams.get("channel")).toBe("online");
    expect(url.searchParams.get("siteId")).toBe("site-1");
  });

  it("leaves the site out for all sites", () => {
    const url = new URL(analyticsPath(BOUNDS, undefined, "all", "overview"), "http://staff.local");
    expect(url.searchParams.has("siteId")).toBe(false);
    expect(url.searchParams.get("section")).toBe("overview");
    expect(url.searchParams.get("channel")).toBe("all");
  });

  it("names the section of each request, so one tab never reads another tab's block", () => {
    for (const section of ["overview", "revenue", "customers", "inventory"] as const) {
      const url = new URL(analyticsPath(BOUNDS, undefined, "all", section), "http://staff.local");
      expect(url.searchParams.get("section")).toBe(section);
      expect(url.searchParams.has("month")).toBe(false);
    }
  });
});

describe("salesTargetsPath", () => {
  it("stays the monthly target report, with no section", () => {
    const url = new URL(salesTargetsPath(BOUNDS, undefined, "2026-10"), "http://staff.local");
    expect(url.pathname).toBe("/api/dashboard/sales-targets");
    expect(url.searchParams.get("month")).toBe("2026-10");
    expect(url.searchParams.get("from")).toBe(BOUNDS.from);
    expect(url.searchParams.get("to")).toBe(BOUNDS.to);
    expect(url.searchParams.has("section")).toBe(false);
  });
});

describe("isAnalyticsChannel", () => {
  it("accepts the three channel filters only", () => {
    expect(["all", "counter", "online"].every(isAnalyticsChannel)).toBe(true);
    expect(isAnalyticsChannel("pos")).toBe(false);
  });
});
