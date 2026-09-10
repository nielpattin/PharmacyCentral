export type OrderStatus = "Pending" | "Confirmed" | "Preparing" | "Ready" | "Delivering" | "Completed" | "Cancelled";

export const transitionOrder = (current: OrderStatus, next: OrderStatus): OrderStatus => {
  const allowed: Record<OrderStatus, OrderStatus[]> = {
    Pending: ["Confirmed", "Cancelled"],
    Confirmed: ["Preparing", "Cancelled"],
    Preparing: ["Ready", "Cancelled"],
    Ready: ["Delivering", "Completed"],
    Delivering: ["Completed"],
    Completed: [],
    Cancelled: [],
  };
  if (!allowed[current].includes(next)) {
    throw new Error(`Invalid order transition: ${current} -> ${next}`);
  }
  return next;
};
