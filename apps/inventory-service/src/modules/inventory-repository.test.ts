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
 * Every site-scoped list ends in an `IN (...)` of the actor's sites, and only a real Postgres engine with the real
 * migrations shows what that clause keeps: a transfer stays visible on both ends of the move and nowhere else, a
 * balance or replenishment request of another site never appears, and an empty scope answers nothing at all.
 */
describe("InventoryRepository site filters", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const repository = new InventoryRepository({ db, pool: undefined } as unknown as InventoryDatabase);

  const siteA = "00000000-0000-4000-8000-00000000000a";
  const siteB = "00000000-0000-4000-8000-00000000000b";
  const siteC = "00000000-0000-4000-8000-00000000000c";
  const locationA = "00000000-0000-4000-8000-00000000001a";
  const locationB = "00000000-0000-4000-8000-00000000001b";
  const locationC = "00000000-0000-4000-8000-00000000001c";
  const product = "00000000-0000-4000-8000-00000000002a";
  const actor = "00000000-0000-4000-8000-00000000003a";
  const batchA = "00000000-0000-4000-8000-00000000004a";
  const batchB = "00000000-0000-4000-8000-00000000004b";
  const batchC = "00000000-0000-4000-8000-00000000004c";
  const transferAB = "00000000-0000-4000-8000-00000000005a";
  const transferBA = "00000000-0000-4000-8000-00000000005b";
  const replenishmentA = "00000000-0000-4000-8000-00000000006a";
  const replenishmentB = "00000000-0000-4000-8000-00000000006b";
  const replenishmentC = "00000000-0000-4000-8000-00000000006c";

  beforeAll(async () => {
    await migrate(db, { migrationsFolder });
    await db.insert(schema.productBatches).values([
      { id: batchA, productId: product, batchNumber: "BATCH-A", expiryDate: "2026-06-30" },
      { id: batchB, productId: product, batchNumber: "BATCH-B", expiryDate: "2026-06-30" },
      { id: batchC, productId: product, batchNumber: "BATCH-C", expiryDate: "2026-06-30" },
    ]);
    await db.insert(schema.inventoryBalances).values([
      {
        id: "00000000-0000-4000-8000-00000000007a",
        productBatchId: batchA,
        siteId: siteA,
        storageLocationId: locationA,
      },
      {
        id: "00000000-0000-4000-8000-00000000007b",
        productBatchId: batchB,
        siteId: siteB,
        storageLocationId: locationB,
      },
      {
        id: "00000000-0000-4000-8000-00000000007c",
        productBatchId: batchC,
        siteId: siteC,
        storageLocationId: locationC,
      },
    ]);
    await db.insert(schema.transferOrders).values([
      {
        id: transferAB,
        transferNumber: "TR-A-B",
        sourceSiteId: siteA,
        destinationSiteId: siteB,
        createdBy: actor,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
      {
        id: transferBA,
        transferNumber: "TR-B-A",
        sourceSiteId: siteB,
        destinationSiteId: siteA,
        createdBy: actor,
        createdAt: new Date("2026-01-02T00:00:00Z"),
      },
    ]);
    await db.insert(schema.replenishmentRequests).values([
      { id: replenishmentA, siteId: siteA, storageLocationId: locationA, requestedBy: actor },
      { id: replenishmentB, siteId: siteB, storageLocationId: locationB, requestedBy: actor },
      { id: replenishmentC, siteId: siteC, storageLocationId: locationC, requestedBy: actor },
    ]);
  });

  afterAll(async () => {
    await client.close();
  });

  it("shows a transfer to both ends of the move and hides it from a third site", async () => {
    const idsFor = async (siteIds: string[]): Promise<string[]> =>
      (await repository.listTransfers(siteIds)).map((transfer) => transfer.id).sort();

    await expect(idsFor([siteA])).resolves.toEqual([transferAB, transferBA].sort());
    await expect(idsFor([siteB])).resolves.toEqual([transferAB, transferBA].sort());
    await expect(idsFor([siteC])).resolves.toEqual([]);
    await expect(idsFor([])).resolves.toEqual([]);
  });

  it("unions the balances of the reader's sites and excludes every other site", async () => {
    const siteIdsFor = async (siteIds: string[]): Promise<string[]> =>
      (await repository.listBalances(undefined, siteIds)).map((row) => row.balance.siteId).sort();

    await expect(siteIdsFor([siteA, siteB])).resolves.toEqual([siteA, siteB].sort());
    await expect(siteIdsFor([siteB])).resolves.toEqual([siteB]);
    await expect(siteIdsFor([])).resolves.toEqual([]);
  });

  it("unions the replenishment requests of the reader's sites and excludes every other site", async () => {
    const idsFor = async (siteIds: string[]): Promise<string[]> =>
      (await repository.listReplenishments(siteIds)).map((request) => request.id).sort();

    await expect(idsFor([siteA, siteB])).resolves.toEqual([replenishmentA, replenishmentB].sort());
    await expect(idsFor([siteB])).resolves.toEqual([replenishmentB]);
    await expect(idsFor([])).resolves.toEqual([]);
  });
});

/** The finance page reads these sums; only the real engine shows the `FILTER` clauses split each direction apart. */
describe("InventoryRepository movement summary", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const repository = new InventoryRepository({ db, pool: undefined } as unknown as InventoryDatabase);

  const siteA = "00000000-0000-4000-8000-00000000000a";
  const siteB = "00000000-0000-4000-8000-00000000000b";
  const location = "00000000-0000-4000-8000-00000000001a";
  const product = "00000000-0000-4000-8000-00000000002a";
  const batch = "00000000-0000-4000-8000-00000000004a";

  const movement = (siteId: string, movementType: string, quantityDelta: string, occurredAt: string) => ({
    productId: product,
    productBatchId: batch,
    siteId,
    storageLocationId: location,
    quantityDelta,
    quantityAfter: "0",
    movementType,
    occurredAt: new Date(occurredAt),
  });

  beforeAll(async () => {
    await migrate(db, { migrationsFolder });
    await db
      .insert(schema.stockLedgerEntries)
      .values([
        movement(siteA, "StockAdjustment", "5", "2026-09-10T08:00:00Z"),
        movement(siteA, "StockAdjustment", "-2", "2026-09-12T08:00:00Z"),
        movement(siteA, "TransferOut", "-4", "2026-09-11T08:00:00Z"),
        movement(siteA, "TransferOut", "-7", "2026-08-01T08:00:00Z"),
        movement(siteB, "StockAdjustment", "100", "2026-09-10T08:00:00Z"),
      ]);
  });

  afterAll(async () => {
    await client.close();
  });

  it("sums each movement type's inflow and outflow within the period and the reader's sites", async () => {
    await expect(
      repository.summarizeMovements({
        siteIds: [siteA],
        from: new Date("2026-09-01T00:00:00Z"),
        to: new Date("2026-09-30T23:59:59Z"),
      }),
    ).resolves.toEqual([
      {
        movementType: "StockAdjustment",
        count: 2,
        quantityIn: 5,
        quantityOut: 2,
        latestOccurredAt: "2026-09-12T08:00:00.000Z",
      },
      {
        movementType: "TransferOut",
        count: 1,
        quantityIn: 0,
        quantityOut: 4,
        latestOccurredAt: "2026-09-11T08:00:00.000Z",
      },
    ]);
  });
});
