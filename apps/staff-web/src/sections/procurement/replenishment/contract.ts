import { z } from "zod";

import { buildPagePath } from "../../../lib/page-request.ts";
import type { SuggestionParams } from "./params.ts";

/**
 * The answers of the replenishment routes (design 0007, "Contracts"). Field names match the contract exactly. A figure
 * the server cannot answer is `null`: a supplier the product has no receipt from, or days of cover with no sales.
 */

export const REPLENISHMENT_SUGGESTIONS_KEY = ["staff-replenishment-suggestions"] as const;

export const DRAFT_ORDERS_PATH = "/api/procurement/replenishment-suggestions/draft-orders";

const suggestionSchema = z.object({
  productId: z.string(),
  supplierId: z.string().nullable(),
  dailyVelocity: z.number(),
  dispensedQuantity: z.number(),
  onHand: z.number(),
  reserved: z.number(),
  available: z.number(),
  inboundQuantity: z.number(),
  minimumStock: z.number(),
  leadTimeDays: z.number(),
  leadTimeSource: z.enum(["history", "default"]),
  sampleCount: z.number(),
  reorderPoint: z.number(),
  targetStock: z.number(),
  suggestedQuantity: z.number(),
  daysOfCover: z.number().nullable(),
});

export type Suggestion = z.infer<typeof suggestionSchema>;

const suggestionsResponseSchema = z.object({
  siteId: z.string(),
  generatedAt: z.string(),
  suggestions: z.array(suggestionSchema),
});

export type SuggestionsResponse = z.infer<typeof suggestionsResponseSchema>;

export type SuggestionsRequest = { siteId: string; params: SuggestionParams };

/** The `GET` path for one site and the four parameters. */
export const suggestionsPath = (request: SuggestionsRequest): string =>
  buildPagePath("/api/procurement/replenishment-suggestions", {
    siteId: request.siteId,
    windowDays: String(request.params.windowDays),
    coverDays: String(request.params.coverDays),
    safetyDays: String(request.params.safetyDays),
    defaultLeadTimeDays: String(request.params.defaultLeadTimeDays),
  });

/** Throws when the answer does not match the contract, so the screen shows an error instead of wrong figures. */
export const parseSuggestionsResponse = (value: unknown): SuggestionsResponse => {
  const parsed = suggestionsResponseSchema.safeParse(value);
  if (!parsed.success) throw new Error("Unexpected replenishment suggestions response.");
  return parsed.data;
};

/** The body of the draft-order POST: one entry per supplier, one line per selected product. */
export type DraftOrderLine = { productId: string; orderedQuantity: number };
export type DraftOrder = { supplierId: string; lines: DraftOrderLine[] };
export type DraftOrdersBody = { siteId: string; orders: DraftOrder[] };

const draftOrdersResponseSchema = z.object({
  purchaseOrders: z.array(z.record(z.string(), z.unknown())),
});

/** The created purchase orders, as the purchase order list shows them. */
export const parseDraftOrdersResponse = (value: unknown): { purchaseOrders: Array<Record<string, unknown>> } => {
  const parsed = draftOrdersResponseSchema.safeParse(value);
  if (!parsed.success) throw new Error("Unexpected draft purchase orders response.");
  return parsed.data;
};
