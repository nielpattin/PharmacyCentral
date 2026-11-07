import { describe, expect, it } from "vitest";

import { invoiceTimeline, methodLabel, recordsOf } from "./invoice-detail.ts";

describe("invoiceTimeline", () => {
  it("lists the creation, attempts, bank amounts and refunds, newest first", () => {
    const events = invoiceTimeline({
      createdAt: "2026-11-06T09:00:00Z",
      attempts: [{ createdAt: "2026-11-06T09:00:05Z", method: "sepay_qr", status: "Pending", amount: "27360.00" }],
      transactions: [{ receivedAt: "2026-11-06T09:10:00Z", providerTransactionId: "TX-1", amount: "27360.00" }],
      refunds: [{ createdAt: "2026-11-07T08:00:00Z", amount: "27360.00", reason: "Khách đổi ý" }],
    });
    expect(events.map((event) => event.label)).toEqual([
      "Refunded",
      "Money received",
      "Payment attempt",
      "Invoice created",
    ]);
    expect(events[0]).toMatchObject({ note: "Khách đổi ý", tone: "info" });
    expect(events[2]).toMatchObject({ note: "Bank transfer QR · Pending", tone: "warning" });
  });

  it("is only the creation for an invoice nothing has happened to", () => {
    expect(invoiceTimeline({ createdAt: "2026-11-06T09:00:00Z" })).toHaveLength(1);
    expect(invoiceTimeline({})).toEqual([]);
  });

  it("ignores lists that are not arrays of records", () => {
    expect(recordsOf("x")).toEqual([]);
    expect(recordsOf([1, null, { a: 1 }])).toEqual([{ a: 1 }]);
  });
});

describe("methodLabel", () => {
  it("names the known methods and passes others on as stored", () => {
    expect(methodLabel("sepay_qr")).toBe("Bank transfer QR");
    expect(methodLabel("cash")).toBe("Cash");
    expect(methodLabel("cash_on_delivery")).toBe("Cash on delivery");
    expect(methodLabel("card")).toBe("card");
    expect(methodLabel(undefined)).toBe("");
  });
});
