import { describe, expect, it } from "vitest";

import type { SalesTargetSiteRow } from "./contract.ts";
import { targetsChartRows } from "./targets-chart.ts";

const row = (siteId: string, target: number | null, revenue: number | null): SalesTargetSiteRow => ({
  siteId,
  siteName: siteId.toUpperCase(),
  target,
  revenue,
  progress: target === null || target === 0 || revenue === null ? null : revenue / target,
});

describe("targetsChartRows", () => {
  it("draws revenue and target per site, most revenue first, and no target bar without a target", () => {
    const rows = targetsChartRows([row("a", null, 100), row("b", 1000, 400), row("c", 500, 0)], true);
    expect(rows).toEqual([
      { key: "b", label: "B", values: [400, 1000] },
      { key: "a", label: "A", values: [100, null] },
      { key: "c", label: "C", values: [0, 500] },
    ]);
  });

  it("draws revenue alone when no site has a target", () => {
    const rows = targetsChartRows([row("a", null, 5), row("b", null, 9)], false);
    expect(rows.map((r) => [r.key, r.values])).toEqual([
      ["b", [9]],
      ["a", [5]],
    ]);
  });

  it("gives an unanswered revenue no bar", () => {
    expect(targetsChartRows([row("a", 10, null)], true)[0]?.values).toEqual([null, 10]);
  });
});
