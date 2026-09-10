export type PurchaseOrderStatus = "Draft" | "Approved" | "PartiallyReceived" | "Received" | "Cancelled";

export type PurchaseOrderLine = {
  productId: string;
  orderedQuantity: number;
  receivedQuantity: number;
};

export type PurchaseOrder = {
  id: string;
  supplierId: string;
  siteId: string;
  status: PurchaseOrderStatus;
  lines: PurchaseOrderLine[];
};

export const transitionPurchaseOrder = (order: PurchaseOrder, action: "approve" | "cancel"): PurchaseOrderStatus => {
  if (action === "approve" && order.status !== "Draft") {
    throw new Error("Only Draft purchase orders can be approved");
  }
  if (action === "cancel" && ["Received", "Cancelled"].includes(order.status)) {
    throw new Error("Purchase order cannot be cancelled in its current state");
  }
  return action === "approve" ? "Approved" : "Cancelled";
};

export const applyReceipt = (order: PurchaseOrder, quantities: Map<string, number>): PurchaseOrderStatus => {
  if (!["Approved", "PartiallyReceived"].includes(order.status)) {
    throw new Error("Purchase order is not receivable");
  }
  for (const line of order.lines) {
    const received = quantities.get(line.productId) ?? 0;
    if (line.receivedQuantity + received > line.orderedQuantity) {
      throw new Error("Receipt exceeds ordered quantity");
    }
    line.receivedQuantity += received;
  }
  return order.lines.every((line) => line.receivedQuantity === line.orderedQuantity) ? "Received" : "PartiallyReceived";
};
