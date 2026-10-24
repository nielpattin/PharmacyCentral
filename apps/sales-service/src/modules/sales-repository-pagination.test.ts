import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SalesDatabase } from "../shared/infrastructure/database.ts";
import * as schema from "../shared/infrastructure/schema.ts";
import { decodeCursor, type Page, type PageCursor } from "../shared/page-cursor.ts";
import { SalesRepository } from "./sales-repository.ts";

const migrationsFolder = fileURLToPath(new URL("../../drizzle/migrations", import.meta.url));

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const site = uuid(0x5100);
const location = uuid(0x1000);
const actor = uuid(0xac70);
const customer = uuid(0xc057);
const store = uuid(0x5704e);

const instant = (text: string) => sql`${text}::timestamptz`;

/** Follows `X-Next-Cursor` from the first page to the last, the way a client does. */
const walk = async <T extends { id: string }>(
  fetchPage: (after: PageCursor | undefined) => Promise<Page<T>>,
): Promise<T[]> => {
  const collected: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetchPage(cursor ? decodeCursor(cursor) : undefined);
    collected.push(...page.rows);
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return collected;
};

/**
 * Pagination is verified against the real migrations and a real Postgres engine. The fixtures share instants, and two
 * sit a microsecond apart inside one millisecond, which is exactly where a millisecond cursor would skip or repeat rows.
 */
