import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { InventoryDatabase } from "../shared/infrastructure/database.ts";
import * as schema from "../shared/infrastructure/schema.ts";
import { InventoryRepository } from "./inventory-repository.ts";
import type { TransferPosition } from "./transfer-suggestions.ts";

const migrationsFolder = fileURLToPath(new URL("../../drizzle/migrations", import.meta.url));

/**
 * The transfer suggestions read the sellable shelf and the sales ledger in one statement. Only the real engine shows
 * that a rejected or expired batch is left out, that reserved stock is subtracted, that a movement outside the window
 * does not count, and that a site which sold with nothing left still gets a row.
 */
describe("InventoryRepository transfer positions", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const repository = new InventoryRepository({ db, pool: undefined } as unknown as InventoryDatabase);

  const siteA = "00000000-0000-4000-8000-00000000000a";
  const siteB = "00000000-0000-4000-8000-00000000000b";
  const siteC = "00000000-0000-4000-8000-00000000000c";
  const siteD = "00000000-0000-4000-8000-00000000000d";
  const location = "00000000-0000-4000-8000-00000000001a";
  const product = "00000000-0000-4000-8000-00000000002a";
  const otherProduct = "00000000-0000-4000-8000-00000000002b";
  const idOf = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
  const today = "2026-10-28";
  const windowStart = new Date("2026-10-01T00:00:00Z");

  const batch = (id: string, productId: string, expiryDate: string, qualityStatus = "Released") => ({
    id,
    productId,
    batchNumber: id.slice(-6),
    expiryDate,
    qualityStatus,
  });

  const balance = (productBatchId: string, siteId: string, quantityOnHand: string, quantityReserved = "0") => ({
    productBatchId,
    siteId,
    storageLocationId: location,
    quantityOnHand,
    quantityReserved,
  });

  const movement = (siteId: string, productId: string, productBatchId: string, delta: string, occurredAt: string) => ({
    productId,
    productBatchId,
    siteId,
    storageLocationId: location,
    quantityDelta: delta,
    quantityAfter: "0",
    movementType: "Dispense",
    occurredAt: new Date(occurredAt),
  });

  beforeAll(async () => {
    await migrate(db, { migrationsFolder });
    await db
      .insert(schema.productBatches)
      .values([
        batch(idOf(0x10), product, "2026-12-31"),
        batch(idOf(0x11), product, "2026-10-27"),
        batch(idOf(0x12), product, "2026-12-31", "Rejected"),
        batch(idOf(0x13), product, "2026-11-30"),
        batch(idOf(0x14), otherProduct, "2027-01-31"),
        batch(idOf(0x15), product, today),
      ]);
    await db
      .insert(schema.inventoryBalances)
      .values([
        balance(idOf(0x10), siteA, "100", "10"),
        balance(idOf(0x11), siteA, "50"),
        balance(idOf(0x12), siteA, "40"),
        balance(idOf(0x13), siteC, "0"),
        balance(idOf(0x14), siteB, "20"),
        balance(idOf(0x15), siteD, "5"),
      ]);
    await db
      .insert(schema.stockLedgerEntries)
      .values([
        movement(siteA, product, idOf(0x10), "-30", "2026-10-10T09:00:00Z"),
        movement(siteC, product, idOf(0x13), "-7", "2026-10-12T09:00:00Z"),
        movement(siteB, otherProduct, idOf(0x14), "-5", "2026-09-10T09:00:00Z"),
      ]);
  });

  afterAll(async () => {
    await client.close();
  });

  const rowFor = (rows: TransferPosition[], siteId: string) =>
    rows.find((row) => row.siteId === siteId && row.productId === product);

  it("counts released, unexpired stock minus what is reserved, and the sales inside the window", async () => {
    const rows = await repository.transferPositions({ windowStart, today });

    expect(rowFor(rows, siteA)).toEqual({
      productId: product,
      siteId: siteA,
      available: 90,
      dispensedQuantity: 30,
      earliestExpiry: "2026-12-31",
    });
  });

  it("keeps a batch expiring today sellable and leaves every expired or rejected batch out", async () => {
    const rows = await repository.transferPositions({ windowStart, today });

    expect(rowFor(rows, siteD)).toMatchObject({ available: 5, earliestExpiry: today });
    expect(rows.filter((row) => row.productId === product && row.siteId === siteA)).toHaveLength(1);
  });

  it("returns a site that sold in the window with no sellable stock left, with no expiry", async () => {
    const rows = await repository.transferPositions({ windowStart, today });

    expect(rowFor(rows, siteC)).toEqual({
      productId: product,
      siteId: siteC,
      available: 0,
      dispensedQuantity: 7,
      earliestExpiry: null,
    });
  });

  it("ignores a movement before the window", async () => {
    const rows = await repository.transferPositions({ windowStart, today });

    expect(rows.find((row) => row.siteId === siteB && row.productId === otherProduct)).toMatchObject({
      available: 20,
      dispensedQuantity: 0,
    });
  });

  it("answers only the sites in scope", async () => {
    const rows = await repository.transferPositions({ siteIds: [siteA], windowStart, today });

    expect(rows.map((row) => row.siteId)).toEqual([siteA]);
  });
});
