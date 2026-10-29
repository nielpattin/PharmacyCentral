import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

import type { InventoryDatabase } from "../shared/infrastructure/database.ts";
import * as schema from "../shared/infrastructure/schema.ts";
import { InventoryRepository } from "./inventory-repository.ts";

const migrationsFolder = fileURLToPath(new URL("../../drizzle/migrations", import.meta.url));
const idOf = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

const site = idOf(0xa);
const location = idOf(0x1a);
const product = idOf(0x2a);
const receipt = idOf(0x3a);
const supplier = idOf(0x4a);

/**
 * The cost of a sale is a join of the ledger and the receipt lines. Only the real engine shows the quantity-weighted
 * mean over several receipts of one batch, that a batch with no recorded cost stays uncosted rather than free, and that
 * a sale mixing a costed and an uncosted batch reports the two quantities apart.
 */
describe("InventoryRepository dispense costs", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const repository = new InventoryRepository({ db, pool: undefined } as unknown as InventoryDatabase);

  const sale = {
    twoReceipts: idOf(0x501),
    uncosted: idOf(0x502),
    mixed: idOf(0x503),
    rx: idOf(0x504),
    old: idOf(0x505),
    other: idOf(0x506),
  };
  const dispense = (batch: string, quantity: number, referenceType: string, referenceId: string, at: string) => ({
    productId: product,
    productBatchId: batch,
    siteId: site,
    storageLocationId: location,
    quantityDelta: String(-quantity),
    quantityAfter: "0",
    movementType: "Dispense",
    referenceType,
    referenceId,
    occurredAt: new Date(at),
  });
  const receiptLine = (batchNumber: string, quantity: number, unitCost: string | null) => ({
    goodsReceiptId: receipt,
    productId: product,
    batchNumber,
    expiryDate: "2027-01-01",
    quantity,
    unitCost,
  });

  beforeAll(async () => {
    await migrate(db, { migrationsFolder });
    await db.insert(schema.productBatches).values([
      { id: idOf(0x11), productId: product, batchNumber: "A", expiryDate: "2027-01-01" },
      { id: idOf(0x12), productId: product, batchNumber: "B", expiryDate: "2027-01-01" },
      { id: idOf(0x13), productId: product, batchNumber: "C", expiryDate: "2027-01-01" },
    ]);
    await db.insert(schema.goodsReceipts).values({
      id: receipt,
      receiptNumber: "GR-1",
      supplierId: supplier,
      siteId: site,
      storageLocationId: location,
      receivedAt: new Date("2026-09-01T00:00:00Z"),
      createdBy: idOf(0x9),
    });
    await db.insert(schema.goodsReceiptLines).values([
      // Batch A arrived twice: 10 units at 100 and 30 units at 200, so a unit costs (1000 + 6000) / 40 = 175.
      receiptLine("A", 10, "100.00"),
      receiptLine("A", 30, "200.00"),
      // A third line of A with no recorded cost does not drag the mean down to zero.
      receiptLine("A", 60, null),
      // Batch B has only a line with no cost; batch C is costed.
      receiptLine("B", 50, null),
      receiptLine("C", 50, "50.00"),
    ]);
    await db.insert(schema.stockLedgerEntries).values([
      dispense(idOf(0x11), 4, "Order", sale.twoReceipts, "2026-10-10T00:00:00Z"),
      dispense(idOf(0x12), 3, "Order", sale.uncosted, "2026-10-11T00:00:00Z"),
      // One sale taking 2 from the costed batch C and 5 from the uncosted batch B.
      dispense(idOf(0x13), 2, "Order", sale.mixed, "2026-10-12T00:00:00Z"),
      dispense(idOf(0x12), 5, "Order", sale.mixed, "2026-10-12T00:00:00Z"),
      dispense(idOf(0x13), 6, "Prescription", sale.rx, "2026-10-13T00:00:00Z"),
      // Before the window, and not a sale: neither may be read.
      dispense(idOf(0x13), 9, "Order", sale.old, "2026-08-01T00:00:00Z"),
      { ...dispense(idOf(0x13), 1, "Order", sale.other, "2026-10-14T00:00:00Z"), movementType: "Adjustment" },
    ]);
  });

  const since = new Date("2026-10-01T00:00:00Z");
  const byReference = async (window = since) =>
    new Map((await repository.dispenseCosts({ since: window })).map((row) => [row.referenceId, row]));

  it("prices a batch received twice by the mean of its costs weighted by quantity", async () => {
    expect((await byReference()).get(sale.twoReceipts)).toEqual({
      referenceType: "Order",
      referenceId: sale.twoReceipts,
      quantity: 4,
      costedQuantity: 4,
      cost: 700,
    });
  });

  it("leaves a batch with no recorded cost uncosted, not free", async () => {
    expect((await byReference()).get(sale.uncosted)).toMatchObject({ quantity: 3, costedQuantity: 0, cost: 0 });
  });

  it("reports the costed and uncosted quantity of a sale that takes both kinds of batch", async () => {
    expect((await byReference()).get(sale.mixed)).toMatchObject({ quantity: 7, costedQuantity: 2, cost: 100 });
  });

  it("names a counter sale by its prescription", async () => {
    expect((await byReference()).get(sale.rx)).toMatchObject({ referenceType: "Prescription", cost: 300 });
  });

  it("reads only sales dispensed at or after the instant, and no other movement", async () => {
    const rows = await byReference();
    expect(rows.has(sale.old)).toBe(false);
    expect(rows.has(sale.other)).toBe(false);
    expect(rows.size).toBe(4);
    const later = await byReference(new Date("2026-10-12T00:00:00Z"));
    expect([...later.keys()].sort()).toEqual([sale.mixed, sale.rx].sort());
  });

  it("answers one row more than the cap, so a caller can tell the answer was cut", async () => {
    expect(await repository.dispenseCosts({ since, maxRows: 2 })).toHaveLength(3);
  });
});
