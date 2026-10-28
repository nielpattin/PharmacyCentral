import { z } from "zod";

export const procurementContractVersion = "v1" as const;

export const goodsReceiptPostedEventSchema = z.object({
  goodsReceiptId: z.string().uuid(),
  siteId: z.string().uuid(),
  supplierId: z.string().uuid(),
  lineCount: z.number().int().positive(),
});

export const purchaseOrderLineSchema = z.object({
  productId: z.string().uuid(),
  orderedQuantity: z.number().positive(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export const createPurchaseOrderRequestSchema = z.object({
  purchaseOrderNumber: z.string().trim().min(1).max(100).optional(),
  supplierId: z.string().uuid(),
  siteId: z.string().uuid(),
  expectedDate: z.string().date().nullable().optional(),
  lines: z.array(purchaseOrderLineSchema).min(1),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export const purchaseOrderActionSchema = z.object({
  action: z.enum(["approve", "cancel"]),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export const replenishmentDraftLineSchema = z.object({
  productId: z.string().uuid(),
  orderedQuantity: z.number().int().min(1),
});

/** One Draft purchase order: one per supplier, so a supplier and a product each appear at most once. */
export const replenishmentDraftOrderSchema = z.object({
  supplierId: z.string().uuid(),
  lines: z.array(replenishmentDraftLineSchema).min(1).max(200),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export const createReplenishmentDraftOrdersRequestSchema = z
  .object({
    siteId: z.string().uuid(),
    orders: z.array(replenishmentDraftOrderSchema).min(1).max(50),
  })
  .superRefine((request, context) => {
    const suppliers = request.orders.map((order) => order.supplierId);
    if (new Set(suppliers).size !== suppliers.length) {
      context.addIssue({ code: "custom", path: ["orders"], message: "A supplier may appear in one order only" });
    }
    request.orders.forEach((order, index) => {
      const products = order.lines.map((line) => line.productId);
      if (new Set(products).size !== products.length) {
        context.addIssue({
          code: "custom",
          path: ["orders", index, "lines"],
          message: "A product may appear in one line only",
        });
      }
    });
  });

export const goodsReceiptLineSchema = z.object({
  productId: z.string().uuid(),
  batchNumber: z.string().trim().min(1).max(100),
  expiryDate: z.string().date(),
  manufacturedDate: z.string().date().nullable().optional(),
  manufacturer: z.string().trim().max(300).nullable().optional(),
  quantity: z.number().positive(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export const createGoodsReceiptRequestSchema = z.object({
  receiptNumber: z.string().trim().min(1).max(100),
  supplierId: z.string().uuid(),
  siteId: z.string().uuid(),
  storageLocationId: z.string().uuid(),
  purchaseOrderId: z.string().uuid().nullable().optional(),
  receivedAt: z.string().datetime({ offset: true }),
  notes: z.string().trim().max(2000).nullable().optional(),
  lines: z.array(goodsReceiptLineSchema).min(1),
});

export type GoodsReceiptPostedEvent = z.infer<typeof goodsReceiptPostedEventSchema>;
export type PurchaseOrderLine = z.infer<typeof purchaseOrderLineSchema>;
export type CreatePurchaseOrderRequest = z.infer<typeof createPurchaseOrderRequestSchema>;
export type PurchaseOrderAction = z.infer<typeof purchaseOrderActionSchema>;
export type CreateReplenishmentDraftOrdersRequest = z.infer<typeof createReplenishmentDraftOrdersRequestSchema>;
export type GoodsReceiptLine = z.infer<typeof goodsReceiptLineSchema>;
export type CreateGoodsReceiptRequest = z.infer<typeof createGoodsReceiptRequestSchema>;
