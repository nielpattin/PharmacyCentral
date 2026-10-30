import { describe, expect, it } from "vitest";

import { InvalidOrderTransition, staffMoveRefusal, transitionOrder, type StaffMoveOrder } from "./order-status.ts";

const order = (patch: Partial<StaffMoveOrder> = {}): StaffMoveOrder => ({
  status: "Pending",
  fulfillmentType: "delivery",
  paymentMethod: "cash_on_delivery",
  paymentStatus: "Pending",
  ...patch,
});

describe("order status chain", () => {
  it("allows the fulfillment path, a cancel up to ready, and nothing after a terminal state", () => {
    expect(transitionOrder("Pending", "Confirmed")).toBe("Confirmed");
    expect(transitionOrder("Ready", "Delivering")).toBe("Delivering");
    expect(transitionOrder("Ready", "Cancelled")).toBe("Cancelled");
    expect(() => transitionOrder("Delivering", "Cancelled")).toThrow(InvalidOrderTransition);
    expect(() => transitionOrder("Completed", "Cancelled")).toThrow(InvalidOrderTransition);
  });
});

describe("staff moves the money or fulfillment forbid", () => {
  it("never delivers a pickup order", () => {
    expect(staffMoveRefusal(order({ fulfillmentType: "pickup" }), "Delivering")?.code).toBe("pickup_not_delivered");
    expect(staffMoveRefusal(order({ fulfillmentType: "delivery" }), "Delivering")).toBeUndefined();
  });

  it("completes a delivery order only after it went out, and a pickup order from ready", () => {
    const paid = { paymentStatus: "Paid" };
    expect(staffMoveRefusal(order({ ...paid, status: "Ready" }), "Completed")?.code).toBe("delivery_not_collected");
    expect(staffMoveRefusal(order({ ...paid, status: "Delivering" }), "Completed")).toBeUndefined();
    expect(
      staffMoveRefusal(order({ ...paid, status: "Ready", fulfillmentType: "pickup" }), "Completed"),
    ).toBeUndefined();
  });

  it("leaves the confirmation of a QR order to its payment, and confirms cash on delivery by hand", () => {
    expect(staffMoveRefusal(order({ paymentMethod: "sepay_qr" }), "Confirmed")?.code).toBe("payment_confirms_order");
    expect(staffMoveRefusal(order({ paymentMethod: null }), "Confirmed")?.code).toBe("payment_confirms_order");
    expect(staffMoveRefusal(order(), "Confirmed")).toBeUndefined();
  });

  it("cancels an unpaid order and sends a paid one to a refund", () => {
    expect(staffMoveRefusal(order({ paymentStatus: "Pending" }), "Cancelled")).toBeUndefined();
    expect(staffMoveRefusal(order({ paymentStatus: "Paid" }), "Cancelled")?.code).toBe("paid_order_needs_refund");
  });

  it("completes cash on delivery only once the cash is recorded", () => {
    expect(staffMoveRefusal(order({ paymentStatus: "Pending" }), "Completed")?.code).toBe("cash_not_recorded");
    expect(staffMoveRefusal(order({ paymentStatus: "Paid" }), "Completed")).toBeUndefined();
    expect(staffMoveRefusal(order({ paymentMethod: "sepay_qr", paymentStatus: "Paid" }), "Completed")).toBeUndefined();
  });
});
