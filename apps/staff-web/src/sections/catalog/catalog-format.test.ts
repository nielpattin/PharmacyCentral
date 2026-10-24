import { describe, expect, it } from "vitest";

import { fillTemplate, formatPrice, orNull } from "./catalog-format.ts";

describe("fillTemplate", () => {
  it("replaces known tokens and keeps unknown ones", () => {
    expect(fillTemplate("{succeeded} of {total} prices published. {note}", { succeeded: 3, total: 4 })).toBe(
      "3 of 4 prices published. {note}",
    );
  });
});

describe("formatPrice", () => {
  it("shows the amount with its currency symbol", () => {
    expect(formatPrice("1750000", "VND", "en-US")).toContain("1,750,000");
  });

  it("shows the amount alone when the currency code is not three letters", () => {
    expect(formatPrice(12.5, "dong", "en-US")).toBe("12.5");
  });

  it("shows a dash for a missing or non-numeric amount", () => {
    expect(formatPrice(null, "VND", "en-US")).toBe("-");
    expect(formatPrice(undefined, "VND", "en-US")).toBe("-");
    expect(formatPrice("abc", "VND", "en-US")).toBe("-");
  });
});

describe("orNull", () => {
  it("trims and maps blank text to null", () => {
    expect(orNull("  x ")).toBe("x");
    expect(orNull("   ")).toBeNull();
  });
});
