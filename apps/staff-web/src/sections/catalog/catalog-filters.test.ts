import { describe, expect, it } from "vitest";

import { priceListParams, productListParams } from "./catalog-filters.ts";

describe("productListParams", () => {
  it("sends trimmed search, category and a valid prescription flag", () => {
    expect(productListParams({ q: "  para ", category: " Pain ", prescriptionRequired: "true" })).toEqual({
      search: "para",
      category: "Pain",
      prescriptionRequired: "true",
    });
  });

  it("leaves out blank filters and unknown prescription values", () => {
    expect(productListParams({ q: "   ", category: "", prescriptionRequired: "maybe" })).toEqual({
      search: undefined,
      category: undefined,
      prescriptionRequired: undefined,
    });
  });
});

describe("priceListParams", () => {
  it("sends the status and the search text", () => {
    expect(priceListParams({ q: "SKU-1", status: "Draft" })).toEqual({ q: "SKU-1", status: "Draft" });
  });

  it("omits the status when it is all", () => {
    expect(priceListParams({ q: "", status: "all" })).toEqual({ q: undefined, status: undefined });
  });
});
