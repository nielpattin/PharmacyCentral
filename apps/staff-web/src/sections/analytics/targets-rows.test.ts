import { describe, expect, it } from "vitest";

import type { SalesTargetSiteRow } from "./contract.ts";
import { progressSize, rankByProgress } from "./targets-rows.ts";

const row = (siteId: string, target: number | null, revenue: number): SalesTargetSiteRow => ({
  siteId,
  siteName: siteId,
  target,
  revenue,
  progress: target === null || target === 0 ? null : revenue / target,
});

describe("rankByProgress", () => {
  it("orders sites with a target by progress and puts sites without one last", () => {
    const rows = [row("none", null, 500), row("low", 1000, 200), row("high", 1000, 900), row("over", 100, 150)];
    expect(rankByProgress(rows).map((r) => r.siteId)).toEqual(["over", "high", "low", "none"]);
  });

  it("keeps a zero-revenue site with a target ahead of a site without one", () => {
    const rows = [row("none", null, 0), row("zero", 1000, 0)];
    expect(rankByProgress(rows).map((r) => r.siteId)).toEqual(["zero", "none"]);
  });
});

describe("progressSize", () => {
  it("is 0 for a missing or zero progress and the progress otherwise", () => {
    expect(progressSize(null)).toBe(0);
    expect(progressSize(0)).toBe(0);
    expect(progressSize(0.4)).toBe(0.4);
    expect(progressSize(1.2)).toBe(1.2);
  });
});
