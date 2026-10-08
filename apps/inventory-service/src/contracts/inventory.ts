import { z } from "zod";

export const inventoryContractVersion = "v1" as const;

export const reservationChangedEventSchema = z.object({
  reservationId: z.string().uuid(),
  status: z.enum(["active", "released", "consumed", "rejected"]),
});

export const reserveStockLineSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().positive(),
});

export const reserveStockCommandSchema = z.object({
  reservationId: z.string().uuid(),
  sourceSiteId: z.string().uuid(),
  sourceLocationId: z.string().uuid(),
  lines: z.array(reserveStockLineSchema).min(1),
});

export const stockMovementCommandSchema = z.object({
  productId: z.string().uuid(),
  productBatchId: z.string().uuid().optional(),
  siteId: z.string().uuid(),
  storageLocationId: z.string().uuid(),
  quantityDelta: z.number().refine((value) => value !== 0),
  movementType: z.string().trim().min(1).max(80),
  reason: z.string().trim().max(500).optional(),
});

/** Goods leaving the shelf for a prescription, from the batches the pharmacist handed over. */
export const dispenseStockCommandSchema = z.object({
  dispenseId: z.string().trim().min(1).max(128),
  reservationId: z.string().uuid().optional(),
  prescriptionId: z.string().uuid(),
  siteId: z.string().uuid(),
  storageLocationId: z.string().uuid(),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        productBatchId: z.string().uuid(),
        quantity: z.number().positive(),
      }),
    )
    .min(1),
});

export const availabilityChangedEventSchema = z.object({
  productId: z.string().uuid(),
  siteId: z.string().uuid(),
  inStock: z.boolean(),
});

export type ReservationChangedEvent = z.infer<typeof reservationChangedEventSchema>;
export type ReserveStockLine = z.infer<typeof reserveStockLineSchema>;
export type ReserveStockCommand = z.infer<typeof reserveStockCommandSchema>;
export type StockMovementCommand = z.infer<typeof stockMovementCommandSchema>;
export type DispenseStockCommand = z.infer<typeof dispenseStockCommandSchema>;
export type AvailabilityChangedEvent = z.infer<typeof availabilityChangedEventSchema>;
