import type { StatusTone } from "@pharmacy/ui";

export type StatusLabel = { label: string; tone: StatusTone };

// Settled states (done, cancelled) read as plain text; only what still needs a look keeps a coloured pill.
const ORDER_STATUS: Record<string, StatusLabel> = {
  pending: { label: "Chờ xác nhận", tone: "warning" },
  confirmed: { label: "Đã xác nhận", tone: "info" },
  preparing: { label: "Đang lấy thuốc", tone: "info" },
  ready: { label: "Sẵn sàng nhận hàng", tone: "info" },
  delivering: { label: "Đang giao hàng", tone: "info" },
  completed: { label: "Hoàn tất", tone: "success" },
  cancelled: { label: "Đã huỷ", tone: "neutral" },
};

const PAYMENT_STATUS: Record<string, StatusLabel> = {
  pending: { label: "Chưa thanh toán", tone: "warning" },
  paid: { label: "Đã thanh toán", tone: "success" },
  failed: { label: "Thanh toán lỗi", tone: "danger" },
  refunded: { label: "Đã hoàn tiền", tone: "info" },
  cancelled: { label: "Đã huỷ thanh toán", tone: "neutral" },
};

const describe = (table: Record<string, StatusLabel>, status: string): StatusLabel =>
  table[status.toLowerCase()] ?? { label: status, tone: "neutral" };

/** Sales service order lifecycle: Pending → Confirmed → Preparing → Ready/Delivering → Completed | Cancelled. */
export const orderStatusBadge = (status: string): StatusLabel => describe(ORDER_STATUS, status);

/** Payment service invoice status; the sales service mirrors it on the order. */
export const paymentStatusBadge = (status: string): StatusLabel => describe(PAYMENT_STATUS, status);

/** The invoice status is capitalised on the wire, so views read this vocabulary instead of comparing strings. */
export const invoicePaid = (status: string): boolean => status.toLowerCase() === "paid";

/** An invoice without an answer yet is still open, which is what a caller waiting on the money has to keep reading. */
export const invoicePending = (status: string | undefined): boolean =>
  status === undefined || status.toLowerCase() === "pending";

/** Position of an order status on the five-step lifecycle. `ready` and `delivering` share the fourth step. */
const ORDER_STEP: Record<string, number> = {
  pending: 0,
  confirmed: 1,
  preparing: 2,
  ready: 3,
  delivering: 3,
  completed: 4,
};

/** Step index of an order, or undefined for a cancelled or unknown status, which sits off the lifecycle. */
export const orderStep = (status: string): number | undefined => ORDER_STEP[status.toLowerCase()];

/** Labels of the five lifecycle steps; the fourth depends on whether the shopper collects or is delivered to. */
export const orderStepLabels = (fulfillmentType: "pickup" | "delivery"): readonly string[] => [
  "Chờ xác nhận",
  "Đã xác nhận",
  "Đang lấy thuốc",
  fulfillmentType === "delivery" ? "Đang giao hàng" : "Sẵn sàng nhận hàng",
  "Hoàn tất",
];

/** Statuses where the order is still moving, as opposed to finished or cancelled. */
const FINISHED_STATUSES = new Set(["completed", "cancelled"]);

/** True while the order has not reached a final status. */
export const isOrderOpen = (status: string): boolean => !FINISHED_STATUSES.has(status.toLowerCase());

const byNewest = (left: { createdAt: string }, right: { createdAt: string }): number =>
  Date.parse(right.createdAt) - Date.parse(left.createdAt);

/**
 * The order the shopper most likely came to see: the newest one whose medicine is waiting or on its way, else the
 * newest one still open, else simply the newest. Undefined only for an empty list.
 */
export const pickFeaturedOrder = <T extends { status: string; createdAt: string }>(
  orders: readonly T[],
): T | undefined => {
  const waiting = orders.filter((order) => ["ready", "delivering"].includes(order.status.toLowerCase()));
  const open = orders.filter((order) => isOrderOpen(order.status));
  const pool = waiting.length > 0 ? waiting : open.length > 0 ? open : orders;
  return [...pool].sort(byNewest)[0];
};

/** The status as a sentence the shopper would say, shown large on the featured order. */
export const orderHeadline = (order: { status: string; fulfillmentType: "pickup" | "delivery" }): string => {
  const delivery = order.fulfillmentType === "delivery";
  switch (order.status.toLowerCase()) {
    case "pending":
      return "Nhà thuốc đang xác nhận đơn của bạn";
    case "confirmed":
      return "Nhà thuốc đã xác nhận đơn của bạn";
    case "preparing":
      return "Dược sĩ đang lấy thuốc cho bạn";
    case "ready":
      return delivery ? "Thuốc của bạn đã sẵn sàng" : "Thuốc của bạn đã sẵn sàng để nhận";
    case "delivering":
      return "Đơn của bạn đang được giao";
    case "completed":
      return delivery ? "Đã giao xong" : "Bạn đã nhận thuốc";
    case "cancelled":
      return "Đơn đã huỷ";
    default:
      return orderStatusBadge(order.status).label;
  }
};
