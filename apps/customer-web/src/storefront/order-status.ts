import type { BadgeProps } from "@pharmacy/ui";

export type StatusBadge = { label: string; variant: BadgeProps["variant"] };

const ORDER_STATUS: Record<string, StatusBadge> = {
  pending: { label: "Chờ xác nhận", variant: "secondary" },
  confirmed: { label: "Đã xác nhận", variant: "primary" },
  preparing: { label: "Đang soạn thuốc", variant: "primary" },
  ready: { label: "Sẵn sàng nhận hàng", variant: "primary" },
  delivering: { label: "Đang giao hàng", variant: "primary" },
  completed: { label: "Hoàn tất", variant: "outline" },
  cancelled: { label: "Đã huỷ", variant: "danger" },
};

const PAYMENT_STATUS: Record<string, StatusBadge> = {
  pending: { label: "Chưa thanh toán", variant: "secondary" },
  paid: { label: "Đã thanh toán", variant: "primary" },
  failed: { label: "Thanh toán lỗi", variant: "danger" },
  refunded: { label: "Đã hoàn tiền", variant: "outline" },
  cancelled: { label: "Đã huỷ thanh toán", variant: "outline" },
};

const describe = (table: Record<string, StatusBadge>, status: string): StatusBadge =>
  table[status.toLowerCase()] ?? { label: status, variant: "secondary" };

/** Sales service order lifecycle: Pending → Confirmed → Preparing → Ready/Delivering → Completed | Cancelled. */
export const orderStatusBadge = (status: string): StatusBadge => describe(ORDER_STATUS, status);

/** Payment service invoice status; the sales service mirrors it on the order. */
export const paymentStatusBadge = (status: string): StatusBadge => describe(PAYMENT_STATUS, status);

/** The invoice status is capitalised on the wire, so views read this vocabulary instead of comparing strings. */
export const invoicePaid = (status: string): boolean => status.toLowerCase() === "paid";

/** An invoice without an answer yet is still open, which is what a caller waiting on the money has to keep reading. */
export const invoicePending = (status: string | undefined): boolean =>
  status === undefined || status.toLowerCase() === "pending";
