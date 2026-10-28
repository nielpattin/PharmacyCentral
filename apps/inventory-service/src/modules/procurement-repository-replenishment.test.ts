import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { InventoryDatabase } from "../shared/infrastructure/database.ts";
import * as schema from "../shared/infrastructure/schema.ts";
import { ProcurementRepository } from "./procurement-repository.ts";

const migrationsFolder = fileURLToPath(new URL("../../drizzle/migrations", import.meta.url));
const idOf = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

const siteA = idOf(0xa);
const siteB = idOf(0xb);
const locationA = idOf(0x1a);
const locationA2 = idOf(0x1c);
const locationB = idOf(0x1b);
const actor = idOf(0x3a);
const s1 = idOf(0x51);
const s2 = idOf(0x52);
const s3 = idOf(0x53);
const s4 = idOf(0x54);
const s5 = idOf(0x55);
const s6 = idOf(0x56);
const p1 = idOf(0x101);
const p2 = idOf(0x102);
const p3 = idOf(0x103);
const p5 = idOf(0x105);
const noon = (day: string) => new Date(`${day}T12:00:00Z`);

/**
 * The replenishment inputs are one statement per answer. Only the real engine shows which ledger entries count inside
 * the window, which open purchase order lines count, which receipt names the supplier, and which orders' lead times
 * fall in the 12-month history.
 */
