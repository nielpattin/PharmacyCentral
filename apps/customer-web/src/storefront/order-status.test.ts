import { describe, expect, it } from "vitest";

import { orderHeadline, orderStep, orderStepLabels, pickFeaturedOrder } from "./order-status.ts";

const order = (id: string, status: string, createdAt: string) => ({ id, status, createdAt });

describe("order lifecycle", () => {
  it("places pickup-ready and delivering on the same step, and leaves cancelled off the path", () => {
    expect(orderStep("Ready")).toBe(3);
    expect(orderStep("delivering")).toBe(3);
    expect(orderStep("Completed")).toBe(4);
    expect(orderStep("Cancelled")).toBeUndefined();
    expect(orderStep("something-new")).toBeUndefined();
  });

  it("names the fourth step by how the order reaches the shopper", () => {
    expect(orderStepLabels("pickup")[3]).toBe("Sẵn sàng nhận hàng");
    expect(orderStepLabels("delivery")[3]).toBe("Đang giao hàng");
  });
});

describe("featured order", () => {
  it("prefers the newest order whose medicine is waiting or on its way over a newer one still being prepared", () => {
    const orders = [
      order("new-preparing", "Preparing", "2026-10-25T10:00:00Z"),
      order("old-ready", "Ready", "2026-10-24T10:00:00Z"),
      order("older-delivering", "Delivering", "2026-10-23T10:00:00Z"),
    ];
    expect(pickFeaturedOrder(orders)?.id).toBe("old-ready");
  });

  it("falls back to the newest open order, then to the newest order overall", () => {
    expect(
      pickFeaturedOrder([
        order("done", "Completed", "2026-10-25T10:00:00Z"),
        order("pending", "Pending", "2026-10-24T10:00:00Z"),
      ])?.id,
    ).toBe("pending");
    expect(
      pickFeaturedOrder([
        order("old-cancelled", "Cancelled", "2026-10-24T10:00:00Z"),
        order("new-done", "Completed", "2026-10-25T10:00:00Z"),
      ])?.id,
    ).toBe("new-done");
    expect(pickFeaturedOrder([])).toBeUndefined();
  });
});

describe("order headline", () => {
  it("reads as a sentence that depends on how the order reaches the shopper", () => {
    expect(orderHeadline({ status: "Ready", fulfillmentType: "pickup" })).toBe("Thuốc của bạn đã sẵn sàng để nhận");
    expect(orderHeadline({ status: "Completed", fulfillmentType: "pickup" })).toBe("Bạn đã nhận thuốc");
    expect(orderHeadline({ status: "Completed", fulfillmentType: "delivery" })).toBe("Đã giao xong");
  });

  it("falls back to the plain status label for a status it does not know", () => {
    expect(orderHeadline({ status: "something-new", fulfillmentType: "pickup" })).not.toBe("");
  });
});
