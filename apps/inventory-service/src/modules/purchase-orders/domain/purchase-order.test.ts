import { describe, expect, it } from "vitest";

import { BusinessRuleError } from "../../../shared/business-rule-error.ts";

import { applyReceipt, transitionPurchaseOrder, type PurchaseOrder } from "./purchase-order.ts";

const order = (status: PurchaseOrder["status"]): PurchaseOrder => ({
  id: "po-1",
  supplierId: "supplier-1",
  siteId: "site-1",
  status,
  lines: [{ productId: "product-1", orderedQuantity: 10, receivedQuantity: 0 }],
});

describe("procurement lifecycle", () => {
  it("approves only Draft orders and rejects invalid cancellation", () => {
    expect(transitionPurchaseOrder(order("Draft"), "approve")).toBe("Approved");
    // A rule violation is a conflict (409), not a fault (500), so it must be this error type.
    expect(() => transitionPurchaseOrder(order("Received"), "cancel")).toThrow(BusinessRuleError);
  });

  it("moves orders through partial and complete receipt states", () => {
    const purchaseOrder = order("Approved");
    expect(applyReceipt(purchaseOrder, new Map([["product-1", 4]]))).toBe("PartiallyReceived");
    purchaseOrder.status = "PartiallyReceived";
    expect(applyReceipt(purchaseOrder, new Map([["product-1", 6]]))).toBe("Received");
    expect(() => applyReceipt(purchaseOrder, new Map([["product-1", 1]]))).toThrow();
  });
});
