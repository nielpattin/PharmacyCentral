export type OrderStatus = "Pending" | "Confirmed" | "Preparing" | "Ready" | "Delivering" | "Completed" | "Cancelled";

const ALLOWED: Record<OrderStatus, OrderStatus[]> = {
  Pending: ["Confirmed", "Cancelled"],
  Confirmed: ["Preparing", "Cancelled"],
  Preparing: ["Ready", "Cancelled"],
  Ready: ["Delivering", "Completed", "Cancelled"],
  Delivering: ["Completed"],
  Completed: [],
  Cancelled: [],
};

/** A move the status chain does not have. The route answers it with 409; nothing has been written. */
export class InvalidOrderTransition extends Error {
  public constructor(current: OrderStatus, next: OrderStatus) {
    super(`Invalid order transition: ${current} -> ${next}`);
    this.name = "InvalidOrderTransition";
  }
}

export const transitionOrder = (current: OrderStatus, next: OrderStatus): OrderStatus => {
  if (!ALLOWED[current].includes(next)) throw new InvalidOrderTransition(current, next);
  return next;
};

export type StaffMoveOrder = {
  status: string;
  fulfillmentType: string;
  paymentMethod: string | null;
  paymentStatus: string;
};

export type StaffMoveRefusal = { code: string; title: string };

/**
 * A move the chain allows but the order's money or fulfillment does not (BR-ORD-005): a pickup order is never
 * delivered and a delivery order is completed only after it went out, a QR order is confirmed by its payment and not by
 * staff, a paid order is cancelled by refunding it, and a cash-on-delivery order is completed only once its cash is
 * recorded.
 */
export const staffMoveRefusal = (order: StaffMoveOrder, next: OrderStatus): StaffMoveRefusal | undefined => {
  const cash = order.paymentMethod === "cash_on_delivery";
  if (next === "Delivering" && order.fulfillmentType === "pickup")
    return { code: "pickup_not_delivered", title: "A pickup order is collected at the store, not delivered" };
  if (next === "Completed" && order.status === "Ready" && order.fulfillmentType !== "pickup")
    return { code: "delivery_not_collected", title: "A delivery order goes out before it is completed" };
  if (next === "Confirmed" && !cash)
    return { code: "payment_confirms_order", title: "An order paid by QR is confirmed by its payment" };
  if (next === "Cancelled" && order.paymentStatus === "Paid")
    return { code: "paid_order_needs_refund", title: "A paid order is cancelled by refunding it" };
  if (next === "Completed" && cash && order.paymentStatus !== "Paid")
    return { code: "cash_not_recorded", title: "Record the cash payment before completing the order" };
  return undefined;
};
