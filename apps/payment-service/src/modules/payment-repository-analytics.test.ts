import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PaymentDatabase } from "../shared/infrastructure/database.ts";
import { PaymentRepository } from "./payment-repository.ts";
import * as schema from "./payments/infrastructure/schema.ts";

const migrationsFolder = fileURLToPath(new URL("../../drizzle/migrations", import.meta.url));

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const orderOne = uuid(0xd1);
const orderTwo = uuid(0xd2);
const orderThree = uuid(0xd3);
const orderFour = uuid(0xd4);
const prescriptionOne = uuid(0xe1);
const productOne = uuid(0xf1);
const productTwo = uuid(0xf2);

const since = new Date("2026-10-01T00:00:00.000Z");

/**
 * Six invoices: four `Paid` ones, one of them exactly at `since`, one a microsecond before it, plus a `Pending` and a
 * `Refunded` one inside the period. Only the four `Paid` invoices at or after `since` may answer.
 */
const fixtures = [
  {
    n: 1,
    status: "Paid",
    orderId: orderOne,
    prescriptionId: null,
    amount: "45000.00",
    at: "2026-10-01T00:00:00.000000Z",
  },
  {
    n: 2,
    status: "Paid",
    orderId: null,
    prescriptionId: prescriptionOne,
    amount: "120000.50",
    at: "2026-10-15T12:00:00.000000Z",
  },
  {
    n: 3,
    status: "Pending",
    orderId: orderTwo,
    prescriptionId: null,
    amount: "10000.00",
    at: "2026-10-16T09:00:00.000000Z",
  },
  {
    n: 4,
    status: "Refunded",
    orderId: orderThree,
    prescriptionId: null,
    amount: "20000.00",
    at: "2026-10-17T09:00:00.000000Z",
  },
  {
    n: 5,
    status: "Paid",
    orderId: orderFour,
    prescriptionId: null,
    amount: "30000.00",
    at: "2026-09-30T23:59:59.999999Z",
  },
  {
    n: 6,
    status: "Paid",
    orderId: orderFour,
    prescriptionId: null,
    amount: "55000.00",
    at: "2026-10-20T08:00:00.000000Z",
  },
];

describe("PaymentRepository paid invoices since", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const repository = new PaymentRepository({ db } as unknown as PaymentDatabase);

  beforeAll(async () => {
    await migrate(db, { migrationsFolder });
    for (const fixture of fixtures) {
      await db.insert(schema.paymentInvoices).values({
        id: uuid(fixture.n),
        paymentCode: `PC-ANALYTICS${fixture.n.toString().padStart(8, "0")}`,
        orderId: fixture.orderId,
        prescriptionId: fixture.prescriptionId,
        amount: fixture.amount,
        status: fixture.status,
        createdAt: sql`${fixture.at}::timestamptz`,
      });
    }
    await db.insert(schema.paymentInvoiceLines).values([
      {
        paymentInvoiceId: uuid(1),
        productId: productOne,
        productUnitId: null,
        description: "Paracetamol",
        quantity: "2",
        unitPrice: "20000.00",
        currency: "VND",
      },
      {
        paymentInvoiceId: uuid(1),
        productId: null,
        productUnitId: null,
        description: "Phí giao hàng",
        quantity: "1",
        unitPrice: "5000.00",
        currency: "VND",
      },
      {
        paymentInvoiceId: uuid(2),
        productId: productTwo,
        productUnitId: null,
        description: "Amoxicillin",
        quantity: "3",
        unitPrice: "40000.00",
        currency: "VND",
      },
    ]);
  });

  afterAll(async () => {
    await client.close();
  });

  it("answers only the Paid invoices created at or after since, oldest first, with their lines", async () => {
    const rows = await repository.listPaidInvoicesSince(since, 100);
    expect(rows.map(({ lines: _lines, ...row }) => row)).toStrictEqual([
      { orderId: orderOne, prescriptionId: null, amount: "45000.00", createdAt: new Date("2026-10-01T00:00:00.000Z") },
      {
        orderId: null,
        prescriptionId: prescriptionOne,
        amount: "120000.50",
        createdAt: new Date("2026-10-15T12:00:00.000Z"),
      },
      { orderId: orderFour, prescriptionId: null, amount: "55000.00", createdAt: new Date("2026-10-20T08:00:00.000Z") },
    ]);
    // Line ids are random, so the order inside an invoice is not the insertion order; the set is what matters.
    expect(rows[0]?.lines).toHaveLength(2);
    expect(rows[0]?.lines).toEqual(
      expect.arrayContaining([
        { productId: productOne, description: "Paracetamol", quantity: 2, unitPrice: 20000 },
        { productId: null, description: "Phí giao hàng", quantity: 1, unitPrice: 5000 },
      ]),
    );
    expect(rows[1]?.lines).toStrictEqual([
      { productId: productTwo, description: "Amoxicillin", quantity: 3, unitPrice: 40000 },
    ]);
    expect(rows[2]?.lines).toStrictEqual([]);
  });

  it("reads at most the given number of rows, so the caller can detect a range over its cap", async () => {
    const rows = await repository.listPaidInvoicesSince(since, 2);
    expect(rows.map((row) => row.amount)).toStrictEqual(["45000.00", "120000.50"]);
  });
});
