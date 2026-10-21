import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { InventoryDatabase } from "../shared/infrastructure/database.ts";
import * as schema from "../shared/infrastructure/schema.ts";
import { InventoryRepository, StockDispenseError } from "./inventory-repository.ts";

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

/**
 * A dispense must take the goods off the batch the pharmacist handed over, give back the hold FEFO placed, and never
 * move stock twice for one dispense id; only the real engine with the real migrations shows the rows that result.
 */
describe("InventoryRepository dispense", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const repository = new InventoryRepository({ db, pool: undefined } as unknown as InventoryDatabase);

  const site = "00000000-0000-4000-8000-00000000000a";
  const location = "00000000-0000-4000-8000-00000000001a";
  const product = "00000000-0000-4000-8000-00000000002a";
  const actor = "00000000-0000-4000-8000-00000000003a";
  // FEFO reserves the earlier expiry; the pharmacist may still hand over the later one.
  const earlyBatch = "00000000-0000-4000-8000-00000000004a";
  const lateBatch = "00000000-0000-4000-8000-00000000004b";
  const expiredBatch = "00000000-0000-4000-8000-00000000004c";
  const reservation = "00000000-0000-4000-8000-00000000005a";
  const prescription = "00000000-0000-4000-8000-00000000006a";

  const balanceOf = async (productBatchId: string) => {
    const [row] = await db
      .select()
      .from(schema.inventoryBalances)
      .where(eq(schema.inventoryBalances.productBatchId, productBatchId));
    return { onHand: Number(row?.quantityOnHand), reserved: Number(row?.quantityReserved) };
  };
  const reservationStatus = async () =>
    (await db.select().from(schema.stockReservations).where(eq(schema.stockReservations.id, reservation)))[0]?.status;
  const dispense = (dispenseId: string, productBatchId: string, quantity: number) =>
    repository.dispense({
      dispenseId,
      reservationId: reservation,
      referenceId: prescription,
      siteId: site,
      storageLocationId: location,
      actorId: actor,
      lines: [{ productId: product, productBatchId, quantity }],
    });

  beforeAll(async () => {
    await migrate(db, { migrationsFolder });
  });

  beforeEach(async () => {
    await client.exec(`
      TRUNCATE product_batches, inventory_balances, stock_reservations, stock_reservation_lines,
        stock_ledger_entries, idempotency_records, outbox_messages;
    `);
    await db.insert(schema.productBatches).values([
      { id: earlyBatch, productId: product, batchNumber: "EARLY", expiryDate: "2099-01-31", qualityStatus: "Released" },
      { id: lateBatch, productId: product, batchNumber: "LATE", expiryDate: "2099-12-31", qualityStatus: "Released" },
    ]);
    await db.insert(schema.inventoryBalances).values(
      [earlyBatch, lateBatch].map((productBatchId) => ({
        productBatchId,
        siteId: site,
        storageLocationId: location,
        quantityOnHand: "10",
      })),
    );
    await repository.reserve({
      reservationId: reservation,
      ownerId: prescription,
      siteId: site,
      storageLocationId: location,
      lines: [{ productId: product, quantity: 4 }],
    });
  });

  afterAll(async () => {
    await client.close();
  });

  it("takes the goods off the handed-over batch, releases the hold, and consumes it once filled", async () => {
    await dispense("first", lateBatch, 1);

    await expect(balanceOf(lateBatch)).resolves.toEqual({ onHand: 9, reserved: 0 });
    await expect(balanceOf(earlyBatch)).resolves.toEqual({ onHand: 10, reserved: 3 });
    await expect(reservationStatus()).resolves.toBe("active");

    await dispense("second", earlyBatch, 3);

    await expect(balanceOf(earlyBatch)).resolves.toEqual({ onHand: 7, reserved: 0 });
    await expect(reservationStatus()).resolves.toBe("consumed");
    const ledger = await db.select().from(schema.stockLedgerEntries);
    expect(ledger.map((entry) => [entry.movementType, entry.referenceId, Number(entry.quantityDelta)])).toEqual([
      ["Dispense", prescription, -1],
      ["Dispense", prescription, -3],
    ]);
  });

  it("answers a repeated dispense id with the first result and moves no more stock", async () => {
    const first = await dispense("same", lateBatch, 2);
    const repeated = await dispense("same", lateBatch, 2);

    expect(repeated).toEqual(JSON.parse(JSON.stringify(first)));
    await expect(balanceOf(lateBatch)).resolves.toEqual({ onHand: 8, reserved: 0 });
    await expect(db.select().from(schema.stockLedgerEntries)).resolves.toHaveLength(1);
  });

  it("refuses an expired batch and leaves the stock and the hold untouched", async () => {
    await db.insert(schema.productBatches).values({
      id: expiredBatch,
      productId: product,
      batchNumber: "OLD",
      expiryDate: "2000-01-31",
      qualityStatus: "Released",
    });
    await db
      .insert(schema.inventoryBalances)
      .values({ productBatchId: expiredBatch, siteId: site, storageLocationId: location, quantityOnHand: "10" });

    await expect(dispense("expired", expiredBatch, 1)).rejects.toBeInstanceOf(StockDispenseError);

    await expect(balanceOf(expiredBatch)).resolves.toEqual({ onHand: 10, reserved: 0 });
    await expect(balanceOf(earlyBatch)).resolves.toEqual({ onHand: 10, reserved: 4 });
    await expect(db.select().from(schema.stockLedgerEntries)).resolves.toHaveLength(0);
  });

  it("releases only what a partly dispensed reservation still holds, and never another sale's hold", async () => {
    await dispense("partial", earlyBatch, 1);
    // Another sale holds two more units of the same batch; a repeated cancel must not give those back.
    await repository.reserve({
      reservationId: "00000000-0000-4000-8000-00000000005b",
      ownerId: "00000000-0000-4000-8000-00000000006b",
      siteId: site,
      storageLocationId: location,
      lines: [{ productId: product, quantity: 2 }],
    });

    await repository.releaseReservation(reservation);
    await repository.releaseReservation(reservation);

    await expect(balanceOf(earlyBatch)).resolves.toEqual({ onHand: 9, reserved: 2 });
    await expect(reservationStatus()).resolves.toBe("released");
  });
});

