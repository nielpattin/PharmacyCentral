import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { InventoryDatabase } from "../shared/infrastructure/database.ts";
import * as schema from "../shared/infrastructure/schema.ts";
import { InventoryRepository, StockDispenseError } from "./inventory-repository.ts";
import type { Page } from "./keyset-page.ts";
import { everything, readPageRequest, type PageOptions, type PageRequest } from "./page-cursor.ts";
import { InsufficientStockError } from "./stock/application/fefo-allocate.ts";

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
      (await repository.listTransfers({ siteIds })).rows.map((transfer) => transfer.id).sort();

    await expect(idsFor([siteA])).resolves.toEqual([transferAB, transferBA].sort());
    await expect(idsFor([siteB])).resolves.toEqual([transferAB, transferBA].sort());
    await expect(idsFor([siteC])).resolves.toEqual([]);
    await expect(idsFor([])).resolves.toEqual([]);
  });

  it("unions the balances of the reader's sites and excludes every other site", async () => {
    const siteIdsFor = async (siteIds: string[]): Promise<string[]> =>
      (await repository.listBalances({ siteIds })).rows.map((row) => row.balance.siteId).sort();

    await expect(siteIdsFor([siteA, siteB])).resolves.toEqual([siteA, siteB].sort());
    await expect(siteIdsFor([siteB])).resolves.toEqual([siteB]);
    await expect(siteIdsFor([])).resolves.toEqual([]);
  });

  it("unions the replenishment requests of the reader's sites and excludes every other site", async () => {
    const idsFor = async (siteIds: string[]): Promise<string[]> =>
      (await repository.listReplenishments({ siteIds })).rows.map((request) => request.id).sort();

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

/**
 * An online order is held against the whole site, the stock a shopper sees as available there, and the hold must be
 * all or nothing. The goods leave the shelf only when the order is handed over, once, and a hold that was given back
 * must never take stock away later.
 */
describe("InventoryRepository online order holds", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const repository = new InventoryRepository({ db, pool: undefined } as unknown as InventoryDatabase);

  const site = "00000000-0000-4000-8000-00000000000a";
  const front = "00000000-0000-4000-8000-00000000001a";
  const back = "00000000-0000-4000-8000-00000000001b";
  const product = "00000000-0000-4000-8000-00000000002a";
  const frontBatch = "00000000-0000-4000-8000-00000000004a";
  const backBatch = "00000000-0000-4000-8000-00000000004b";
  const order = "00000000-0000-4000-8000-00000000005a";

  const balanceOf = async (productBatchId: string) => {
    const [row] = await db
      .select()
      .from(schema.inventoryBalances)
      .where(eq(schema.inventoryBalances.productBatchId, productBatchId));
    return { onHand: Number(row?.quantityOnHand), reserved: Number(row?.quantityReserved) };
  };
  const hold = (reservationId: string, quantity: number) =>
    repository.reserve({
      reservationId,
      ownerId: reservationId,
      siteId: site,
      lines: [{ productId: product, quantity }],
    });

  beforeAll(async () => {
    await migrate(db, { migrationsFolder });
  });

  beforeEach(async () => {
    await client.exec(`
      TRUNCATE product_batches, inventory_balances, stock_reservations, stock_reservation_lines,
        stock_ledger_entries, outbox_messages;
    `);
    // The front batch expires first, so FEFO takes it before the back one.
    await db.insert(schema.productBatches).values([
      { id: frontBatch, productId: product, batchNumber: "FRONT", expiryDate: "2098-01-31", qualityStatus: "Released" },
      { id: backBatch, productId: product, batchNumber: "BACK", expiryDate: "2099-01-31", qualityStatus: "Released" },
    ]);
    await db.insert(schema.inventoryBalances).values([
      { productBatchId: frontBatch, siteId: site, storageLocationId: front, quantityOnHand: "3" },
      { productBatchId: backBatch, siteId: site, storageLocationId: back, quantityOnHand: "5" },
    ]);
  });

  afterAll(async () => {
    await client.close();
  });

  it("holds the stock of every location of the site, earliest expiry first", async () => {
    const allocations = await hold(order, 5);

    expect(allocations.map(({ productBatchId, quantity }) => [productBatchId, quantity])).toEqual([
      [frontBatch, 3],
      [backBatch, 2],
    ]);
  });

  it("holds nothing at all when the site cannot cover the order", async () => {
    await expect(hold(order, 9)).rejects.toBeInstanceOf(InsufficientStockError);

    await expect(balanceOf(frontBatch)).resolves.toEqual({ onHand: 3, reserved: 0 });
    await expect(balanceOf(backBatch)).resolves.toEqual({ onHand: 5, reserved: 0 });
    await expect(db.select().from(schema.stockReservations)).resolves.toHaveLength(0);
  });

  it("does not sell the same units to a second order", async () => {
    await hold(order, 7);

    await expect(hold("00000000-0000-4000-8000-00000000005b", 2)).rejects.toBeInstanceOf(InsufficientStockError);
  });

  it("takes the held goods off the shelf once, with a ledger entry that names the order", async () => {
    await hold(order, 5);

    await repository.consumeReservation(order, "Order", order);
    await repository.consumeReservation(order, "Order", order);

    await expect(balanceOf(frontBatch)).resolves.toEqual({ onHand: 0, reserved: 0 });
    await expect(balanceOf(backBatch)).resolves.toEqual({ onHand: 3, reserved: 0 });
    const ledger = await db.select().from(schema.stockLedgerEntries);
    expect(
      ledger
        .map((entry) => [entry.referenceType, entry.referenceId, Number(entry.quantityDelta)] as const)
        .toSorted((left, right) => left[2] - right[2]),
    ).toEqual([
      ["Order", order, -3],
      ["Order", order, -2],
    ]);
    const [reservation] = await db.select().from(schema.stockReservations);
    expect(reservation?.status).toBe("consumed");
  });

  it("takes nothing when an order whose hold was given back is handed over", async () => {
    await hold(order, 5);
    await repository.releaseReservation(order);

    await repository.consumeReservation(order, "Order", order);

    await expect(balanceOf(frontBatch)).resolves.toEqual({ onHand: 3, reserved: 0 });
    await expect(balanceOf(backBatch)).resolves.toEqual({ onHand: 5, reserved: 0 });
    await expect(db.select().from(schema.stockLedgerEntries)).resolves.toHaveLength(0);
  });

  it("answers an unknown reservation with nothing", async () => {
    await expect(repository.consumeReservation(order, "Order", order)).resolves.toBeUndefined();
  });
});

/**
 * Every list pages by keyset: a cursor names the last row a page answered, so rows that share a sort value are
 * neither repeated nor skipped, and a filter or search applies to every page. Only the real engine with the real
 * migrations shows the ordering and the row comparison that the next page relies on.
 */
describe("InventoryRepository list paging", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const repository = new InventoryRepository({ db, pool: undefined } as unknown as InventoryDatabase);

  const site = "00000000-0000-4000-8000-00000000000a";
  const otherSite = "00000000-0000-4000-8000-00000000000b";
  const location = "00000000-0000-4000-8000-00000000001a";
  const product = "00000000-0000-4000-8000-00000000002a";
  const actor = "00000000-0000-4000-8000-00000000003a";
  const sameInstant = new Date("2026-03-01T10:00:00Z");
  const idOf = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
  const timestampPage: PageOptions = { kind: "timestamp", defaultLimit: 100, maxLimit: 500 };
  const expiryPage: PageOptions = { kind: "date", defaultLimit: 100, maxLimit: 500, allWithoutLimit: true };

  /** Follows the cursors the way a client does, each one read back by the route's own parser. */
  const everyPage = async <Row>(
    options: PageOptions,
    limit: number,
    list: (page: PageRequest) => Promise<Page<Row>>,
  ): Promise<Row[][]> => {
    const pages: Row[][] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 20; guard++) {
      const query = cursor === undefined ? { limit: String(limit) } : { limit: String(limit), cursor };
      const page = readPageRequest(query, options);
      if (!page) throw new Error("the repository's own cursor was refused");
      const answer = await list(page);
      pages.push(answer.rows);
      if (answer.nextCursor === undefined) return pages;
      cursor = answer.nextCursor;
    }
    throw new Error("paging did not end");
  };

  beforeAll(async () => {
    await migrate(db, { migrationsFolder });
  });

  beforeEach(async () => {
    await client.exec(`
      TRUNCATE product_batches, inventory_balances, stock_ledger_entries, transfer_orders,
        stock_adjustments, return_requests, return_lines CASCADE;
    `);
    // Six transfers: five share one timestamp, and TR-006 is the newest of all.
    const transfer = (n: number, status: string, createdAt: Date) => ({
      id: idOf(0x100 + n),
      transferNumber: `TR-${String(n).padStart(3, "0")}`,
      sourceSiteId: site,
      destinationSiteId: otherSite,
      status,
      createdBy: actor,
      createdAt,
    });
    await db
      .insert(schema.transferOrders)
      .values([
        transfer(1, "PendingApproval", sameInstant),
        transfer(2, "PendingApproval", sameInstant),
        transfer(3, "PendingApproval", sameInstant),
        transfer(4, "PendingApproval", sameInstant),
        transfer(5, "Approved", sameInstant),
        transfer(6, "PendingApproval", new Date("2026-03-02T10:00:00Z")),
      ]);
    // Three batches: two expire together, and NUM-7 expires last.
    await db.insert(schema.productBatches).values([
      { id: idOf(0x200), productId: product, batchNumber: "LOT-ALPHA", expiryDate: "2099-01-31" },
      { id: idOf(0x201), productId: product, batchNumber: "LOT-BETA", expiryDate: "2099-01-31" },
      { id: idOf(0x202), productId: product, batchNumber: "NUM-7", expiryDate: "2099-06-30" },
    ]);
    await db.insert(schema.inventoryBalances).values(
      [0x200, 0x201, 0x202].map((batch, index) => ({
        id: idOf(0x700 + index),
        productBatchId: idOf(batch),
        siteId: site,
        storageLocationId: location,
        quantityOnHand: "5",
      })),
    );
    const entry = (n: number, occurredAt: Date) => ({
      id: idOf(0x400 + n),
      productId: product,
      productBatchId: idOf(0x200),
      siteId: site,
      storageLocationId: location,
      quantityDelta: "1",
      quantityAfter: "1",
      movementType: "StockAdjustment",
      occurredAt,
    });
    await db
      .insert(schema.stockLedgerEntries)
      .values([
        entry(1, new Date("2026-02-01T10:00:00Z")),
        entry(2, sameInstant),
        entry(3, sameInstant),
        entry(4, sameInstant),
        entry(5, new Date("2026-03-02T10:00:00Z")),
      ]);
    await db.insert(schema.stockAdjustments).values([
      {
        id: idOf(0x500),
        productId: product,
        productBatchId: idOf(0x200),
        siteId: site,
        storageLocationId: location,
        adjustmentType: "Positive",
        quantity: "1",
        reason: "Damaged in transit",
        createdBy: actor,
      },
      {
        id: idOf(0x501),
        productId: product,
        productBatchId: idOf(0x202),
        siteId: site,
        storageLocationId: location,
        adjustmentType: "Negative",
        quantity: "1",
        reason: "Count correction",
        createdBy: actor,
      },
    ]);
    await db.insert(schema.returnRequests).values(
      [1, 2, 3].map((n) => ({
        id: idOf(0x600 + n),
        siteId: site,
        reason: `Return ${n}`,
        createdBy: actor,
        createdAt: sameInstant,
      })),
    );
  });

  afterAll(async () => {
    await client.close();
  });

  it("pages newest first through rows that share a timestamp, without repeats or gaps", async () => {
    const pages = await everyPage(timestampPage, 2, (page) => repository.listTransfers({ siteIds: [site] }, page));

    expect(pages.map((rows) => rows.length)).toEqual([2, 2, 2]);
    // TR-006 is newest; the five rows that share an instant follow in id order, descending.
    expect(pages.flat().map((transfer) => transfer.transferNumber)).toEqual([
      "TR-006",
      "TR-005",
      "TR-004",
      "TR-003",
      "TR-002",
      "TR-001",
    ]);
  });

  it("keeps the status filter on every page", async () => {
    const pages = await everyPage(timestampPage, 2, (page) =>
      repository.listTransfers({ siteIds: [site], statuses: ["PendingApproval"] }, page),
    );

    expect(pages.map((rows) => rows.length)).toEqual([2, 2, 1]);
    expect(
      pages
        .flat()
        .map((transfer) => transfer.transferNumber)
        .sort(),
    ).toEqual(["TR-001", "TR-002", "TR-003", "TR-004", "TR-006"]);
  });

  it("matches the transfer number case-insensitively, takes a literal wildcard, and pages the match", async () => {
    const matched = await everyPage(timestampPage, 1, (page) =>
      repository.listTransfers({ siteIds: [site], q: "tr-005" }, page),
    );
    const literal = await repository.listTransfers({ siteIds: [site], q: "%" }, everything);

    expect(matched.flat().map((transfer) => transfer.transferNumber)).toEqual(["TR-005"]);
    expect(literal.rows).toEqual([]);
  });

  it("counts the transfers its list selects, by status, exclusion and site", async () => {
    await expect(repository.countTransfers({ siteIds: [site], statuses: ["PendingApproval"] })).resolves.toBe(5);
    await expect(repository.countTransfers({ siteIds: [site], excludeStatuses: ["PendingApproval"] })).resolves.toBe(1);
    await expect(repository.countTransfers({ siteIds: [site], q: "tr-00" })).resolves.toBe(6);
    await expect(repository.countTransfers({ siteIds: [] })).resolves.toBe(0);
  });

  it("answers every balance when no limit is sent, and pages them in expiry order when one is", async () => {
    const unpaged = await repository.listBalances({ siteIds: [site] });
    expect(unpaged.rows).toHaveLength(3);
    expect(unpaged.nextCursor).toBeUndefined();

    const pages = await everyPage(expiryPage, 1, (page) => repository.listBalances({ siteIds: [site] }, page));
    const batchNumbers = pages.flat().map((row) => row.batch.batchNumber);
    expect(pages.map((rows) => rows.length)).toEqual([1, 1, 1]);
    expect(batchNumbers.at(-1)).toBe("NUM-7");
    expect([...batchNumbers].sort()).toEqual(["LOT-ALPHA", "LOT-BETA", "NUM-7"]);
  });

  it("searches balances and batches by batch number", async () => {
    const balances = await repository.listBalances({ siteIds: [site], q: "lot" });
    const batches = await repository.listBatches({ q: "num-7" });

    expect(balances.rows.map((row) => row.batch.batchNumber).sort()).toEqual(["LOT-ALPHA", "LOT-BETA"]);
    expect(batches.rows.map((batch) => batch.batchNumber)).toEqual(["NUM-7"]);
  });

  it("pages movements newest first and keeps the occurred-at window inclusive", async () => {
    const all = await everyPage(timestampPage, 2, (page) => repository.listMovements({}, page));
    expect(all.map((rows) => rows.length)).toEqual([2, 2, 1]);
    expect(new Set(all.flat().map((entry) => entry.id)).size).toBe(5);

    const window = await everyPage(timestampPage, 2, (page) =>
      repository.listMovements({ from: new Date("2026-03-01T00:00:00Z"), to: new Date("2026-03-01T23:59:59Z") }, page),
    );
    expect(window.map((rows) => rows.length)).toEqual([2, 1]);
  });

  it("answers every return when no page is asked for, and pages them when one is", async () => {
    const returnPage: PageOptions = { kind: "timestamp", defaultLimit: 100, maxLimit: 500, allWithoutLimit: true };
    const whole = await repository.listReturns({ siteIds: [site] });
    const pages = await everyPage(returnPage, 2, (page) => repository.listReturns({ siteIds: [site] }, page));

    expect(whole.rows).toHaveLength(3);
    expect(pages.map((rows) => rows.length)).toEqual([2, 1]);
  });

  it("searches adjustments by reason or by the number of the batch they move", async () => {
    const byReason = await repository.listAdjustments({ siteIds: [site], q: "transit" });
    const byBatch = await repository.listAdjustments({ siteIds: [site], q: "num-7" });

    expect(byReason.rows.map((row) => row.reason)).toEqual(["Damaged in transit"]);
    expect(byBatch.rows.map((row) => row.reason)).toEqual(["Count correction"]);
    await expect(repository.countAdjustments({ siteIds: [site], q: "count" })).resolves.toBe(1);
    await expect(repository.countAdjustments({ siteIds: [site], statuses: ["Pending"] })).resolves.toBe(2);
    await expect(repository.countAdjustments({ siteIds: [site], statuses: ["Approved"] })).resolves.toBe(0);
  });
});

