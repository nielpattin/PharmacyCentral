import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { InventoryDatabase } from "../shared/infrastructure/database.ts";
import * as schema from "../shared/infrastructure/schema.ts";
import { InventoryRepository } from "./inventory-repository.ts";

const migrationsFolder = fileURLToPath(new URL("../../drizzle/migrations", import.meta.url));

/**
 * Stock health sums the shelf and the ledger in one statement. Only the real engine shows which batch falls in which
 * expiry bucket on each boundary day, which movements count inside `[from, to)`, that the latest movement is not
 * bounded by the period, and that a site-product present on only one side still gets a row.
 */
describe("InventoryRepository stock health", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const repository = new InventoryRepository({ db, pool: undefined } as unknown as InventoryDatabase);

  const siteA = "00000000-0000-4000-8000-00000000000a";
  const siteB = "00000000-0000-4000-8000-00000000000b";
  const siteC = "00000000-0000-4000-8000-00000000000c";
  const locationA = "00000000-0000-4000-8000-00000000001a";
  const locationC = "00000000-0000-4000-8000-00000000001c";
  const locationD = "00000000-0000-4000-8000-00000000001d";
  const product = "00000000-0000-4000-8000-00000000002a";
  const otherProduct = "00000000-0000-4000-8000-00000000002b";
  const idOf = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
  const asOf = new Date("2026-10-28T12:00:00Z");
  const period = { from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-10-28T00:00:00Z") };

  const ledger = (siteId: string, quantityDelta: string, movementType: string, occurredAt: string) => ({
    productId: product,
    productBatchId: idOf(0x13),
    siteId,
    storageLocationId: locationA,
    quantityDelta,
    quantityAfter: "0",
    movementType,
    occurredAt: new Date(occurredAt),
  });
  const rowFor = <Row extends { siteId: string; productId: string }>(rows: Row[], siteId: string, productId: string) =>
    rows.find((row) => row.siteId === siteId && row.productId === productId);

  beforeAll(async () => {
    await migrate(db, { migrationsFolder });
    // One batch per boundary day at site A: expired yesterday, today, 30, 31, 60, 61, 90 and 91 days out.
    await db.insert(schema.productBatches).values([
      { id: idOf(0x10), productId: product, batchNumber: "B-10", expiryDate: "2026-09-01" },
      { id: idOf(0x11), productId: product, batchNumber: "B-11", expiryDate: "2026-10-27" },
      { id: idOf(0x12), productId: product, batchNumber: "B-12", expiryDate: "2026-10-28" },
      { id: idOf(0x13), productId: product, batchNumber: "B-13", expiryDate: "2026-11-27" },
      { id: idOf(0x14), productId: product, batchNumber: "B-14", expiryDate: "2026-11-28" },
      { id: idOf(0x15), productId: product, batchNumber: "B-15", expiryDate: "2026-12-27" },
      { id: idOf(0x16), productId: product, batchNumber: "B-16", expiryDate: "2026-12-28" },
      { id: idOf(0x17), productId: product, batchNumber: "B-17", expiryDate: "2027-01-26" },
      { id: idOf(0x18), productId: product, batchNumber: "B-18", expiryDate: "2027-01-27" },
      { id: idOf(0x30), productId: product, batchNumber: "C-30", expiryDate: "2027-05-01" },
      { id: idOf(0x40), productId: otherProduct, batchNumber: "O-40", expiryDate: "2026-10-28" },
    ]);
    await db.insert(schema.inventoryBalances).values([
      { productBatchId: idOf(0x10), siteId: siteA, storageLocationId: locationA, quantityOnHand: "0" },
      { productBatchId: idOf(0x11), siteId: siteA, storageLocationId: locationA, quantityOnHand: "1" },
      {
        productBatchId: idOf(0x12),
        siteId: siteA,
        storageLocationId: locationA,
        quantityOnHand: "5",
        quantityReserved: "3",
      },
      { productBatchId: idOf(0x13), siteId: siteA, storageLocationId: locationA, quantityOnHand: "4" },
      // A second location of the same batch counts toward the same bucket.
      { productBatchId: idOf(0x13), siteId: siteA, storageLocationId: locationD, quantityOnHand: "1" },
      { productBatchId: idOf(0x14), siteId: siteA, storageLocationId: locationA, quantityOnHand: "8" },
      { productBatchId: idOf(0x15), siteId: siteA, storageLocationId: locationA, quantityOnHand: "2" },
      { productBatchId: idOf(0x16), siteId: siteA, storageLocationId: locationA, quantityOnHand: "16" },
      { productBatchId: idOf(0x17), siteId: siteA, storageLocationId: locationA, quantityOnHand: "32" },
      { productBatchId: idOf(0x18), siteId: siteA, storageLocationId: locationA, quantityOnHand: "64" },
      { productBatchId: idOf(0x30), siteId: siteC, storageLocationId: locationC, quantityOnHand: "7" },
      { productBatchId: idOf(0x40), siteId: siteA, storageLocationId: locationA, quantityOnHand: "5" },
    ]);
    await db.insert(schema.stockLedgerEntries).values([
      ledger(siteA, "10", "StockAdjustment", "2026-10-10T08:00:00Z"),
      ledger(siteA, "-5", "Dispense", "2026-10-20T10:00:00Z"),
      ledger(siteA, "-2", "Dispense", "2026-10-27T23:59:59Z"),
      // On the `to` instant: outside the period, yet the latest movement the site has.
      ledger(siteA, "-7", "Dispense", "2026-10-28T00:00:00Z"),
      // Before `from`: outside the period and the net change.
      ledger(siteA, "-100", "Dispense", "2026-09-30T23:59:59Z"),
      ledger(siteB, "-1", "StockAdjustment", "2026-10-05T00:00:00Z"),
    ]);
  });

  afterAll(async () => {
    await client.close();
  });

  it("buckets each batch's on-hand by expiry from the UTC day of asOf, boundaries included", async () => {
    const rows = await repository.stockHealth({ ...period, asOf });

    expect(rowFor(rows, siteA, product)).toEqual({
      siteId: siteA,
      productId: product,
      onHand: 133,
      reserved: 3,
      dispensed: 7,
      netChange: 3,
      lastMovementAt: "2026-10-28T00:00:00.000Z",
      expired: 1,
      // 0 days (5), 30 days (4 + 1 on the second location)
      expiring30: 10,
      // 31 days (8), 60 days (2)
      expiring60: 10,
      // 61 days (16), 90 days (32); the 91-day batch (64) is in no bucket
      expiring90: 48,
    });
  });

  it("gives a row to a product with stock but no movement, and to a site-product with movements but no stock", async () => {
    const rows = await repository.stockHealth({ ...period, asOf });

    expect(rowFor(rows, siteA, otherProduct)).toEqual({
      siteId: siteA,
      productId: otherProduct,
      onHand: 5,
      reserved: 0,
      dispensed: 0,
      netChange: 0,
      lastMovementAt: null,
      expired: 0,
      expiring30: 5,
      expiring60: 0,
      expiring90: 0,
    });
    expect(rowFor(rows, siteB, product)).toEqual({
      siteId: siteB,
      productId: product,
      onHand: 0,
      reserved: 0,
      dispensed: 0,
      netChange: -1,
      lastMovementAt: "2026-10-05T00:00:00.000Z",
      expired: 0,
      expiring30: 0,
      expiring60: 0,
      expiring90: 0,
    });
    expect(rows.map((row) => [row.siteId, row.productId])).toEqual([
      [siteA, product],
      [siteA, otherProduct],
      [siteB, product],
      [siteC, product],
    ]);
  });

  it("answers only the sites in scope, and nothing for an empty scope", async () => {
    const siteRows = async (siteIds?: string[]) =>
      (await repository.stockHealth({ ...period, asOf, siteIds })).map((row) => [row.siteId, row.productId]);

    await expect(siteRows([siteB])).resolves.toEqual([[siteB, product]]);
    await expect(siteRows([siteA, siteB])).resolves.toHaveLength(3);
    await expect(siteRows([])).resolves.toEqual([]);
  });
});
