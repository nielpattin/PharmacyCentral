import type { StatusTone } from "@pharmacy/ui";

export type StatusLabel = { label: string; tone: StatusTone };

// Settled states (done, cancelled) read as plain text; only what still needs a look keeps a coloured pill.
const ORDER_STATUS: Record<string, StatusLabel> = {
  pending: { label: "Chờ xác nhận", tone: "warning" },
  confirmed: { label: "Đã xác nhận", tone: "info" },
  preparing: { label: "Đang soạn thuốc", tone: "info" },
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