/**
 * A hold is keyed by its reservation id: a repeated reserve must answer the first call's allocations and move no
 * stock, including after the hold was released, and a refused first call must leave nothing behind to repeat.
 */
describe("InventoryRepository reserve idempotency", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const repository = new InventoryRepository({ db, pool: undefined } as unknown as InventoryDatabase);

  const site = "00000000-0000-4000-8000-00000000000a";
  const location = "00000000-0000-4000-8000-00000000001a";
  const product = "00000000-0000-4000-8000-00000000002a";
  const owner = "00000000-0000-4000-8000-00000000003a";
  const earlyBatch = "00000000-0000-4000-8000-00000000004a";
  const lateBatch = "00000000-0000-4000-8000-00000000004b";
  const orderHold = "00000000-0000-4000-8000-00000000005a";
  const refusedHold = "00000000-0000-4000-8000-00000000005b";
  const raceHold = "00000000-0000-4000-8000-00000000005c";

  const balanceOf = async (productBatchId: string) => {
    const [row] = await db
      .select()
      .from(schema.inventoryBalances)
      .where(eq(schema.inventoryBalances.productBatchId, productBatchId));
    return { onHand: Number(row?.quantityOnHand), reserved: Number(row?.quantityReserved) };
  };
  const linesOf = (reservationId: string) =>
    db.select().from(schema.stockReservationLines).where(eq(schema.stockReservationLines.reservationId, reservationId));
  const hold = (reservationId: string, quantity: number) =>
    repository.reserve({
      reservationId,
      ownerId: owner,
      siteId: site,
      storageLocationId: location,
      lines: [{ productId: product, quantity }],
    });

  beforeAll(async () => {
    await migrate(db, { migrationsFolder });
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
  });

  afterAll(async () => {
    await client.close();
  });

  it("answers a repeated reserve with the first allocations and holds nothing more", async () => {
    const first = await hold(orderHold, 4);
    const repeated = await hold(orderHold, 4);

    expect(first.reduce((total, allocation) => total + allocation.quantity, 0)).toBe(4);
    expect(repeated).toEqual(first);
    await expect(balanceOf(earlyBatch)).resolves.toEqual({ onHand: 10, reserved: 4 });
    await expect(balanceOf(lateBatch)).resolves.toEqual({ onHand: 10, reserved: 0 });
    await expect(linesOf(orderHold)).resolves.toHaveLength(1);
  });

  it("does not hold again for a repeat after the hold was released", async () => {
    await repository.releaseReservation(orderHold);
    const repeated = await hold(orderHold, 4);

    expect(repeated.every((allocation) => allocation.quantity === 0)).toBe(true);
    await expect(balanceOf(earlyBatch)).resolves.toEqual({ onHand: 10, reserved: 0 });
    const [reservation] = await db
      .select()
      .from(schema.stockReservations)
      .where(eq(schema.stockReservations.id, orderHold));
    expect(reservation?.status).toBe("released");
  });

  it("holds once when two calls for the same reservation race", async () => {
    const results = await Promise.all([hold(raceHold, 2), hold(raceHold, 2)]);

    expect(results[0]).toEqual(results[1]);
    await expect(linesOf(raceHold)).resolves.toHaveLength(1);
    await expect(balanceOf(earlyBatch)).resolves.toEqual({ onHand: 10, reserved: 2 });
  });

  it("leaves no reservation behind when the first call is refused, so a later call can hold", async () => {
    await expect(hold(refusedHold, 999)).rejects.toBeInstanceOf(InsufficientStockError);
    await expect(
      db.select().from(schema.stockReservations).where(eq(schema.stockReservations.id, refusedHold)),
    ).resolves.toHaveLength(0);

    const later = await hold(refusedHold, 1);

    expect(later.reduce((total, allocation) => total + allocation.quantity, 0)).toBe(1);
  });
});
