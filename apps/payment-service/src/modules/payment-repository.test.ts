import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PaymentDatabase } from "../shared/infrastructure/database.ts";
import { PaymentRepository } from "./payment-repository.ts";
import { decodePageCursor, encodePageCursor, type PageCursor } from "./page-cursor.ts";
import * as schema from "./payments/infrastructure/schema.ts";

const migrationsFolder = fileURLToPath(new URL("../../drizzle/migrations", import.meta.url));

const customerA = "00000000-0000-4000-8000-0000000000c1";
const customerB = "00000000-0000-4000-8000-0000000000c2";
const orderOne = "00000000-0000-4000-8000-0000000000d1";

const id = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

/**
 * Invoices 1-3 share one createdAt, so the id orders them; invoice 4 is one microsecond newer; invoice 5 is an hour
 * older. Newest first is therefore 4, 3, 2, 1, 5.
 */
const fixtures = [
  {
    n: 1,
    code: "PC-AAAA000000000001",
    status: "Paid",
    customerId: customerA,
    orderId: orderOne,
    at: "2026-10-24T10:00:00.000000Z",
  },
  {
    n: 2,
    code: "PC-AAAA000000000002",
    status: "Pending",
    customerId: customerA,
    orderId: null,
    at: "2026-10-24T10:00:00.000000Z",
  },
  {
    n: 3,
    code: "PC-AAAA000000000003",
    status: "Paid",
    customerId: customerB,
    orderId: null,
    at: "2026-10-24T10:00:00.000000Z",
  },
  {
    n: 4,
    code: "PC-50%OFF0000000004",
    status: "Pending",
    customerId: customerB,
    orderId: null,
    at: "2026-10-24T10:00:00.000001Z",
  },
  {
    n: 5,
    code: "PC-BBBB00000000005X",
    status: "Refunded",
    customerId: customerA,
    orderId: null,
    at: "2026-10-24T09:00:00.000000Z",
  },
];

const cursorOf = (next: PageCursor | undefined): PageCursor => {
  if (!next) throw new Error("expected a next page");
  const decoded = decodePageCursor(encodePageCursor(next));
  if (!decoded) throw new Error("cursor did not round-trip");
  return decoded;
};

describe("PaymentRepository invoice list", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const repository = new PaymentRepository({ db } as unknown as PaymentDatabase);

  beforeAll(async () => {
    await migrate(db, { migrationsFolder });
    for (const fixture of fixtures) {
      await db.insert(schema.paymentInvoices).values({
        id: id(fixture.n),
        paymentCode: fixture.code,
        customerId: fixture.customerId,
        orderId: fixture.orderId,
        amount: "45000",
        status: fixture.status,
        createdAt: sql`${fixture.at}::timestamptz`,
      });
    }
  });

  afterAll(async () => {
    await client.close();
  });

  it("answers the whole list without a limit and no next page", async () => {
    const page = await repository.listInvoices({});
    expect(page.next).toBeUndefined();
    expect(page.rows.map((row) => row.id)).toStrictEqual([id(4), id(3), id(2), id(1), id(5)]);
    expect(Object.keys(page.rows[0] ?? {})).not.toContain("sortAt");
  });

  it("pages with a keyset cursor without duplicates or gaps across equal sort keys", async () => {
    const first = await repository.listInvoices({ limit: 2 });
    expect(first.rows.map((row) => row.id)).toStrictEqual([id(4), id(3)]);

    const second = await repository.listInvoices({ limit: 2, cursor: cursorOf(first.next) });
    expect(second.rows.map((row) => row.id)).toStrictEqual([id(2), id(1)]);

    const last = await repository.listInvoices({ limit: 2, cursor: cursorOf(second.next) });
    expect(last.rows.map((row) => row.id)).toStrictEqual([id(5)]);
    expect(last.next).toBeUndefined();
  });

  it("filters by status", async () => {
    const page = await repository.listInvoices({ status: "Paid" });
    expect(page.rows.map((row) => row.id)).toStrictEqual([id(3), id(1)]);
  });

  it("matches q case-insensitively over the invoice number, order id and customer id", async () => {
    expect((await repository.listInvoices({ q: "aaaa000000000002" })).rows.map((row) => row.id)).toStrictEqual([id(2)]);
    expect((await repository.listInvoices({ q: orderOne })).rows.map((row) => row.id)).toStrictEqual([id(1)]);
    expect((await repository.listInvoices({ q: customerB })).rows.map((row) => row.id)).toStrictEqual([id(4), id(3)]);
  });

  it("escapes LIKE wildcards in q so % and _ match themselves", async () => {
    expect((await repository.listInvoices({ q: "50%off" })).rows.map((row) => row.id)).toStrictEqual([id(4)]);
    expect((await repository.listInvoices({ q: "50_off" })).rows).toStrictEqual([]);
    expect((await repository.listInvoices({ q: "%" })).rows.map((row) => row.id)).toStrictEqual([id(4)]);
  });

  it("combines the customer filter, status, q and the cursor", async () => {
    const paid = await repository.listInvoices({ customerId: customerA, status: "Paid", q: "PC-AAAA", limit: 1 });
    expect(paid.rows.map((row) => row.id)).toStrictEqual([id(1)]);
    expect(paid.next).toBeUndefined();

    const scoped = await repository.listInvoices({ customerId: customerA, q: "PC-", limit: 1 });
    expect(scoped.rows.map((row) => row.id)).toStrictEqual([id(2)]);

    const rest = await repository.listInvoices({
      customerId: customerA,
      q: "PC-",
      limit: 10,
      cursor: cursorOf(scoped.next),
    });
    expect(rest.rows.map((row) => row.id)).toStrictEqual([id(1), id(5)]);
    expect(rest.next).toBeUndefined();
  });
});