describe("ProcurementRepository replenishment inputs", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const repository = new ProcurementRepository({ db, pool: undefined } as unknown as InventoryDatabase);
  const now = new Date("2026-10-28T12:00:00Z");
  const windowStart = new Date("2026-09-28T12:00:00Z");

  beforeAll(async () => {
    await migrate(db, { migrationsFolder });
    await db.insert(schema.productBatches).values([
      { id: idOf(0x201), productId: p1, batchNumber: "B1", expiryDate: "2027-06-01" },
      { id: idOf(0x202), productId: p1, batchNumber: "B2", expiryDate: "2027-07-01" },
      { id: idOf(0x203), productId: p3, batchNumber: "B3", expiryDate: "2027-08-01" },
      { id: idOf(0x204), productId: idOf(0x104), batchNumber: "B4", expiryDate: "2027-09-01" },
      { id: idOf(0x205), productId: p2, batchNumber: "B5", expiryDate: "2027-10-01" },
      { id: idOf(0x206), productId: p5, batchNumber: "B6", expiryDate: "2027-11-01" },
    ]);
    // p1: 40 + 10 on hand at A, 5 reserved; p3: 3 on hand at A; p4 only at B. p2 has no balance at A.
    await db.insert(schema.inventoryBalances).values([
      {
        productBatchId: idOf(0x201),
        siteId: siteA,
        storageLocationId: locationA,
        quantityOnHand: "40",
        quantityReserved: "5",
      },
      {
        productBatchId: idOf(0x202),
        siteId: siteA,
        storageLocationId: locationA2,
        quantityOnHand: "10",
        quantityReserved: "0",
      },
      {
        productBatchId: idOf(0x203),
        siteId: siteA,
        storageLocationId: locationA,
        quantityOnHand: "3",
        quantityReserved: "0",
      },
      {
        productBatchId: idOf(0x204),
        siteId: siteB,
        storageLocationId: locationB,
        quantityOnHand: "7",
        quantityReserved: "0",
      },
    ]);
    const ledger = (
      productId: string,
      productBatchId: string,
      siteId: string,
      storageLocationId: string,
      quantityDelta: string,
      movementType: string,
      occurredAt: Date,
    ) => ({
      productId,
      productBatchId,
      siteId,
      storageLocationId,
      quantityDelta,
      quantityAfter: "0",
      movementType,
      occurredAt,
    });
    await db.insert(schema.stockLedgerEntries).values([
      ledger(p1, idOf(0x201), siteA, locationA, "-4", "Dispense", noon("2026-10-20")),
      ledger(p1, idOf(0x201), siteA, locationA, "-6", "Dispense", noon("2026-10-01")),
      // Outside the 30-day window, a receipt movement, and a dispense at the other site: none counts.
      ledger(p1, idOf(0x201), siteA, locationA, "-100", "Dispense", noon("2026-01-01")),
      ledger(p1, idOf(0x201), siteA, locationA, "50", "GoodsReceipt", noon("2026-10-15")),
      ledger(p1, idOf(0x204), siteB, locationB, "-50", "Dispense", noon("2026-10-20")),
      // p2 sells at A without a balance there; p5 sold at A only before the window, so it is no candidate.
      ledger(p2, idOf(0x205), siteA, locationA, "-3", "Dispense", noon("2026-10-10")),
      ledger(p5, idOf(0x206), siteA, locationA, "-9", "Dispense", noon("2026-08-01")),
    ]);
    await db.insert(schema.purchaseOrders).values([
      // PO1 and PO2 are open at A; PO3 is received, PO4 is a draft at A; PO7 is a cancelled order at A; PO8 is a draft at B.
      {
        id: idOf(0x301),
        purchaseOrderNumber: "PO-R-1",
        supplierId: s1,
        siteId: siteA,
        status: "Approved",
        createdBy: actor,
        createdAt: noon("2026-09-01"),
      },
      {
        id: idOf(0x302),
        purchaseOrderNumber: "PO-R-2",
        supplierId: s1,
        siteId: siteA,
        status: "PartiallyReceived",
        createdBy: actor,
        createdAt: noon("2026-09-02"),
      },
      {
        id: idOf(0x303),
        purchaseOrderNumber: "PO-R-3",
        supplierId: s1,
        siteId: siteA,
        status: "Received",
        createdBy: actor,
        createdAt: noon("2026-06-01"),
      },
      {
        id: idOf(0x304),
        purchaseOrderNumber: "PO-R-4",
        supplierId: s2,
        siteId: siteA,
        status: "Draft",
        createdBy: actor,
        createdAt: noon("2026-10-25"),
      },
      {
        id: idOf(0x307),
        purchaseOrderNumber: "PO-R-7",
        supplierId: s1,
        siteId: siteA,
        status: "Cancelled",
        createdBy: actor,
        createdAt: noon("2026-09-05"),
      },
      {
        id: idOf(0x308),
        purchaseOrderNumber: "PO-R-8",
        supplierId: s1,
        siteId: siteB,
        status: "Draft",
        createdBy: actor,
        createdAt: noon("2026-09-06"),
      },
      // PO5 was received before the 12-month history; PO6 was received before it was created.
      {
        id: idOf(0x305),
        purchaseOrderNumber: "PO-R-5",
        supplierId: s5,
        siteId: siteA,
        status: "Received",
        createdBy: actor,
        createdAt: noon("2025-01-01"),
      },
      {
        id: idOf(0x306),
        purchaseOrderNumber: "PO-R-6",
        supplierId: s6,
        siteId: siteA,
        status: "Approved",
        createdBy: actor,
        createdAt: noon("2026-10-20"),
      },
    ]);
    await db.insert(schema.purchaseOrderLines).values([
      { purchaseOrderId: idOf(0x301), productId: p1, orderedQuantity: 30, receivedQuantity: 0 },
      { purchaseOrderId: idOf(0x301), productId: p3, orderedQuantity: 5, receivedQuantity: 5 },
      // Received beyond the ordered quantity: the open quantity is clamped at zero, never negative.
      { purchaseOrderId: idOf(0x301), productId: p2, orderedQuantity: 2, receivedQuantity: 4 },
      { purchaseOrderId: idOf(0x302), productId: p1, orderedQuantity: 20, receivedQuantity: 5 },
      { purchaseOrderId: idOf(0x303), productId: p1, orderedQuantity: 100, receivedQuantity: 100 },
      { purchaseOrderId: idOf(0x304), productId: p3, orderedQuantity: 12, receivedQuantity: 0 },
      { purchaseOrderId: idOf(0x307), productId: p1, orderedQuantity: 50, receivedQuantity: 0 },
      { purchaseOrderId: idOf(0x308), productId: p1, orderedQuantity: 9, receivedQuantity: 0 },
    ]);
    await db.insert(schema.goodsReceipts).values([
      {
        id: idOf(0x401),
        receiptNumber: "GR-R-A",
        purchaseOrderId: idOf(0x301),
        supplierId: s1,
        siteId: siteA,
        storageLocationId: locationA,
        receivedAt: noon("2026-09-10"),
        createdBy: actor,
      },
      {
        id: idOf(0x402),
        receiptNumber: "GR-R-B",
        purchaseOrderId: idOf(0x301),
        supplierId: s1,
        siteId: siteA,
        storageLocationId: locationA,
        receivedAt: noon("2026-09-30"),
        createdBy: actor,
      },
      {
        id: idOf(0x403),
        receiptNumber: "GR-R-C",
        purchaseOrderId: idOf(0x302),
        supplierId: s1,
        siteId: siteA,
        storageLocationId: locationA,
        receivedAt: noon("2026-09-20"),
        createdBy: actor,
      },
      {
        id: idOf(0x404),
        receiptNumber: "GR-R-D",
        purchaseOrderId: idOf(0x303),
        supplierId: s1,
        siteId: siteA,
        storageLocationId: locationA,
        receivedAt: noon("2026-08-01"),
        createdBy: actor,
      },
      // Any-site receipts: a later one for p1 (site A's own receipt still wins), and two for p2 at B.
      {
        id: idOf(0x405),
        receiptNumber: "GR-R-E",
        supplierId: s3,
        siteId: siteB,
        storageLocationId: locationB,
        receivedAt: noon("2026-10-05"),
        createdBy: actor,
      },
      {
        id: idOf(0x406),
        receiptNumber: "GR-R-F",
        supplierId: s3,
        siteId: siteB,
        storageLocationId: locationB,
        receivedAt: noon("2026-10-01"),
        createdBy: actor,
      },
      {
        id: idOf(0x407),
        receiptNumber: "GR-R-G",
        supplierId: s4,
        siteId: siteB,
        storageLocationId: locationB,
        receivedAt: noon("2026-09-01"),
        createdBy: actor,
      },
      {
        id: idOf(0x408),
        receiptNumber: "GR-R-H",
        purchaseOrderId: idOf(0x305),
        supplierId: s5,
        siteId: siteA,
        storageLocationId: locationA,
        receivedAt: noon("2025-02-01"),
        createdBy: actor,
      },
      {
        id: idOf(0x409),
        receiptNumber: "GR-R-I",
        purchaseOrderId: idOf(0x306),
        supplierId: s6,
        siteId: siteA,
        storageLocationId: locationA,
        receivedAt: noon("2026-10-10"),
        createdBy: actor,
      },
    ]);
    await db.insert(schema.goodsReceiptLines).values([
      { goodsReceiptId: idOf(0x401), productId: p1, batchNumber: "B1", expiryDate: "2027-06-01", quantity: 30 },
      { goodsReceiptId: idOf(0x403), productId: p1, batchNumber: "B2", expiryDate: "2027-07-01", quantity: 5 },
      { goodsReceiptId: idOf(0x404), productId: p1, batchNumber: "B1", expiryDate: "2027-06-01", quantity: 100 },
      { goodsReceiptId: idOf(0x405), productId: p1, batchNumber: "B1", expiryDate: "2027-06-01", quantity: 7 },
      { goodsReceiptId: idOf(0x406), productId: p2, batchNumber: "B5", expiryDate: "2027-10-01", quantity: 4 },
      { goodsReceiptId: idOf(0x407), productId: p2, batchNumber: "B5", expiryDate: "2027-10-01", quantity: 9 },
    ]);
  });

  afterAll(async () => {
    await client.close();
  });

  it("answers one position per product with a balance or a window dispense, at the site only", async () => {
    const { positions } = await repository.replenishmentInputs({ siteId: siteA, windowStart, now });

    expect(positions.map((position) => position.productId).sort()).toEqual([p1, p2, p3].sort());
    expect(positions.find((position) => position.productId === p1)).toEqual({
      productId: p1,
      onHand: 50,
      reserved: 5,
      dispensedQuantity: 10,
      // PO1 has 30 open and PO2 has 15 open; the received, cancelled, draft-at-B and fully received lines add nothing.
      inboundQuantity: 45,
      // Site A's latest receipt (GR-R-C, 2026-09-20) names S1; the later receipt at B does not override it.
      supplierId: s1,
    });
  });

  it("takes the supplier from the latest receipt at the site, else at any site, else none", async () => {
    const { positions } = await repository.replenishmentInputs({ siteId: siteA, windowStart, now });
    const byProduct = (productId: string) => positions.find((position) => position.productId === productId);

    // p2 has no receipt at A: the latest receipt at any site (B, 2026-10-01, S3) is used.
    expect(byProduct(p2)).toEqual({
      productId: p2,
      onHand: 0,
      reserved: 0,
      dispensedQuantity: 3,
      inboundQuantity: 0,
      supplierId: s3,
    });
    // p3 has no receipt anywhere.
    expect(byProduct(p3)).toEqual({
      productId: p3,
      onHand: 3,
      reserved: 0,
      dispensedQuantity: 0,
      inboundQuantity: 12,
      supplierId: null,
    });
  });

  it("returns the first-receipt lead times of the last 12 months, per order and supplier", async () => {
    const { leadTimeSamples } = await repository.replenishmentInputs({ siteId: siteA, windowStart, now });

    // PO1: first receipt 2026-09-10 (9 days after 09-01). PO2: 09-20 (18 days). PO3: 2026-08-01 (61 days after 06-01).
    // PO5 was received in 2025, before the history; PO6 was received before its creation; PO4 has no receipt.
    const days = leadTimeSamples.map((sample) => [sample.supplierId, sample.days] as const).sort((a, b) => a[1] - b[1]);
    expect(days).toEqual([
      [s1, 9],
      [s1, 18],
      [s1, 61],
    ]);
  });

  it("answers no position for a site with no stock, no dispense and no order, but keeps the supplier lead times", async () => {
    const empty = await repository.replenishmentInputs({ siteId: idOf(0xdd), windowStart, now });
    const other = await repository.replenishmentInputs({ siteId: idOf(0xde), windowStart, now });

    expect(empty.positions).toEqual([]);
    // A supplier's lead time is observed across every site, so it does not depend on the site asked about.
    expect(empty.leadTimeSamples).toEqual(other.leadTimeSamples);
  });
});

