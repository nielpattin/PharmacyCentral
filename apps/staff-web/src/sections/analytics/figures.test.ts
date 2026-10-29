import { describe, expect, it } from "vitest";

import {
  formatCount,
  formatMoney,
  formatPercentChange,
  formatRate,
  partialCoveragePercent,
  percentChange,
  UNANSWERED,
} from "./figures.ts";

describe("percentChange", () => {
  it("is the change over the previous figure, signed", () => {
    expect(percentChange(120, 100)).toBe(20);
    expect(percentChange(80, 100)).toBe(-20);
    expect(percentChange(0, 50)).toBe(-100);
  });

  it("has no change to show when the previous figure is 0", () => {
    expect(percentChange(120, 0)).toBeNull();
    expect(percentChange(0, 0)).toBeNull();
  });

  it("has no change to show when either figure is unanswered", () => {
    expect(percentChange(120, null)).toBeNull();
    expect(percentChange(null, 100)).toBeNull();
    expect(percentChange(undefined, 100)).toBeNull();
    expect(percentChange(120, undefined)).toBeNull();
    expect(percentChange(Number.NaN, 100)).toBeNull();
  });

  it("uses the size of a negative base, so a rise from a loss reads as a rise", () => {
    expect(percentChange(-50, -100)).toBe(50);
  });
});

describe("formatting unanswered figures", () => {
  it("shows a dash for every figure the server did not answer, never 0", () => {
    for (const value of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, "12"]) {
      expect(formatCount(value, "en-US"), String(value)).toBe(UNANSWERED);
      expect(formatMoney(value, "VND", "en-US"), String(value)).toBe(UNANSWERED);
      expect(formatRate(value, "en-US"), String(value)).toBe(UNANSWERED);
    }
    expect(formatPercentChange(null, "en-US")).toBe(UNANSWERED);
  });

  it("shows a real zero as zero", () => {
    expect(formatCount(0, "en-US")).toBe("0");
    expect(formatRate(0, "en-US")).toBe("0%");
    expect(formatMoney(0, "VND", "en-US")).not.toBe(UNANSWERED);
    expect(formatPercentChange(0, "en-US")).toBe("0%");
  });
});

describe("formatCount", () => {
  it("uses the locale's digit grouping", () => {
    expect(formatCount(1234.5, "en-US")).toBe("1,234.5");
    expect(formatCount(1234.5, "vi-VN")).toBe("1.234,5");
  });
});

describe("formatMoney", () => {
  it("formats an answered amount in its currency", () => {
    expect(formatMoney(1750000, "VND", "vi-VN")).toContain("1.750.000");
  });
});

describe("formatRate", () => {
  it("shows a fraction as a percentage", () => {
    expect(formatRate(0.25, "en-US")).toBe("25%");
    expect(formatRate(0.125, "en-US")).toBe("12.5%");
  });
});

describe("formatPercentChange", () => {
  it("signs a rise and a fall", () => {
    expect(formatPercentChange(12.34, "en-US")).toBe("+12.3%");
    expect(formatPercentChange(-5, "en-US")).toBe("-5%");
  });
});

describe("partialCoveragePercent", () => {
  it("is the whole percent of revenue covered when part of it has no cost", () => {
    expect(partialCoveragePercent(0.5)).toBe(50);
    expect(partialCoveragePercent(0)).toBe(0);
  });

  it("rounds down, so a coverage just under 100% never reads as complete", () => {
    expect(partialCoveragePercent(0.999)).toBe(99);
  });

  it("has nothing to say when all revenue is covered or the coverage is unknown", () => {
    expect(partialCoveragePercent(1)).toBeNull();
    expect(partialCoveragePercent(null)).toBeNull();
    expect(partialCoveragePercent(undefined)).toBeNull();
  });
});
