import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { SalesDatabase } from "../shared/infrastructure/database.ts";
import * as schema from "../shared/infrastructure/schema.ts";
import { PrescriptionDispenseError, SalesRepository, type PrescriptionStockDispense } from "./sales-repository.ts";

const migrationsFolder = fileURLToPath(new URL("../../drizzle/migrations", import.meta.url));

/**
 * A dispense is recorded only together with the stock leaving the shelf: inventory is asked inside the transaction,
 * so its refusal must leave the prescription exactly as it was, and a dispense the prescription cannot take must
 * never reach inventory at all.
 */
describe("SalesRepository prescription dispense", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const repository = new SalesRepository({ db, pool: undefined } as unknown as SalesDatabase);

  const site = "00000000-0000-4000-8000-00000000000a";
  const location = "00000000-0000-4000-8000-00000000001a";
  const actor = "00000000-0000-4000-8000-00000000002a";
  const prescription = "00000000-0000-4000-8000-00000000003a";
  const reservation = "00000000-0000-4000-8000-00000000004a";
  const line = "00000000-0000-4000-8000-00000000005a";
  const product = "00000000-0000-4000-8000-00000000006a";
  const unit = "00000000-0000-4000-8000-00000000007a";
  const batch = "00000000-0000-4000-8000-00000000008a";

  const dispensed = async () => {
    const [row] = await db.select().from(schema.prescriptionLines).where(eq(schema.prescriptionLines.id, line));
    const [header] = await db.select().from(schema.prescriptions).where(eq(schema.prescriptions.id, prescription));
    return { quantity: Number(row?.dispensedQuantity), status: header?.status };
  };

  beforeAll(async () => {
    await migrate(db, { migrationsFolder });
  });

  beforeEach(async () => {
    await client.exec("TRUNCATE prescriptions, prescription_lines, outbox_messages, sales_idempotency_records;");
    await db.insert(schema.prescriptions).values({
      id: prescription,
      prescriptionNumber: "RX-1",
      siteId: site,
      storageLocationId: location,
      patientName: "Nguyễn Thị B",
      status: "Pending",
      reservationId: reservation,
      createdBy: actor,
    });
    await db.insert(schema.prescriptionLines).values({
      id: line,
      prescriptionId: prescription,
      productId: product,
      productUnitId: unit,
      prescribedQuantity: "5",
    });
  });

  afterAll(async () => {
    await client.close();
  });

  it("hands inventory the goods of the prescribed product and records the partial dispense", async () => {
    const dispenseStock = vi.fn<(dispense: PrescriptionStockDispense) => Promise<void>>().mockResolvedValue();

    await repository.dispensePrescription(
      prescription,
      [{ prescriptionLineId: line, productBatchId: batch, dispensedQuantity: 2 }],
      actor,
      dispenseStock,
    );

    expect(dispenseStock).toHaveBeenCalledWith({
      prescriptionId: prescription,
      reservationId: reservation,
      siteId: site,
      storageLocationId: location,
      lines: [{ productId: product, productBatchId: batch, quantity: 2 }],
    });
    await expect(dispensed()).resolves.toEqual({ quantity: 2, status: "PartiallyDispensed" });
  });

  it("records nothing when inventory refuses the goods", async () => {
    const refusal = new Error("Batch has expired");

    await expect(
      repository.dispensePrescription(
        prescription,
        [{ prescriptionLineId: line, productBatchId: batch, dispensedQuantity: 2 }],
        actor,
        async () => {
          throw refusal;
        },
      ),
    ).rejects.toBe(refusal);

    await expect(dispensed()).resolves.toEqual({ quantity: 0, status: "Pending" });
    await expect(db.select().from(schema.outboxMessages)).resolves.toHaveLength(0);
  });

  it("refuses two entries that together exceed the prescribed quantity before stock moves", async () => {
    const dispenseStock = vi.fn<(dispense: PrescriptionStockDispense) => Promise<void>>();

    await expect(
      repository.dispensePrescription(
        prescription,
        [
          { prescriptionLineId: line, productBatchId: batch, dispensedQuantity: 3 },
          { prescriptionLineId: line, productBatchId: batch, dispensedQuantity: 3 },
        ],
        actor,
        dispenseStock,
      ),
    ).rejects.toBeInstanceOf(PrescriptionDispenseError);

    expect(dispenseStock).not.toHaveBeenCalled();
    await expect(dispensed()).resolves.toEqual({ quantity: 0, status: "Pending" });
  });
});