describe("SalesRepository paged lists", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const repository = new SalesRepository({ db, pool: undefined } as unknown as SalesDatabase);

  // Newest first by (createdAt, id). The two rows that share an instant are ordered by their ids, newest id first.
  const orderIds = { first: uuid(1), tieA: uuid(2), tieB: uuid(3), fourth: uuid(4), oldest: uuid(5) };
  const expectedOrders = [orderIds.first, orderIds.tieB, orderIds.tieA, orderIds.fourth, orderIds.oldest];

  const rx = { first: uuid(0x21), tieA: uuid(0x22), tieB: uuid(0x23), fourth: uuid(0x24) };
  const expectedPrescriptions = [rx.first, rx.tieB, rx.tieA, rx.fourth];

  beforeAll(async () => {
    await migrate(db, { migrationsFolder });

    await db.insert(schema.orders).values([
      {
        id: orderIds.first,
        customerId: customer,
        selectedStoreId: store,
        fulfillmentType: "pickup",
        subtotal: "100",
        status: "Pending",
        createdAt: instant("2026-10-08T07:00:00.123456Z"),
      },
      {
        id: orderIds.tieA,
        customerId: customer,
        selectedStoreId: store,
        fulfillmentType: "pickup",
        subtotal: "100",
        status: "Confirmed",
        createdAt: instant("2026-10-08T07:00:00.123400Z"),
      },
      {
        id: orderIds.tieB,
        customerId: customer,
        selectedStoreId: store,
        fulfillmentType: "pickup",
        subtotal: "100",
        status: "Pending",
        createdAt: instant("2026-10-08T07:00:00.123400Z"),
      },
      {
        id: orderIds.fourth,
        customerId: customer,
        selectedStoreId: store,
        fulfillmentType: "delivery",
        subtotal: "100",
        status: "Pending",
        createdAt: instant("2026-10-08T07:00:00.123000Z"),
      },
      {
        id: orderIds.oldest,
        customerId: customer,
        selectedStoreId: store,
        fulfillmentType: "pickup",
        subtotal: "100",
        status: "Pending",
        createdAt: instant("2026-10-08T06:00:00.000000Z"),
      },
    ]);

    await db.insert(schema.prescriptions).values([
      {
        id: rx.first,
        prescriptionNumber: "RX-20261008-001",
        siteId: site,
        storageLocationId: location,
        patientName: "Nguyễn Thị Lê",
        patientPhone: "0909111222",
        status: "Pending",
        createdBy: actor,
        createdAt: instant("2026-10-08T07:00:00.123456Z"),
      },
      {
        id: rx.tieA,
        prescriptionNumber: "RX-20261008-002",
        siteId: site,
        storageLocationId: location,
        patientName: "Trần Văn An",
        patientPhone: "0912333444",
        status: "Pending",
        createdBy: actor,
        createdAt: instant("2026-10-08T07:00:00.123400Z"),
      },
      {
        id: rx.tieB,
        prescriptionNumber: "RX-20261008-003",
        siteId: site,
        storageLocationId: location,
        patientName: "Lê Hoàng",
        patientPhone: null,
        status: "Pending",
        createdBy: actor,
        createdAt: instant("2026-10-08T07:00:00.123400Z"),
      },
      {
        id: rx.fourth,
        prescriptionNumber: "RX-20261008-004",
        siteId: site,
        storageLocationId: location,
        patientName: "Phạm Thu",
        patientPhone: "0988000111",
        status: "Cancelled",
        createdBy: actor,
        createdAt: instant("2026-10-08T07:00:00.123000Z"),
      },
    ]);

    await db.insert(schema.prescriptionLines).values([
      { prescriptionId: rx.first, productId: uuid(0x31), productUnitId: uuid(0x41), prescribedQuantity: "2" },
      { prescriptionId: rx.first, productId: uuid(0x32), productUnitId: uuid(0x42), prescribedQuantity: "3" },
      { prescriptionId: rx.tieA, productId: uuid(0x33), productUnitId: uuid(0x43), prescribedQuantity: "1" },
      { prescriptionId: rx.fourth, productId: uuid(0x34), productUnitId: uuid(0x44), prescribedQuantity: "5" },
    ]);
  });

  afterAll(async () => {
    await client.close();
  });

  it("walks every order once at any page size, newest first, across shared instants", async () => {
    for (const limit of [1, 2, 3, 4, 5, 10]) {
      const ids = (await walk((after) => repository.listOrders({ customerId: undefined, limit, after }))).map(
        (order) => order.id,
      );
      expect(ids).toEqual(expectedOrders);
    }
  });

  it("answers the last page with no cursor and a page that fills the list without one", async () => {
    const exact = await repository.listOrders({ limit: 5 });
    expect(exact.rows).toHaveLength(5);
    expect(exact.nextCursor).toBeUndefined();

    const partial = await repository.listOrders({ limit: 2 });
    expect(partial.rows.map((order) => order.id)).toEqual(expectedOrders.slice(0, 2));
    expect(partial.nextCursor).toBeDefined();
  });

  it("filters orders by status and by the order id, and keeps the cursor inside the filter", async () => {
    const pending = await walk((after) => repository.listOrders({ status: "Pending", limit: 1, after }));
    expect(pending.map((order) => order.id)).toEqual([orderIds.first, orderIds.tieB, orderIds.fourth, orderIds.oldest]);

    const byId = await repository.listOrders({ q: uuid(4), limit: 10 });
    expect(byId.rows.map((order) => order.id)).toEqual([orderIds.fourth]);
    // `%` is a literal here, so it does not turn the search into a match-all.
    expect((await repository.listOrders({ q: "%", limit: 10 })).rows).toEqual([]);
  });

  it("walks prescriptions once in order and attaches each prescription's own lines", async () => {
    const pages = await walk((after) => repository.listPrescriptions({ siteIds: [site], limit: 1, after }));

    expect(pages.map((row) => row.id)).toEqual(expectedPrescriptions);
    const linesById = new Map(pages.map((row) => [row.id, row.lines.length]));
    expect(linesById.get(rx.first)).toBe(2);
    expect(linesById.get(rx.tieB)).toBe(0);
    expect(linesById.get(rx.tieA)).toBe(1);
    expect(linesById.get(rx.fourth)).toBe(1);
    expect(
      pages
        .find((row) => row.id === rx.first)
        ?.lines.map((line) => line.productId)
        .sort(),
    ).toEqual([uuid(0x31), uuid(0x32)].sort());
  });

  it("searches prescriptions by number, patient name and phone, with the cursor working inside the search", async () => {
    expect(
      (await repository.listPrescriptions({ siteIds: [site], q: "RX-20261008-003", limit: 10 })).rows.map(
        (row) => row.id,
      ),
    ).toEqual([rx.tieB]);
    expect(
      (await repository.listPrescriptions({ siteIds: [site], q: "0909", limit: 10 })).rows.map((row) => row.id),
    ).toEqual([rx.first]);
    // Case-insensitive, and it finds both patients whose name carries "lê".
    expect(
      (await repository.listPrescriptions({ siteIds: [site], q: "lê", limit: 10 })).rows.map((row) => row.id),
    ).toEqual([rx.first, rx.tieB]);
    const paged = await walk((after) => repository.listPrescriptions({ siteIds: [site], q: "lê", limit: 1, after }));
    expect(paged.map((row) => row.id)).toEqual([rx.first, rx.tieB]);
    expect((await repository.listPrescriptions({ siteIds: [site], q: "%", limit: 10 })).rows).toEqual([]);
  });

  it("counts with the list's own filters, so the count and the list describe the same rows", async () => {
    expect(await repository.countPrescriptions({ siteIds: [site] })).toBe(4);
    expect(await repository.countPrescriptions({ siteIds: [site], excludeStatuses: ["Dispensed", "Cancelled"] })).toBe(
      3,
    );
    expect(await repository.countPrescriptions({ siteIds: [site], status: "Pending" })).toBe(3);
    expect(
      await repository.countPrescriptions({ siteIds: [site], status: "Pending", excludeStatuses: ["Cancelled"] }),
    ).toBe(3);
    // A site outside the scope is never counted, and an empty scope answers zero rather than everything.
    expect(await repository.countPrescriptions({ siteIds: [uuid(0x9999)] })).toBe(0);
    expect(await repository.countPrescriptions({ siteIds: [] })).toBe(0);
  });

  it("answers the counter with the same rows as the prescription list, under the same scope", async () => {
    const counter = await repository.listCounterTransactions({ siteIds: [site], limit: 10 });
    const register = await repository.listPrescriptions({ siteIds: [site], limit: 10 });
    expect(counter.rows.map((row) => row.id)).toEqual(register.rows.map((row) => row.id));

    const empty = await repository.listPrescriptions({ siteIds: [], limit: 10 });
    expect(empty).toEqual({ rows: [], nextCursor: undefined });
  });
});
