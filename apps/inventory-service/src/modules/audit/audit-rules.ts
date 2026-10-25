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
  post("/inventory/movements", "movement", "inventory.movement.recorded"),
  post("/inventory/transfers", "transfer", "inventory.transfer.created"),
  post("/inventory/transfers/:id/:action", "transfer", { prefix: "inventory.transfer", param: "action" }),
  post("/inventory/stocktakes", "stocktake", "inventory.stocktake.created"),
  post("/inventory/stocktake-lines/:id/count", "stocktake-line", "inventory.stocktake-line.counted"),
  post("/inventory/stocktakes/:id/post", "stocktake", "inventory.stocktake.posted"),
  post("/inventory/returns", "return", "inventory.return.recorded"),
  post("/inventory/replenishment", "replenishment", "inventory.replenishment.requested"),
  post("/inventory/replenishment/:id/:action", "replenishment", { prefix: "inventory.replenishment", param: "action" }),
  post("/procurement/purchase-orders", "purchase-order", "procurement.purchase-order.created"),
  post("/procurement/purchase-orders/:id/action", "purchase-order", {
    prefix: "procurement.purchase-order",
    body: "action",
  }),
  post("/procurement/goods-receipts", "goods-receipt", "procurement.goods-receipt.recorded"),
];