/**
 * Only released, unexpired stock may be held for a sale or shown to shoppers as available, and availability is the
 * product's free stock across every such batch at the site, never the one batch that just moved.
 */
describe("InventoryRepository sellable stock", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const repository = new InventoryRepository({ db, pool: undefined } as unknown as InventoryDatabase);
  /** The availability answers the stock changes left in the outbox, oldest first. */
  const published = async (): Promise<unknown[]> =>
    (await db.select().from(schema.outboxMessages).orderBy(schema.outboxMessages.occurredAt)).map((message) =>
      JSON.parse(message.payload),
    );

  const site = "00000000-0000-4000-8000-00000000000a";
  const location = "00000000-0000-4000-8000-00000000001a";
  const product = "00000000-0000-4000-8000-00000000002a";
  const expiredBatch = "00000000-0000-4000-8000-00000000004a";
  const pendingBatch = "00000000-0000-4000-8000-00000000004b";
  const sellableA = "00000000-0000-4000-8000-00000000004c";
  const sellableB = "00000000-0000-4000-8000-00000000004d";

  const stock = async (
    batches: Array<{ id: string; expiryDate: string; qualityStatus: string; onHand: number }>,
  ): Promise<void> => {
    await db.insert(schema.productBatches).values(
      batches.map(({ id, expiryDate, qualityStatus }) => ({
        id,
        productId: product,
        batchNumber: id,
        expiryDate,
        qualityStatus,
      })),
    );
    await db.insert(schema.inventoryBalances).values(
      batches.map(({ id, onHand }) => ({
        productBatchId: id,
        siteId: site,
        storageLocationId: location,
        quantityOnHand: String(onHand),
      })),
    );
  };
  const takeAll = (productBatchId: string, quantity: number) =>
    repository.recordMovement({
      productId: product,
      productBatchId,
      siteId: site,
      storageLocationId: location,
      quantityDelta: -quantity,
      movementType: "StockAdjustment",
    });

  beforeAll(async () => {
    await migrate(db, { migrationsFolder });
  });

  beforeEach(async () => {
    await client.exec(`
      TRUNCATE product_batches, inventory_balances, stock_reservations, stock_reservation_lines,
        stock_ledger_entries, outbox_messages;
    `);
  });

  afterAll(async () => {
    await client.close();
  });

  it("holds a sale's stock on a sellable batch, never on an expired one that expires first", async () => {
    await stock([
      { id: expiredBatch, expiryDate: "2000-01-31", qualityStatus: "Released", onHand: 10 },
      { id: sellableA, expiryDate: "2099-01-31", qualityStatus: "Released", onHand: 10 },
    ]);

    const allocations = await repository.reserve({
      reservationId: "00000000-0000-4000-8000-00000000005a",
      ownerId: "00000000-0000-4000-8000-00000000006a",
      siteId: site,
      storageLocationId: location,
      lines: [{ productId: product, quantity: 4 }],
    });

    expect(allocations.map((allocation) => allocation.productBatchId)).toEqual([sellableA]);
  });

  it("keeps a product available while another sellable batch still has stock", async () => {
    await stock([
      { id: sellableA, expiryDate: "2099-01-31", qualityStatus: "Released", onHand: 5 },
      { id: sellableB, expiryDate: "2099-06-30", qualityStatus: "Released", onHand: 5 },
    ]);

    await takeAll(sellableA, 5);

    expect(await published()).toEqual([{ productId: product, siteId: site, inStock: true }]);
  });

  it("shows a product out of stock when only expired or unreleased goods remain", async () => {
    await stock([
      { id: expiredBatch, expiryDate: "2000-01-31", qualityStatus: "Released", onHand: 10 },
      { id: pendingBatch, expiryDate: "2099-01-31", qualityStatus: "PendingQc", onHand: 10 },
      { id: sellableA, expiryDate: "2099-01-31", qualityStatus: "Released", onHand: 5 },
    ]);

    await takeAll(sellableA, 5);

    expect(await published()).toEqual([{ productId: product, siteId: site, inStock: false }]);
  });

  it("puts a product in stock when quality control releases its batch", async () => {
    await stock([{ id: pendingBatch, expiryDate: "2099-01-31", qualityStatus: "PendingQc", onHand: 10 }]);

    await repository.reviewBatch(pendingBatch, "Released");

    expect(await published()).toEqual([{ productId: product, siteId: site, inStock: true }]);
  });

  it("shows a product out of stock once a sale holds its last free unit", async () => {
    await stock([{ id: sellableA, expiryDate: "2099-01-31", qualityStatus: "Released", onHand: 3 }]);

    await repository.reserve({
      reservationId: "00000000-0000-4000-8000-00000000005a",
      ownerId: "00000000-0000-4000-8000-00000000006a",
      siteId: site,
      storageLocationId: location,
      lines: [{ productId: product, quantity: 3 }],
    });

    expect(await published()).toEqual([{ productId: product, siteId: site, inStock: false }]);
  });

  it("shows a product in stock again when the sale gives its hold back", async () => {
    await stock([{ id: sellableA, expiryDate: "2099-01-31", qualityStatus: "Released", onHand: 3 }]);
    const reservationId = "00000000-0000-4000-8000-00000000005a";
    await repository.reserve({
      reservationId,
      ownerId: "00000000-0000-4000-8000-00000000006a",
      siteId: site,
      storageLocationId: location,
      lines: [{ productId: product, quantity: 3 }],
    });
    await db.delete(schema.outboxMessages);

    await repository.releaseReservation(reservationId);

    expect(await published()).toEqual([{ productId: product, siteId: site, inStock: true }]);
  });

  it("takes a product out of stock when its only batch expires while nothing moves", async () => {
    await stock([{ id: sellableA, expiryDate: "2000-01-31", qualityStatus: "Released", onHand: 5 }]);

    await expect(repository.refreshAvailabilityForExpiredStock()).resolves.toBe(1);

    expect(await published()).toEqual([{ productId: product, siteId: site, inStock: false }]);
  });

  it("leaves an expiry already answered alone when the sweep is bounded to later dates", async () => {
    await stock([{ id: sellableA, expiryDate: "2000-01-31", qualityStatus: "Released", onHand: 5 }]);

    await expect(repository.refreshAvailabilityForExpiredStock("2001-01-01")).resolves.toBe(0);

    expect(await published()).toEqual([]);
  });
});
