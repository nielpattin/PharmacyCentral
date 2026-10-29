import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

import type { InventoryDatabase } from "../shared/infrastructure/database.ts";
import * as schema from "../shared/infrastructure/schema.ts";
import { ProcurementRepository } from "./procurement-repository.ts";

const migrationsFolder = fileURLToPath(new URL("../../drizzle/migrations", import.meta.url));
const idOf = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

/** A receipt line keeps the cost it was recorded with; a line recorded without one keeps null, never zero. */
describe("ProcurementRepository receipt unit cost", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const repository = new ProcurementRepository({ db, pool: undefined } as unknown as InventoryDatabase);

  const receipt = (number: string, lines: Array<{ batchNumber: string; unitCost?: number | null }>) => ({
    receiptNumber: number,
    supplierId: idOf(0x4a),
    siteId: idOf(0xa),
    storageLocationId: idOf(0x1a),
    receivedAt: new Date("2026-10-20T00:00:00Z"),
    createdBy: idOf(0x9),
    lines: lines.map((line) => ({
      productId: idOf(0x2a),
      batchNumber: line.batchNumber,
      expiryDate: "2027-06-01",
      quantity: 10,
      ...(line.unitCost === undefined ? {} : { unitCost: line.unitCost }),
    })),
  });

  beforeAll(async () => {
    await migrate(db, { migrationsFolder });
  });

  it("returns the recorded cost as a number, and null for a line recorded without one", async () => {
    const created = await repository.createReceipt(
      receipt("GR-COST", [
        { batchNumber: "A", unitCost: 1234.5 },
        { batchNumber: "B" },
        { batchNumber: "C", unitCost: null },
        { batchNumber: "D", unitCost: 0 },
      ]),
    );
    const costs = Object.fromEntries(created.lines.map((line) => [line.batchNumber, line.unitCost]));
    expect(costs).toEqual({ A: 1234.5, B: null, C: null, D: 0 });

    const fetched = await repository.getReceipt(created.id);
    expect(Object.fromEntries((fetched?.lines ?? []).map((line) => [line.batchNumber, line.unitCost]))).toEqual(costs);
    const listed = (await repository.listReceipts()).rows.find((row) => row.id === created.id);
    expect(listed?.lines.map((line) => line.unitCost).sort()).toEqual([0, 1234.5, null, null].sort());
  });

  it("refuses a negative cost at the database, whatever a caller sends", async () => {
    await expect(repository.createReceipt(receipt("GR-NEG", [{ batchNumber: "N", unitCost: -1 }]))).rejects.toThrow();
  });
});
