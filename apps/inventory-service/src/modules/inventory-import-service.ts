import { and, eq } from "drizzle-orm";

import type {
  OpeningBalanceImport,
  OpeningBalanceImportResult,
  OpeningBalanceImportRow,
} from "../contracts/imports.ts";
import type { InventoryDatabase } from "../shared/infrastructure/database.ts";
import { inventoryBalances, productBatches, stockLedgerEntries } from "../shared/infrastructure/schema.ts";

import { recordSiteAvailability } from "./site-availability.ts";

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

/** A row names a site the importing user is not assigned to. Nothing is written when one is found. */
export class ImportSiteAccessError extends Error {}

export type OpeningBalanceImportOptions = {
  /** The user importing; recorded as the creator of each batch the import creates. */
  actorId: string | null;
  /** The sites the importer may write to; undefined for Platform Admin, which has no site limit. */
  allowedSiteIds?: string[] | undefined;
};

export class InventoryImportService {
  public constructor(
    private readonly database: InventoryDatabase,
    private readonly resolver: OpeningBalanceReferenceResolver,
  ) {}

  public async importOpeningBalances(
    input: OpeningBalanceImport,
    options: OpeningBalanceImportOptions = { actorId: null },
  ): Promise<OpeningBalanceImportResult> {
    this.resolver.reset?.();
    const resolved: Array<{ row: OpeningBalanceImportRow; reference: OpeningBalanceReference }> = [];
    for (const row of input.balances) {
      resolved.push({ row, reference: await this.resolver.resolve(row) });
    }
    if (options.allowedSiteIds) {
      const allowed = options.allowedSiteIds;
      if (resolved.some(({ reference }) => !allowed.includes(reference.siteId)))
        throw new ImportSiteAccessError("Có dòng nhập thuộc địa điểm bạn không được phân công.");
    }
    // One batch number of one product has one expiry date and one quality status within the file.
    const batchFacts = new Map<string, { expiryDate: string; qualityStatus: string }>();
    for (const { row, reference } of resolved) {
      const key = `${reference.productId}:${row.batchNumber}`;
      const seen = batchFacts.get(key);
      if (seen && (seen.expiryDate !== row.expiryDate || seen.qualityStatus !== row.qualityStatus))
        throw new Error(`Lô ${row.batchNumber} có hạn sử dụng hoặc trạng thái chất lượng khác nhau trong tệp.`);
      batchFacts.set(key, { expiryDate: row.expiryDate, qualityStatus: row.qualityStatus });
    }

    // One answer per product and site, from all of its sellable stock once every row is in.
    const touched = new Map<string, { productId: string; siteId: string }>();
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
          if (existingBatch.expiryDate !== row.expiryDate || existingBatch.qualityStatus !== row.qualityStatus)
            throw new Error(`Lô ${row.batchNumber} đã có hạn sử dụng hoặc trạng thái chất lượng khác trong hệ thống.`);
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
              createdBy: options.actorId,
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
        touched.set(`${reference.productId}:${reference.siteId}`, {
          productId: reference.productId,
          siteId: reference.siteId,
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
      for (const { productId, siteId } of touched.values())
        await recordSiteAvailability(transaction, productId, siteId);
      return { created, unchanged, batchesCreated, balances };
    });
    return result;
  }
}
