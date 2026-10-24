import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
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
