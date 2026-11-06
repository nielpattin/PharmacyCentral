import { describe, expect, it } from "vitest";

import { reportDetails, reportTypeLabel } from "./report-text.ts";

const same = (value: string): string => value;

describe("reportTypeLabel", () => {
  it("words a known event type without its version", () => {
    expect(reportTypeLabel("sales.order.status-changed.v1", (value) => `[${value}]`)).toBe("[Order status changed]");
  });

  it("falls back to the type without its version", () => {
    expect(reportTypeLabel("catalog.audit.v1", same)).toBe("catalog.audit");
  });
});

describe("reportDetails", () => {
  it("lists the plain facts and leaves ids out", () => {
    const payload = JSON.stringify({ orderId: "59390926-5cbf-4b3d-8403-6ae319823e17", status: "Cancelled" });
    expect(reportDetails(payload, same)).toEqual(["Status: Cancelled"]);
  });

  it("drops uuid values under any key, and nested values", () => {
    const payload = { ref: "59390926-5cbf-4b3d-8403-6ae319823e17", lines: [1], unitCount: 3 };
    expect(reportDetails(payload, same)).toEqual(["Unit count: 3"]);
  });

  it("keeps text that is not JSON and gives nothing for an empty payload", () => {
    expect(reportDetails("plain note", same)).toEqual(["plain note"]);
    expect(reportDetails("", same)).toEqual([]);
  });
});
