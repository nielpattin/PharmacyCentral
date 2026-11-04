import { describe, expect, it } from "vitest";

import { compareRows, donutShares, truncateLabel } from "./compare-rows.ts";

describe("compareRows", () => {
  it("keys each series value by position and keeps the category label", () => {
    expect(compareRows([{ key: "a", label: "Site A", values: [10, 20] }], 2)).toEqual([
      { key: "a", label: "Site A", s0: 10, s1: 20 },
    ]);
  });

  it("turns a missing, null or non-finite value into null, never 0", () => {
    const [row] = compareRows([{ key: "a", label: "A", values: [null, Number.NaN] }], 3);
    expect(row).toEqual({ key: "a", label: "A", s0: null, s1: null, s2: null });
  });

  it("keeps a real zero", () => {
    const [row] = compareRows([{ key: "a", label: "A", values: [0] }], 1);
    expect(row?.s0).toBe(0);
  });
});

describe("truncateLabel", () => {
  it("leaves a short label alone", () => {
    expect(truncateLabel("Cầu Giấy", 10)).toBe("Cầu Giấy");
  });

  it("cuts a long label to the limit with an ellipsis", () => {
    const cut = truncateLabel("Nhà thuốc Pharmacy Central Cầu Giấy", 12);
    expect(cut).toHaveLength(12);
    expect(cut.endsWith("…")).toBe(true);
  });
});

describe("donutShares", () => {
  it("gives each part its fraction of the whole", () => {
    const { slices, total } = donutShares([
      { key: "a", value: 30 },
      { key: "b", value: 70 },
    ]);
    expect(total).toBe(100);
    expect(slices.map((slice) => slice.fraction)).toEqual([0.3, 0.7]);
  });

  it("counts negative and non-finite parts as zero", () => {
    const { slices, total } = donutShares([
      { key: "a", value: -5 },
      { key: "b", value: Number.NaN },
      { key: "c", value: 10 },
    ]);
    expect(total).toBe(10);
    expect(slices.map((slice) => slice.size)).toEqual([0, 0, 10]);
  });

  it("returns a zero total and zero fractions when nothing is positive", () => {
    const { slices, total } = donutShares([{ key: "a", value: 0 }]);
    expect(total).toBe(0);
    expect(slices[0]?.fraction).toBe(0);
  });
});