/**
 * Draft orders for several suppliers are one transaction: a failing line in a later order leaves no order behind,
 * and every order is a Draft with its own number.
 */
describe("ProcurementRepository batch purchase orders", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const repository = new ProcurementRepository({ db, pool: undefined } as unknown as InventoryDatabase);

  beforeAll(async () => {
    await migrate(db, { migrationsFolder });
  });

  afterAll(async () => {
    await client.close();
  });

  it("creates every order as a Draft, each with its own number", async () => {
    const created = await repository.createPurchaseOrders([
      {
        supplierId: s1,
        siteId: siteA,
        createdBy: actor,
        notes: "first",
        lines: [{ productId: p1, orderedQuantity: 5 }],
      },
      {
        supplierId: s2,
        siteId: siteA,
        createdBy: actor,
        notes: "second",
        lines: [
          { productId: p1, orderedQuantity: 7 },
          { productId: p3, orderedQuantity: 1 },
        ],
      },
    ]);

    expect(created.map((order) => [order.supplierId, order.status, order.lines.length])).toEqual([
      [s1, "Draft", 1],
      [s2, "Draft", 2],
    ]);
    const numbers = created.map((order) => order.purchaseOrderNumber);
    expect(new Set(numbers).size).toBe(2);
    for (const number of numbers) expect(number).toMatch(/^PO-\d{14}-\d{2}-\d{3}$/);
    const stored = await db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.siteId, siteA));
    expect(stored).toHaveLength(2);
  });

  it("writes no order when a later order in the batch fails", async () => {
    await expect(
      repository.createPurchaseOrders([
        { supplierId: s3, siteId: siteA, createdBy: actor, lines: [{ productId: p1, orderedQuantity: 4 }] },
        { supplierId: s4, siteId: siteA, createdBy: actor, lines: [{ productId: "not-a-uuid", orderedQuantity: 4 }] },
      ]),
    ).rejects.toThrow();

    const stored = await db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.supplierId, s3));
    expect(stored).toHaveLength(0);
  });

  it("keeps the single-order path writing one order with its own number", async () => {
    const order = await repository.createPurchaseOrder({
      supplierId: s5,
      siteId: siteA,
      createdBy: actor,
      lines: [{ productId: p1, orderedQuantity: 2 }],
    });

    expect(order.purchaseOrderNumber).toMatch(/^PO-\d{14}-\d{3}$/);
    expect(order.status).toBe("Draft");
    expect(order.lines).toHaveLength(1);
  });
});
