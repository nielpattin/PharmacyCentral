import { describe, expect, it } from "vitest";

import { drawnSize, rankByValue } from "./inventory-rows.ts";

describe("rankByValue", () => {
  it("puts the largest value first and keeps ties in input order", () => {
    const rows = [
      { id: "a", value: 10 },
      { id: "b", value: 30 },
      { id: "c", value: 10 },
    ];
    expect(rankByValue(rows).map((row) => row.id)).toEqual(["b", "a", "c"]);
  });

  it("puts an unanswered value last instead of treating it as zero", () => {
    const rows = [
      { id: "a", value: null },
      { id: "b", value: 0 },
      { id: "c", value: 5 },
      { id: "d", value: null },
    ];
    expect(rankByValue(rows).map((row) => row.id)).toEqual(["c", "b", "a", "d"]);
  });

  it("does not change the input", () => {
    const rows = [
      { id: "a", value: 1 },
      { id: "b", value: 2 },
    ];
    rankByValue(rows);
    expect(rows.map((row) => row.id)).toEqual(["a", "b"]);
  });
});

describe("drawnSize", () => {
  it("draws only positive answered values", () => {
    expect(drawnSize(12)).toBe(12);
    expect(drawnSize(0)).toBe(0);
    expect(drawnSize(-3)).toBe(0);
    expect(drawnSize(null)).toBe(0);
    expect(drawnSize(undefined)).toBe(0);
  });
});
