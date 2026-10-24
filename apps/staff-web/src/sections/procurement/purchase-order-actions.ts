import type { StatusTone } from "@pharmacy/ui";

import { useConfirm } from "../../components/confirm.tsx";
import { useStaffAction } from "../../hooks/useStaffAction.ts";
import { text, type JsonRecord } from "../../staff-api.ts";
import { shortId } from "./labels.ts";

export const PURCHASE_ORDERS_KEY = ["staff-purchase-orders"] as const;

export const PURCHASE_ORDER_STATUSES = ["Draft", "Approved", "PartiallyReceived", "Received", "Cancelled"] as const;

const STATUS_TONE: Readonly<Record<string, StatusTone | undefined>> = {
  Draft: "neutral",
  Approved: "info",
  PartiallyReceived: "warning",
  Received: "success",
  Cancelled: "danger",
};

export const purchaseOrderTone = (status: unknown): StatusTone => STATUS_TONE[text(status, "")] ?? "neutral";

export const purchaseOrderNumber = (order: JsonRecord): string =>
  text(order.purchaseOrderNumber, "") || shortId(order.id);

/** The service approves only Draft orders. */
export const canApprovePurchaseOrder = (status: unknown): boolean => text(status, "") === "Draft";

/** The service refuses to cancel a fully received order or one already cancelled. */
export const canCancelPurchaseOrder = (status: unknown): boolean =>
  !["Received", "Cancelled"].includes(text(status, ""));

export const purchaseOrderActionPath = (id: unknown): string =>
  `/api/procurement/purchase-orders/${encodeURIComponent(text(id, ""))}/action`;

/**
 * Approve and cancel one purchase order. Approval asks for a plain confirmation. Cancellation is irreversible, so the
 * user must type the order number first.
 *
 * Usage:
 *   const actions = usePurchaseOrderActions();
 *   await actions.cancel(order);
 */
export const usePurchaseOrderActions = () => {
  const confirm = useConfirm();
  const run = useStaffAction();
  return {
    approve: async (order: JsonRecord): Promise<boolean> => {
      const accepted = await confirm({
        title: "Approve purchase order?",
        description: "Approved orders can receive goods.",
        confirmLabel: "Approve",
      });
      if (!accepted) return false;
      return run({
        path: purchaseOrderActionPath(order.id),
        body: { action: "approve" },
        invalidate: [PURCHASE_ORDERS_KEY],
        success: "Purchase order approved.",
      });
    },
    cancel: async (order: JsonRecord): Promise<boolean> => {
      const accepted = await confirm({
        title: "Cancel purchase order?",
        description: "A cancelled order cannot be approved again. Type the order number to confirm.",
        typeToConfirm: purchaseOrderNumber(order),
        tone: "danger",
        confirmLabel: "Cancel order",
        cancelLabel: "Keep order",
      });
      if (!accepted) return false;
      return run({
        path: purchaseOrderActionPath(order.id),
        body: { action: "cancel" },
        invalidate: [PURCHASE_ORDERS_KEY],
        success: "Purchase order cancelled.",
      });
    },
  };
};
