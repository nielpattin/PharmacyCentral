import { describe, expect, it } from "vitest";

import { transitionPrice, validatePriceWindow } from "./price-policy.ts";

describe("catalog price policy", () => {
  it("requires positive prices and valid date windows", () => {
    expect(() =>
      validatePriceWindow({ unitPrice: 0, currency: "VND", effectiveFrom: "2026-01-01", status: "Draft" }),
    ).toThrow();
    expect(() =>
      validatePriceWindow({
        unitPrice: 100,
        currency: "VND",
        effectiveFrom: "2026-02-01",
        effectiveTo: "2026-01-01",
        status: "Draft",
      }),
    ).toThrow();
    expect(() =>
      validatePriceWindow({ unitPrice: 100, currency: "VND", effectiveFrom: "2026-01-01", status: "Draft" }),
    ).not.toThrow();
  });

  it("allows only Draft to publish", () => {
    expect(transitionPrice("Draft", "publish")).toBe("Published");
    expect(transitionPrice("Published", "archive")).toBe("Archived");
    expect(() => transitionPrice("Published", "publish")).toThrow();
  });
});
