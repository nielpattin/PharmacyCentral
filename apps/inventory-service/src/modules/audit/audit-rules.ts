import type { AuditRule } from "./audit-middleware.ts";

const post = (
  route: string,
  entityType: string,
  action: AuditRule["action"],
  details?: readonly string[],
): AuditRule => ({
  method: "POST",
  route,
  entityType,
  action,
  ...(details ? { details } : {}),
});

/** Every stock and procurement write a person makes. Reservations and dispenses are left out: sales-service makes those calls, and it audits the prescription or order they belong to. */
export const INVENTORY_AUDIT_RULES: readonly AuditRule[] = [
  post("/inventory/imports/opening-balances", "inventory-import", "inventory.opening-balances.imported"),
  post("/inventory/batches", "batch", "inventory.batch.created"),
  post("/inventory/batches/:id/quality", "batch", "inventory.batch.quality-reviewed", ["decision"]),
  post("/inventory/adjustments", "adjustment", "inventory.adjustment.created"),
  post("/inventory/adjustments/:id/:action", "adjustment", { prefix: "inventory.adjustment", param: "action" }),
  post("/inventory/disposals", "disposal", "inventory.disposal.created", ["reason"]),
  post("/inventory/disposals/:id/:action", "disposal", { prefix: "inventory.disposal", param: "action" }),
  post("/inventory/movements", "movement", "inventory.movement.recorded"),
  post("/inventory/transfers", "transfer", "inventory.transfer.created"),
  post("/inventory/transfers/:id/:action", "transfer", { prefix: "inventory.transfer", param: "action" }),
  post("/inventory/stocktakes", "stocktake", "inventory.stocktake.created"),
  post("/inventory/stocktake-lines/:id/count", "stocktake-line", "inventory.stocktake-line.counted"),
  post("/inventory/stocktakes/:id/post", "stocktake", "inventory.stocktake.posted"),
  post("/inventory/returns", "return", "inventory.return.recorded"),
  post("/inventory/replenishment", "replenishment", "inventory.replenishment.requested"),
  post("/inventory/replenishment/:id/:action", "replenishment", { prefix: "inventory.replenishment", param: "action" }),
  // An action plan keeps its origin and its new status; the title, note, owner and due date stay out of the log.
  post("/inventory/action-plans", "action-plan", "inventory.action-plan.created", ["sourceType"]),
  {
    method: "PATCH",
    route: "/inventory/action-plans/:id",
    entityType: "action-plan",
    action: "inventory.action-plan.updated",
    details: ["status"],
  },
  post("/procurement/purchase-orders", "purchase-order", "procurement.purchase-order.created"),
  post("/procurement/purchase-orders/:id/action", "purchase-order", {
    prefix: "procurement.purchase-order",
    body: "action",
  }),
  post("/procurement/goods-receipts", "goods-receipt", "procurement.goods-receipt.recorded"),
  // A batch of Draft orders is audited order by order, as the single route audits each order it creates.
  {
    method: "POST",
    route: "/procurement/replenishment-suggestions/draft-orders",
    entityType: "purchase-order",
    action: "procurement.purchase-order.created",
    collection: "purchaseOrders",
  },
];
