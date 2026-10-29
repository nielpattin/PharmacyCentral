import { describe, expect, it } from "vitest";

import { firstUnitCostError, parseUnitCost } from "./unit-cost.ts";

describe("parseUnitCost", () => {
  it("reads a blank cost as unknown, never as 0", () => {
    expect(parseUnitCost("")).toEqual({ ok: true, value: null });
    expect(parseUnitCost("   ")).toEqual({ ok: true, value: null });
  });

  it("keeps an explicit 0, and a cost with up to two decimals", () => {
    expect(parseUnitCost("0")).toEqual({ ok: true, value: 0 });
    expect(parseUnitCost("1500")).toEqual({ ok: true, value: 1500 });
    expect(parseUnitCost("1234.5")).toEqual({ ok: true, value: 1234.5 });
    expect(parseUnitCost("1234.56")).toEqual({ ok: true, value: 1234.56 });
  });

  it("refuses a negative cost with its own message", () => {
    expect(parseUnitCost("-5")).toEqual({ ok: false, message: "The unit cost cannot be negative." });
  });

  it("refuses more than two decimals, a comma and text", () => {
    for (const input of ["10.123", "1,5", "1.000,5", "abc", "1e3", ".5"]) {
      expect(parseUnitCost(input)).toEqual({
        ok: false,
        message: "The unit cost must be a number with at most 2 decimals.",
      });
    }
  });

  it("refuses a cost above the limit the server accepts", () => {
    expect(parseUnitCost("1000000001")).toEqual({ ok: false, message: "The unit cost is too large." });
    expect(parseUnitCost("1000000000")).toEqual({ ok: true, value: 1_000_000_000 });
  });
});

describe("firstUnitCostError", () => {
  it("names the first line that cannot be sent", () => {
    expect(firstUnitCostError(["100", "", "x", "-1"])).toEqual({
      line: 3,
      message: "The unit cost must be a number with at most 2 decimals.",
    });
  });

  it("is undefined when every line is blank or valid", () => {
    expect(firstUnitCostError(["100", "", "0"])).toBeUndefined();
  });
});