/**
 * A SePay delivery can be repeated, and two deliveries of one transfer can race. The transfer is recorded once, the
 * invoice is paid once, and the repeat is answered as a duplicate with no second payment event.
 */
describe("PaymentRepository provider transactions", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const repository = new PaymentRepository({ db } as unknown as PaymentDatabase);
  const invoice = id(101);
  const code = "PC-CCCC000000000101";

  beforeAll(async () => {
    await migrate(db, { migrationsFolder });
    await db
      .insert(schema.paymentInvoices)
      .values({ id: invoice, paymentCode: code, amount: "45000", status: "Pending" });
    await db
      .insert(schema.reconciliationRecords)
      .values({ paymentInvoiceId: invoice, expectedAmount: "45000", receivedAmount: "0", state: "Open" });
  });

  afterAll(async () => {
    await client.close();
  });

  const transfer = (providerTransactionId: string, amount = 45000) =>
    repository.applyProviderTransaction({
      paymentCodes: [code],
      provider: "sepay",
      providerTransactionId,
      amount,
    });

  it("pays the invoice once and answers a repeated delivery as a duplicate", async () => {
    await expect(transfer("sepay-1")).resolves.toEqual({
      invoiceId: invoice,
      duplicate: false,
      status: "Paid",
      reason: "accepted",
    });
    await expect(transfer("sepay-1")).resolves.toEqual({
      invoiceId: invoice,
      duplicate: true,
      status: "Paid",
      reason: "duplicate_transaction",
    });

    await expect(db.select().from(schema.paymentTransactions)).resolves.toHaveLength(1);
    const events = await db
      .select()
      .from(schema.outboxMessages)
      .where(eq(schema.outboxMessages.eventType, "payment.invoice.paid.v1"));
    expect(events).toHaveLength(1);
  });

  it("settles two racing deliveries of one transfer as one payment and one duplicate", async () => {
    const racing = "00000000-0000-4000-8000-0000000000e1";
    await db
      .insert(schema.paymentInvoices)
      .values({ id: racing, paymentCode: "PC-DDDD000000000102", amount: "1000", status: "Pending" });
    await db.insert(schema.reconciliationRecords).values({ paymentInvoiceId: racing, expectedAmount: "1000" });
    const deliver = () =>
      repository.applyProviderTransaction({
        paymentCodes: ["PC-DDDD000000000102"],
        provider: "sepay",
        providerTransactionId: "sepay-race",
        amount: 1000,
      });

    const results = await Promise.all([deliver(), deliver()]);

    expect(results.filter((result) => result?.duplicate === false)).toHaveLength(1);
    expect(results.filter((result) => result?.duplicate === true)).toHaveLength(1);
    await expect(
      db.select().from(schema.paymentTransactions).where(eq(schema.paymentTransactions.paymentInvoiceId, racing)),
    ).resolves.toHaveLength(1);
  });

  it("marks the reconciliation refunded and keeps the received amount when a paid invoice is refunded", async () => {
    const refunded = await repository.refund(invoice, "Operational correction");

    expect(refunded?.status).toBe("Refunded");
    const [record] = await db
      .select()
      .from(schema.reconciliationRecords)
      .where(eq(schema.reconciliationRecords.paymentInvoiceId, invoice));
    expect(record?.state).toBe("Refunded");
    expect(Number(record?.receivedAmount)).toBe(45000);
    await expect(repository.refund(invoice, "again")).rejects.toThrow("Only paid invoices can be refunded");
  });

  it("keeps a partly refunded invoice paid and refuses more than what is left", async () => {
    const partial = "00000000-0000-4000-8000-0000000000e2";
    await db
      .insert(schema.paymentInvoices)
      .values({ id: partial, paymentCode: "PC-EEEE000000000103", amount: "1000", status: "Paid" });
    await db
      .insert(schema.reconciliationRecords)
      .values({ paymentInvoiceId: partial, expectedAmount: "1000", receivedAmount: "1000", state: "Matched" });

    const first = await repository.refund(partial, "Wrong size", undefined, 400);
    expect(first?.status).toBe("Paid");
    await expect(repository.refund(partial, "Too much", undefined, 700)).rejects.toMatchObject({
      code: "refund_exceeds_remaining",
    });
    const [record] = await db
      .select()
      .from(schema.reconciliationRecords)
      .where(eq(schema.reconciliationRecords.paymentInvoiceId, partial));
    expect(record?.state).toBe("PartiallyRefunded");

    const rest = await repository.refund(partial, "Rest");
    expect(rest?.status).toBe("Refunded");
    const events = await db.select().from(schema.outboxMessages).where(eq(schema.outboxMessages.aggregateId, partial));
    expect(events.map((event) => JSON.parse(event.payload).fullyRefunded)).toEqual([false, true]);
  });

  it("settles two racing refunds as one refund and one refusal", async () => {
    const racing = "00000000-0000-4000-8000-0000000000e3";
    await db
      .insert(schema.paymentInvoices)
      .values({ id: racing, paymentCode: "PC-FFFF000000000104", amount: "500", status: "Paid" });
    await db.insert(schema.reconciliationRecords).values({ paymentInvoiceId: racing, expectedAmount: "500" });

    const results = await Promise.allSettled([repository.refund(racing, "a"), repository.refund(racing, "b")]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    await expect(
      db.select().from(schema.paymentRefunds).where(eq(schema.paymentRefunds.paymentInvoiceId, racing)),
    ).resolves.toHaveLength(1);
  });
});
