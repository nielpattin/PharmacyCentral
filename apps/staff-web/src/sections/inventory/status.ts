import type { StatusTone } from "@pharmacy/ui";

/** Status word to badge tone. Words not listed show as neutral. */
const TONE_BY_STATUS: Readonly<Record<string, StatusTone>> = {
  Approved: "success",
  Released: "success",
  Received: "success",
  Completed: "success",
  Posted: "success",
  Fulfilled: "success",
  Pending: "warning",
  PendingApproval: "warning",
  PendingQc: "warning",
  InProgress: "warning",
  InTransit: "info",
  Rejected: "danger",
  Cancelled: "danger",
};

export const statusTone = (status: string): StatusTone => TONE_BY_STATUS[status] ?? "neutral";

/** Status values the backend accepts in the `status` param of each list. */
export const ADJUSTMENT_STATUSES = ["Pending", "Approved", "Rejected"] as const;
export const TRANSFER_STATUSES = [
  "Draft",
  "PendingApproval",
  "Approved",
  "InTransit",
  "Received",
  "Cancelled",
] as const;
export const STOCKTAKE_STATUSES = ["Pending", "InProgress", "Completed", "Cancelled"] as const;
export const REPLENISHMENT_STATUSES = ["Pending", "Approved", "Fulfilled", "Rejected", "Cancelled"] as const;

export const ALL_STATUSES = "all";

/** The `status` query param for a URL value. "all" is left out so the backend returns every status. */
export const statusParam = (status: string): string | undefined =>
  status === "" || status === ALL_STATUSES ? undefined : status;
