import { describe, expect, it } from "vitest";

import { parseIssuePath, summaryEntries } from "./import-result.ts";

describe("parseIssuePath", () => {
  it("turns a row index into a one-based data row and keeps the field", () => {
    expect(parseIssuePath("products.3.sku")).toEqual({ row: 4, field: "sku" });
  });

  it("keeps nested field names below the row", () => {
    expect(parseIssuePath("products.0.units.1.unitName")).toEqual({ row: 1, field: "units.1.unitName" });
  });

  it("returns the whole path as the field when no row is named", () => {
    expect(parseIssuePath("schemaVersion")).toEqual({ field: "schemaVersion" });
  });
});

describe("summaryEntries", () => {
  it("keeps only the numeric step counts, in the order received", () => {
    expect(summaryEntries({ sites: 2, storageLocations: 3, note: "ok", suppliers: 0 })).toEqual([
      { key: "sites", value: 2 },
      { key: "storageLocations", value: 3 },
      { key: "suppliers", value: 0 },
    ]);
  });
});
