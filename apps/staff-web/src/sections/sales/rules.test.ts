import { describe, expect, it } from "vitest";

import {
  dispensableBatches,
  activeStatus,
  canCancelPrescription,
  canConfirmCash,
  canCreateInvoice,
  canDispense,
  canRefund,
  createPrescriptionBody,
  dispenseBody,
  formatAmount,
  emptyPrescriptionHeader,
  emptyPrescriptionLine,
  isCounterInvoice,
  isDispenseQuantityValid,
  newIdempotencyKey,
  openDispenseLines,
  orderMoves,
  canRecordOrderCash,
  canRefundOrder,
  type OrderFacts,
  queryParam,
  remainingQuantity,
  statusParam,
} from "./rules.ts";

describe("status gates", () => {
  it("dispenses only pending or partly dispensed prescriptions", () => {
    expect(canDispense("Pending")).toBe(true);
    expect(canDispense("PartiallyDispensed")).toBe(true);
    expect(canDispense("Dispensed")).toBe(false);
    expect(canDispense("Cancelled")).toBe(false);
  });

  it("cancels draft, pending, and partly dispensed prescriptions only", () => {
    expect(canCancelPrescription("Draft")).toBe(true);
    expect(canCancelPrescription("Pending")).toBe(true);
    expect(canCancelPrescription("PartiallyDispensed")).toBe(true);
    expect(canCancelPrescription("Dispensed")).toBe(false);
  });

  it("raises an invoice for any live prescription, never for a cancelled one", () => {
    expect(canCreateInvoice("Pending")).toBe(true);
    expect(canCreateInvoice("PartiallyDispensed")).toBe(true);
    expect(canCreateInvoice("Dispensed")).toBe(true);
    expect(canCreateInvoice("Cancelled")).toBe(false);
  });

  it("confirms cash only while pending and refunds only paid invoices", () => {
    expect(canConfirmCash("Pending")).toBe(true);
    expect(canConfirmCash("Paid")).toBe(false);
    expect(canRefund("Paid")).toBe(true);
    expect(canRefund("Pending")).toBe(false);
  });
});

describe("counter invoices", () => {
  it("excludes invoices raised for an online order", () => {
    expect(isCounterInvoice({ orderId: "" })).toBe(true);
    expect(isCounterInvoice({ orderId: null })).toBe(true);
    expect(isCounterInvoice({ orderId: "order-1" })).toBe(false);
  });
});

describe("list params", () => {
  it("sends no status for the All tab and trims search text", () => {
    expect(statusParam("All")).toBeUndefined();
    expect(statusParam("Pending")).toBe("Pending");
    expect(queryParam("   ")).toBeUndefined();
    expect(queryParam("  RX-1 ")).toBe("RX-1");
  });

  it("falls back to the default tab when the URL names an unknown one", () => {
    expect(activeStatus("Paid", ["All", "Pending", "Paid"], "All")).toBe("Paid");
    expect(activeStatus("Bogus", ["All", "Pending", "Paid"], "All")).toBe("All");
  });
});

describe("amounts", () => {
  it("formats a currency amount in the screen locale and leaves an unknown code bare", () => {
    expect(formatAmount(1750000, "VND", "en-US")).toContain("1,750,000");
    expect(formatAmount(1750000, "VND", "en-US")).toContain("₫");
    expect(formatAmount(1750000, "", "en-US")).toBe("1,750,000");
  });

  it("shows a dash for a missing or non-numeric amount", () => {
    expect(formatAmount(null, "VND", "en-US")).toBe("-");
    expect(formatAmount("abc", "VND", "en-US")).toBe("-");
  });
});

describe("prescription body", () => {
  it("sends empty optional fields as null and quantities as numbers", () => {
    const header = { ...emptyPrescriptionHeader(), siteId: "site-1", storageLocationId: "loc-1", patientName: "An" };
    const line = {
      ...emptyPrescriptionLine(),
      productId: "p-1",
      productUnitId: "u-1",
      prescribedQuantity: "3",
    };
    expect(createPrescriptionBody(header, [line])).toEqual({
      siteId: "site-1",
      storageLocationId: "loc-1",
      patientName: "An",
      patientPhone: null,
      doctorName: null,
      doctorLicense: null,
      notes: null,
      customerId: null,
      lines: [
        {
          productId: "p-1",
          productUnitId: "u-1",
          prescribedQuantity: 3,
          dosage: null,
          frequency: null,
          duration: null,
          notes: null,
        },
      ],
    });
  });
});

