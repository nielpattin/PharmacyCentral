import { z } from "zod";

export const catalogContractVersion = "v1" as const;

export const productChangedEventSchema = z.object({
  productId: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  active: z.boolean(),
});

export const productSummarySchema = z.object({
  id: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  category: z.string(),
  manufacturer: z.string(),
  inStock: z.boolean(),
});

export const storeSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  address: z.string().nullable(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const productSearchQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  category: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export type ProductChangedEvent = z.infer<typeof productChangedEventSchema>;
export type ProductSummary = z.infer<typeof productSummarySchema>;
export type Store = z.infer<typeof storeSchema>;
export type ProductSearchQuery = z.infer<typeof productSearchQuerySchema>;
