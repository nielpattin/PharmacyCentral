import { describe, expect, it } from "vitest";

import { fillText, summarizeBulk } from "./bulk-summary.ts";

describe("summarizeBulk", () => {
  it("counts every record and lists the ones that failed, in run order", () => {
    const summary = summarizeBulk([
      { label: "PO-1", ok: true },
      { label: "PO-2", ok: false, message: "Only Draft purchase orders can be approved" },
      { label: "PO-3", ok: true },
      { label: "PO-4", ok: true },
    ]);

    expect(summary).toEqual({
      done: 3,
      total: 4,
      failed: [{ label: "PO-2", message: "Only Draft purchase orders can be approved" }],
    });
  });

  it("reports no failures when every write succeeded", () => {
    expect(summarizeBulk([{ label: "PO-1", ok: true }])).toEqual({ done: 1, total: 1, failed: [] });
  });

  it("handles an empty selection", () => {
    expect(summarizeBulk([])).toEqual({ done: 0, total: 0, failed: [] });
  });
});

describe("fillText", () => {
  it("fills every named token and keeps tokens without a value", () => {
    expect(fillText("{done} of {total} approved. {extra}", { done: 3, total: 4 })).toBe("3 of 4 approved. {extra}");
  });

  it("leaves a sentence without tokens unchanged", () => {
    expect(fillText("Purchase order approved.", { done: 1 })).toBe("Purchase order approved.");
  });
});
