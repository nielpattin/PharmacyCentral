import { describe, expect, it } from "vitest";

import { barValue, compactNumber, expiryChartRows, siteStockChartRows } from "./inventory-chart.ts";

describe("barValue", () => {
  it("keeps an answered figure, zero included, and turns anything else into no bar", () => {
    expect(barValue(12)).toBe(12);
    expect(barValue(0)).toBe(0);
    expect(barValue(null)).toBeNull();
    expect(barValue(undefined)).toBeNull();
  });
});

describe("compactNumber", () => {
  it("shortens a large amount", () => {
    expect(compactNumber(1_500_000, "en")).toBe("1.5M");
    expect(compactNumber(950, "en")).toBe("950");
  });
});

describe("siteStockChartRows", () => {
  it("ranks by value and leaves an unanswered site last with no bar", () => {
    const rows = siteStockChartRows([
      { siteId: "a", siteName: "A", value: null },
      { siteId: "b", siteName: "B", value: 5 },
      { siteId: "c", siteName: "C", value: 9 },
    ]);
    expect(rows.map((row) => row.key)).toEqual(["c", "b", "a"]);
    expect(rows.map((row) => row.values)).toEqual([[9], [5], [null]]);
  });
});

describe("expiryChartRows", () => {
  it("keeps the given order and gives a missing bucket no bar", () => {
    const rows = expiryChartRows([
      { key: "expired", label: "Expired", bucket: { value: 3 } },
      { key: "within30", label: "Within 30 days", bucket: undefined },
    ]);
    expect(rows).toEqual([
      { key: "expired", label: "Expired", values: [3] },
      { key: "within30", label: "Within 30 days", values: [null] },
    ]);
  });
});
