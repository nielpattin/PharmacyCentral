import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { InventoryDatabase } from "../shared/infrastructure/database.ts";
import * as schema from "../shared/infrastructure/schema.ts";
import { InventoryRepository } from "./inventory-repository.ts";

const migrationsFolder = fileURLToPath(new URL("../../drizzle/migrations", import.meta.url));
const idOf = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

/** The expiry alerts of the automatic action plans: one row per (site, batch) with stock, through a cut-off day. */
describe("InventoryRepository expiring batches", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const repository = new InventoryRepository({ db, pool: undefined } as unknown as InventoryDatabase);
  const siteA = idOf(0xa);
  const siteB = idOf(0xb);
  const product = idOf(0x2a);

  beforeAll(async () => {
    await migrate(db, { migrationsFolder });
    await db.insert(schema.productBatches).values([
      { id: idOf(0x10), productId: product, batchNumber: "EXPIRED", expiryDate: "2026-09-01" },
      { id: idOf(0x11), productId: product, batchNumber: "EDGE", expiryDate: "2026-11-28" },
      { id: idOf(0x12), productId: product, batchNumber: "LATE", expiryDate: "2026-11-29" },
      { id: idOf(0x13), productId: product, batchNumber: "EMPTY", expiryDate: "2026-10-30" },
    ]);
    await db.insert(schema.inventoryBalances).values([
      { productBatchId: idOf(0x10), siteId: siteA, storageLocationId: idOf(0x1a), quantityOnHand: "3" },
      // Two locations of one batch at one site make one row; the same batch at another site is its own row.
      { productBatchId: idOf(0x11), siteId: siteA, storageLocationId: idOf(0x1a), quantityOnHand: "4" },
      { productBatchId: idOf(0x11), siteId: siteA, storageLocationId: idOf(0x1b), quantityOnHand: "1" },
      { productBatchId: idOf(0x11), siteId: siteB, storageLocationId: idOf(0x1c), quantityOnHand: "2" },
      { productBatchId: idOf(0x12), siteId: siteA, storageLocationId: idOf(0x1a), quantityOnHand: "9" },
      { productBatchId: idOf(0x13), siteId: siteA, storageLocationId: idOf(0x1a), quantityOnHand: "0" },
    ]);
  });
  afterAll(async () => {
    await client.close();
  });

  it("returns the expired and expiring batches with stock, summed over locations, through the cut-off day inclusive", async () => {
    const rows = await repository.expiringBatches("2026-11-28");

    expect(rows.map((row) => [row.siteId, row.batchNumber, row.quantityOnHand])).toEqual([
      [siteA, "EXPIRED", 3],
      [siteA, "EDGE", 5],
      [siteB, "EDGE", 2],
    ]);
    expect(rows[0]).toMatchObject({ batchId: idOf(0x10), productId: product, expiryDate: "2026-09-01" });
  });
});
