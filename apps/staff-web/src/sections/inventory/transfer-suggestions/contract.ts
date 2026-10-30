import { z } from "zod";

/**
 * The answers of `GET /api/inventory/transfer-suggestions`. Field names match the contract exactly: a source site that
 * holds more cover than it needs offers stock to a site that is running out, and the quantity is capped so the
 * destination can sell it before it expires. A cover figure is `null` only at a source with no sales in the window.
 */

export const TRANSFER_SUGGESTIONS_KEY = ["staff-inventory", "transfer-suggestions"] as const;

const suggestionSchema = z.object({
  productId: z.string(),
  sourceSiteId: z.string(),
  destinationSiteId: z.string(),
  quantity: z.number(),
  sourceAvailable: z.number(),
  sourceDaysOfCover: z.number().nullable(),
  destinationAvailable: z.number(),
  destinationDaysOfCover: z.number(),
  destinationDailyVelocity: z.number(),
  earliestExpiry: z.string(),
  daysToExpiry: z.number(),
  cappedByExpiry: z.boolean(),
});

export type TransferSuggestion = z.infer<typeof suggestionSchema>;

const suggestionsResponseSchema = z.object({
  generatedAt: z.string(),
  windowDays: z.number(),
  params: z.object({
    keepCoverDays: z.number(),
    triggerCoverDays: z.number(),
    targetCoverDays: z.number(),
  }),
  suggestions: z.array(suggestionSchema),
});

export type TransferSuggestionsResponse = z.infer<typeof suggestionsResponseSchema>;

/** The `GET` path for one sales window. */
export const suggestionsPath = (windowDays: number): string =>
  `/api/inventory/transfer-suggestions?windowDays=${windowDays}`;

/** Throws when the answer does not match the contract, so the screen shows an error instead of wrong figures. */
export const parseTransferSuggestions = (value: unknown): TransferSuggestionsResponse => {
  const parsed = suggestionsResponseSchema.safeParse(value);
  if (!parsed.success) throw new Error("Unexpected transfer suggestions response.");
  return parsed.data;
};