describe("dispense lines", () => {
  it("never reports a negative remaining quantity", () => {
    expect(remainingQuantity(5, 2)).toBe(3);
    expect(remainingQuantity(5, 9)).toBe(0);
    expect(remainingQuantity("bad", 0)).toBe(0);
  });

  it("opens only lines that still have quantity due, pre-filled with the remainder", () => {
    const lines = openDispenseLines([
      { id: "l-1", productId: "p-1", prescribedQuantity: 4, dispensedQuantity: 4 },
      { id: "l-2", productId: "p-2", prescribedQuantity: 5, dispensedQuantity: 2 },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      prescriptionLineId: "l-2",
      productId: "p-2",
      dispensedQuantity: "3",
      remaining: 3,
    });
  });

  it("accepts a quantity from one up to the amount still due", () => {
    const line = { prescriptionLineId: "l", productId: "p", productBatchId: "b", dispensedQuantity: "3", remaining: 3 };
    expect(isDispenseQuantityValid(line)).toBe(true);
    expect(isDispenseQuantityValid({ ...line, dispensedQuantity: "4" })).toBe(false);
    expect(isDispenseQuantityValid({ ...line, dispensedQuantity: "0" })).toBe(false);
    expect(isDispenseQuantityValid({ ...line, dispensedQuantity: "" })).toBe(false);
  });

  it("sends the batch and the quantity as numbers", () => {
    expect(
      dispenseBody([
        { prescriptionLineId: "l", productId: "p", productBatchId: "b", dispensedQuantity: "2", remaining: 3 },
      ]),
    ).toEqual({ lines: [{ prescriptionLineId: "l", productBatchId: "b", dispensedQuantity: 2 }] });
  });
});

describe("idempotency keys", () => {
  it("makes a 32-character hex key that differs between calls", () => {
    const first = newIdempotencyKey();
    const second = newIdempotencyKey();
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(second).not.toBe(first);
  });
});

describe("dispensableBatches", () => {
  const batch = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    productId: "p1",
    qualityStatus: "Released",
    expiryDate: "2027-01-01",
    ...over,
  });

  it("keeps released, unexpired batches of the product only", () => {
    const rows = [
      batch("ok"),
      batch("pending", { qualityStatus: "PendingQc" }),
      batch("rejected", { qualityStatus: "Rejected" }),
      batch("expired", { expiryDate: "2026-10-24" }),
      batch("other-product", { productId: "p2" }),
    ];
    expect(dispensableBatches(rows, "p1", "2026-10-25").map((row) => row.id)).toEqual(["ok"]);
  });

  it("accepts a batch that expires today, as the server does", () => {
    expect(dispensableBatches([batch("today", { expiryDate: "2026-10-25" })], "p1", "2026-10-25")).toHaveLength(1);
  });
});

describe("online order moves", () => {
  const order = (patch: Partial<OrderFacts>): OrderFacts => ({
    status: "Pending",
    fulfillmentType: "delivery",
    paymentMethod: "cash_on_delivery",
    paymentStatus: "Pending",
    ...patch,
  });
  const targets = (facts: OrderFacts): string[] => orderMoves(facts).map((move) => move.status);

  it("confirms only cash on delivery by hand; a QR order is confirmed by its payment", () => {
    expect(targets(order({}))).toEqual(["Confirmed", "Cancelled"]);
    expect(targets(order({ paymentMethod: "sepay_qr" }))).toEqual(["Cancelled"]);
  });

  it("offers no cancel for a paid order, which is refunded instead", () => {
    expect(targets(order({ status: "Preparing", paymentMethod: "sepay_qr", paymentStatus: "Paid" }))).toEqual([
      "Ready",
    ]);
  });

  it("never delivers a pickup order", () => {
    expect(targets(order({ status: "Ready", fulfillmentType: "pickup", paymentStatus: "Paid" }))).toEqual([
      "Completed",
    ]);
    expect(targets(order({ status: "Ready", paymentStatus: "Paid" }))).toEqual(["Delivering"]);
  });

  it("completes cash on delivery only after the cash is recorded", () => {
    expect(targets(order({ status: "Delivering" }))).toEqual([]);
    expect(targets(order({ status: "Delivering", paymentStatus: "Paid" }))).toEqual(["Completed"]);
  });

  it("offers nothing on a finished order", () => {
    expect(targets(order({ status: "Completed", paymentStatus: "Paid" }))).toEqual([]);
    expect(targets(order({ status: "Cancelled" }))).toEqual([]);
  });

  it("takes cash on delivery at the handover and refunds a paid order only before it goes out", () => {
    expect(canRecordOrderCash(order({ status: "Ready" }), "Pending")).toBe(true);
    expect(canRecordOrderCash(order({ status: "Confirmed" }), "Pending")).toBe(false);
    expect(canRecordOrderCash(order({ status: "Ready", paymentMethod: "sepay_qr" }), "Pending")).toBe(false);
    expect(canRefundOrder(order({ status: "Preparing" }), "Paid")).toBe(true);
    expect(canRefundOrder(order({ status: "Delivering" }), "Paid")).toBe(false);
    expect(canRefundOrder(order({ status: "Preparing" }), "Pending")).toBe(false);
  });
});
