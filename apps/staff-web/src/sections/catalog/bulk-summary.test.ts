import { describe, expect, it } from "vitest";

import { formatFailures, summarizeBulk } from "./bulk-summary.ts";

describe("summarizeBulk", () => {
  it("counts successes and keeps failures in row order", () => {
    const summary = summarizeBulk([
      { id: "1", label: "SKU-1", ok: true },
      { id: "2", label: "SKU-2", ok: false, message: "Only Draft prices can be published" },
      { id: "3", label: "SKU-3", ok: true },
      { id: "4", label: "SKU-4", ok: false },
    ]);
    expect(summary.succeeded).toBe(2);
    expect(summary.total).toBe(4);
    expect(summary.failures).toEqual([
      { id: "2", label: "SKU-2", message: "Only Draft prices can be published" },
      { id: "4", label: "SKU-4", message: "" },
    ]);
  });

  it("reports an empty run as zero of zero", () => {
    expect(summarizeBulk([])).toEqual({ succeeded: 0, total: 0, failures: [] });
  });
});

describe("formatFailures", () => {
  it("joins labels with their reasons and omits the colon when there is no reason", () => {
    expect(
      formatFailures([
        { id: "2", label: "SKU-2", message: "Price overlaps" },
        { id: "4", label: "SKU-4", message: "" },
      ]),
    ).toBe("SKU-2: Price overlaps; SKU-4");
  });
});
