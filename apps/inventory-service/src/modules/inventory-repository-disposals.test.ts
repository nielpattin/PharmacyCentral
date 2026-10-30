import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { InventoryDatabase } from "../shared/infrastructure/database.ts";
import * as schema from "../shared/infrastructure/schema.ts";
import { BusinessRuleError } from "../shared/business-rule-error.ts";
import { InventoryRepository } from "./inventory-repository.ts";

const migrationsFolder = fileURLToPath(new URL("../../drizzle/migrations", import.meta.url));
const idOf = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const site = idOf(0xa);
const location = idOf(0x1a);
const product = idOf(0x2a);
const batchA = idOf(0x10);
const batchB = idOf(0x11);
const creator = idOf(0x01);
const manager = idOf(0x02);

/** Disposal records: a proposal never moves stock, and only an approval takes the named batches off the shelf. */
describe("InventoryRepository disposals", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const repository = new InventoryRepository({ db, pool: undefined } as unknown as InventoryDatabase);

  const balanceOf = async (batchId: string) =>
    (await db.select().from(schema.inventoryBalances).where(eq(schema.inventoryBalances.productBatchId, batchId)))[0];

  beforeAll(async () => {
    await migrate(db, { migrationsFolder });
    await db.insert(schema.productBatches).values([
      { id: batchA, productId: product, batchNumber: "LOT-A", expiryDate: "2026-01-01" },
      { id: batchB, productId: product, batchNumber: "LOT-B", expiryDate: "2026-02-01" },
    ]);
    await db.insert(schema.inventoryBalances).values([
      {
        productBatchId: batchA,
        siteId: site,
        storageLocationId: location,
        quantityOnHand: "10",
        quantityReserved: "2",
      },
      {
        productBatchId: batchB,
        siteId: site,
        storageLocationId: location,
        quantityOnHand: "4",
        quantityReserved: "0",
      },
    ]);
  });

  afterAll(async () => {
    await client.close();
  });

  const propose = (quantityA: number, quantityB = 0) =>
    repository.createDisposal({
      siteId: site,
      reason: "Expired",
      note: "Expired stock",
      createdBy: creator,
      lines: [
        { productBatchId: batchA, storageLocationId: location, quantity: quantityA },
        ...(quantityB > 0 ? [{ productBatchId: batchB, storageLocationId: location, quantity: quantityB }] : []),
      ],
    });

  it("records a proposal and its lines without moving stock", async () => {
    const record = await propose(3, 1);

    expect(record.status).toBe("PendingApproval");
    expect(record.lines).toHaveLength(2);
    expect(record.lines.every((line) => line.productId === product)).toBe(true);
    expect(Number((await balanceOf(batchA))?.quantityOnHand)).toBe(10);
    expect(Number((await balanceOf(batchB))?.quantityOnHand)).toBe(4);
  });

  it("refuses a proposal above the available quantity, counting the reserved stock out", async () => {
    await expect(propose(9)).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it("approves a proposal by taking each batch off the shelf with a Disposal ledger entry", async () => {
    const pending = await propose(3, 1);
    const approved = await repository.transitionDisposal(pending.id, "approve", manager, "Witnessed by two staff");

    expect(approved).toMatchObject({ status: "Approved", decidedBy: manager });
    expect(Number((await balanceOf(batchA))?.quantityOnHand)).toBe(7);
    expect(Number((await balanceOf(batchB))?.quantityOnHand)).toBe(3);
    const ledger = await db
      .select()
      .from(schema.stockLedgerEntries)
      .where(eq(schema.stockLedgerEntries.referenceId, pending.id));
    expect(
      ledger.map((entry) => [entry.movementType, Number(entry.quantityDelta), Number(entry.quantityAfter)]),
    ).toEqual([
      ["Disposal", -3, 7],
      ["Disposal", -1, 3],
    ]);
    expect(ledger.every((entry) => entry.referenceType === "Disposal" && entry.reason === "Expired")).toBe(true);
  });

  it("refuses a second decision on the same record", async () => {
    const pending = await propose(1);
    await repository.transitionDisposal(pending.id, "reject", manager, "Kept for supplier return");

    await expect(repository.transitionDisposal(pending.id, "approve", manager)).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
  });

  it("rejects a proposal without changing stock", async () => {
    const before = Number((await balanceOf(batchA))?.quantityOnHand);
    const pending = await propose(2);
    const rejected = await repository.transitionDisposal(pending.id, "reject", manager);

    expect(rejected).toMatchObject({ status: "Rejected", decidedBy: manager });
    expect(Number((await balanceOf(batchA))?.quantityOnHand)).toBe(before);
    expect(
      await db.select().from(schema.stockLedgerEntries).where(eq(schema.stockLedgerEntries.referenceId, pending.id)),
    ).toEqual([]);
  });

  it("lists proposals by status and matches a batch number in the search", async () => {
    const pending = await propose(1, 1);
    const byStatus = await repository.listDisposals({ siteIds: [site], statuses: ["PendingApproval"] });
    const byNumber = await repository.listDisposals({ siteIds: [site], q: "LOT-B" });

    expect(byStatus.rows.map((row) => row.id)).toContain(pending.id);
    expect(byNumber.rows.map((row) => row.id)).toContain(pending.id);
    expect(byNumber.rows[0]?.lines.map((line) => line.productBatchId)).toEqual([batchA, batchB]);
  });
});
