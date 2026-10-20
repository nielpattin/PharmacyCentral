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
  prescriptionRequired: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

/**
 * One prescription line to look up: a prescribed name and/or its active ingredients, with the strength, dosage form
 * and dispensing unit if stated.
 */
export const productMatchRequestSchema = z.object({
  items: z
    .array(
      z.object({
        name: z.string().trim().max(500).nullable(),
        activeIngredients: z.array(z.string().trim().min(1).max(200)).max(10),
        strength: z.string().trim().max(150).nullable(),
        dosageForm: z.string().trim().max(150).nullable().default(null),
        unit: z.string().trim().max(100).nullable().default(null),
      }),
    )
    .min(1)
    .max(30),
  limit: z.number().int().min(1).max(10).default(5),
});

export type ProductChangedEvent = z.infer<typeof productChangedEventSchema>;
export type ProductSummary = z.infer<typeof productSummarySchema>;
export type Store = z.infer<typeof storeSchema>;
export type ProductSearchQuery = z.infer<typeof productSearchQuerySchema>;
export type ProductMatchRequest = z.infer<typeof productMatchRequestSchema>;
