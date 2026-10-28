import { describe, expect, it } from "vitest";

import { analyticsPath, isAnalyticsChannel } from "./query.ts";

const BOUNDS = { from: "2026-09-29T00:00:00.000Z", to: "2026-10-29T00:00:00.000Z" };

describe("analyticsPath", () => {
  it("sends the bounds and the channel, and the site when one is chosen", () => {
    const url = new URL(analyticsPath(BOUNDS, "site-1", "online"), "http://staff.local");
    expect(url.pathname).toBe("/api/dashboard/analytics");
    expect(url.searchParams.get("from")).toBe(BOUNDS.from);
    expect(url.searchParams.get("to")).toBe(BOUNDS.to);
    expect(url.searchParams.get("channel")).toBe("online");
    expect(url.searchParams.get("siteId")).toBe("site-1");
  });

  it("leaves the site out for all sites", () => {
    const url = new URL(analyticsPath(BOUNDS, undefined, "all"), "http://staff.local");
    expect(url.searchParams.has("siteId")).toBe(false);
    expect(url.searchParams.get("channel")).toBe("all");
  });
});

describe("isAnalyticsChannel", () => {
  it("accepts the three channel filters only", () => {
    expect(["all", "counter", "online"].every(isAnalyticsChannel)).toBe(true);
    expect(isAnalyticsChannel("pos")).toBe(false);
  });
});
