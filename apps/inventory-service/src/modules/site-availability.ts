import { and, eq, gte, sql } from "drizzle-orm";

import type { InventoryDatabase } from "../shared/infrastructure/database.ts";
import { inventoryBalances, outboxMessages, productBatches } from "../shared/infrastructure/schema.ts";

export type InventoryTransaction = Parameters<Parameters<InventoryDatabase["db"]["transaction"]>[0]>[0];

/** Today's calendar date; a batch stays sellable through its expiry date and not a day after. */
export const today = (): string => new Date().toISOString().slice(0, 10);

/** Stock that may be reserved, sold, or shown as available: released by quality control and not yet expired. */
export const sellableBatch = () =>
  and(eq(productBatches.qualityStatus, "Released"), gte(productBatches.expiryDate, today()));

/**
 * Records a product's availability at a site after its stock changed, as an `inventory.availability.changed.v1` row
 * in the outbox. It is the free stock of every sellable batch at the site, so one batch running out never hides the
 * others, and expired or unreleased goods never count. The row commits or rolls back with the stock change, and the
 * outbox publisher relays it to the broker afterwards.
 */
export const recordSiteAvailability = async (
  transaction: InventoryTransaction,
  productId: string,
  siteId: string,
): Promise<void> => {
  const [free] = await transaction
    .select({
      quantity: sql<string>`coalesce(sum(${inventoryBalances.quantityOnHand} - ${inventoryBalances.quantityReserved}), 0)`,
    })
    .from(inventoryBalances)
    .innerJoin(productBatches, eq(productBatches.id, inventoryBalances.productBatchId))
    .where(and(eq(productBatches.productId, productId), eq(inventoryBalances.siteId, siteId), sellableBatch()));
  const availability = { productId, siteId, inStock: Number(free?.quantity ?? 0) > 0 };
  await transaction.insert(outboxMessages).values({
    eventType: "inventory.availability.changed.v1",
    schemaVersion: "1",
    payload: JSON.stringify(availability),
  });
};
