import { and, eq } from "drizzle-orm";

import type {
  OpeningBalanceImport,
  OpeningBalanceImportResult,
  OpeningBalanceImportRow,
} from "../contracts/imports.ts";
import type { InventoryDatabase } from "../shared/infrastructure/database.ts";
import {
  inventoryBalances,
  outboxMessages,
  productBatches,
  stockLedgerEntries,
} from "../shared/infrastructure/schema.ts";

export type OpeningBalanceReference = {
  productId: string;
  siteId: string;
  storageLocationId: string;
  supplierId: string | null;
};

export type OpeningBalanceReferenceResolver = {
  resolve(row: OpeningBalanceImportRow): Promise<OpeningBalanceReference>;
  reset?(): void;
};

export class InventoryImportService {
  public constructor(
    private readonly database: InventoryDatabase,
    private readonly resolver: OpeningBalanceReferenceResolver,
    private readonly publishAvailability?: (input: {
      productId: string;
      siteId: string;
      inStock: boolean;
    }) => Promise<void>,
  ) {}

  public async importOpeningBalances(input: OpeningBalanceImport): Promise<OpeningBalanceImportResult> {
    this.resolver.reset?.();
    const resolved: Array<{ row: OpeningBalanceImportRow; reference: OpeningBalanceReference }> = [];
    for (const row of input.balances) {
      resolved.push({ row, reference: await this.resolver.resolve(row) });
    }

    const availability = new Map<string, { productId: string; siteId: string; inStock: boolean }>();
    const result = await this.database.db.transaction(async (transaction) => {
      const balances: OpeningBalanceImportResult["balances"] = [];
      let created = 0;
      let unchanged = 0;
      let batchesCreated = 0;
      for (const { row, reference } of resolved) {
        const existingBatch = (
          await transaction
            .select()
            .from(productBatches)
            .where(
              and(eq(productBatches.productId, reference.productId), eq(productBatches.batchNumber, row.batchNumber)),
            )
            .limit(1)
            .for("update")
        )[0];
        let batchId: string;
        if (existingBatch) {
          batchId = existingBatch.id;
        } else {
          const [batch] = await transaction
            .insert(productBatches)
            .values({
              productId: reference.productId,
              supplierId: reference.supplierId,
              batchNumber: row.batchNumber,
              manufacturedDate: row.manufacturedDate ?? null,
              expiryDate: row.expiryDate,
              manufacturer: row.manufacturer ?? null,
              qualityStatus: row.qualityStatus,
            })
            .returning({ id: productBatches.id });
          if (!batch) throw new Error(`Batch ${row.batchNumber} was not saved`);
          batchId = batch.id;
          batchesCreated += 1;
        }

        const existingBalance = (
          await transaction
            .select()
            .from(inventoryBalances)
            .where(
              and(
                eq(inventoryBalances.productBatchId, batchId),
                eq(inventoryBalances.storageLocationId, reference.storageLocationId),
              ),
            )
            .limit(1)
            .for("update")
        )[0];
        if (existingBalance) {
          if (
            Number(existingBalance.quantityOnHand) === row.quantityOnHand &&
            Number(existingBalance.quantityReserved) === 0
          ) {
            unchanged += 1;
            continue;
          }
          throw new Error(
            `Storage location ${row.storageLocationCode ?? reference.storageLocationId} already has stock for batch ${row.batchNumber}. Use a stock adjustment instead.`,
          );
        }
        const existingLedger = await transaction
          .select({ id: stockLedgerEntries.id })
          .from(stockLedgerEntries)
          .where(
            and(
              eq(stockLedgerEntries.productBatchId, batchId),
              eq(stockLedgerEntries.storageLocationId, reference.storageLocationId),
            ),
          )
          .limit(1);
        if (existingLedger[0])
          throw new Error(`Batch ${row.batchNumber} already has stock movements at this storage location`);

        await transaction.insert(inventoryBalances).values({
          productBatchId: batchId,
          siteId: reference.siteId,
          storageLocationId: reference.storageLocationId,
          quantityOnHand: String(row.quantityOnHand),
          quantityReserved: "0",
        });
        await transaction.insert(stockLedgerEntries).values({
          productId: reference.productId,
          productBatchId: batchId,
          siteId: reference.siteId,
          storageLocationId: reference.storageLocationId,
          quantityDelta: String(row.quantityOnHand),
          quantityAfter: String(row.quantityOnHand),
          movementType: "OpeningBalance",
          reason: row.reason ?? "Opening stock balance import",
        });
        await transaction.insert(outboxMessages).values({
          eventType: "inventory.availability.changed.v1",
          schemaVersion: "1",
          payload: JSON.stringify({
            productId: reference.productId,
            siteId: reference.siteId,
            inStock: row.quantityOnHand > 0,
          }),
        });
        availability.set(`${reference.productId}:${reference.siteId}`, {
          productId: reference.productId,
          siteId: reference.siteId,
          inStock: row.quantityOnHand > 0,
        });
        created += 1;
        balances.push({
          productId: reference.productId,
          siteId: reference.siteId,
          storageLocationId: reference.storageLocationId,
          batchNumber: row.batchNumber,
          quantity: row.quantityOnHand,
        });
      }
      return { created, unchanged, batchesCreated, balances };
    });

    if (this.publishAvailability) {
      for (const entry of availability.values()) {
        try {
          await this.publishAvailability(entry);
        } catch {
          // The local stock transaction remains authoritative. The outbox retry handles broker recovery.
        }
      }
    }
    return result;
  }
}
