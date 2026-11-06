import { describe, expect, it } from "vitest";

import { capChartRows, isCapped } from "./chart-cap.ts";

const row = (key: string, ...values: Array<number | null>) => ({ key, label: key, values });

describe("isCapped", () => {
  it("is false up to one row over the limit, because merging one row only renames it", () => {
    expect(isCapped(8, 8)).toBe(false);
    expect(isCapped(9, 8)).toBe(false);
    expect(isCapped(10, 8)).toBe(true);
  });
});

describe("capChartRows", () => {
  it("leaves a short list alone", () => {
    const rows = [row("a", 1), row("b", 2), row("c", 3)];
    expect(capChartRows(rows, 2, "Other")).toEqual(rows);
  });

  it("merges the rows past the limit into one counted row, series by series", () => {
    const merged = capChartRows([row("a", 9, 9), row("b", 5, null), row("c", 4, 2), row("d", 3, 1)], 1, "Other");
    expect(merged.map((item) => item.key)).toEqual(["a", "other"]);
    expect(merged[1]).toEqual({ key: "other", label: "Other (3)", values: [12, 3] });
  });

  it("keeps a series null when no merged row answered it", () => {
    const merged = capChartRows([row("a", 9, 9), row("b", 5, null), row("c", 4, null)], 1, "Other");
    expect(merged[1]?.values).toEqual([9, null]);
  });
});
