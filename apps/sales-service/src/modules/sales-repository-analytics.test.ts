import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SalesDatabase } from "../shared/infrastructure/database.ts";
import * as schema from "../shared/infrastructure/schema.ts";
import { SalesRepository } from "./sales-repository.ts";

const migrationsFolder = fileURLToPath(new URL("../../drizzle/migrations", import.meta.url));

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const siteA = uuid(0x5a);
const siteB = uuid(0x5b);
const siteC = uuid(0x5c);
const location = uuid(0x1000);
const actor = uuid(0xac70);
const customer = uuid(0xc057);
const returningCustomer = uuid(0xc058);
const instant = (text: string) => sql`${text}::timestamptz`;

const from = new Date("2026-10-01T00:00:00.000Z");
const to = new Date("2026-11-01T00:00:00.000Z");

/**
 * Runs against the real migrations and a real Postgres engine. The fixtures sit exactly on both bounds and one
 * microsecond outside them, which is where an off-by-one in `[from, to)` would show.
 */
describe("SalesRepository sales documents", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const repository = new SalesRepository({ db, pool: undefined } as unknown as SalesDatabase);

  const orderIds = {
    atFrom: uuid(1),
    inSiteA: uuid(2),
    inSiteB: uuid(3),
    atTo: uuid(4),
    justBeforeFrom: uuid(5),
    newCustomer: uuid(6),
  };
  const prescriptionIds = { inSiteA: uuid(0x21), inSiteB: uuid(0x22), inSiteC: uuid(0x23), atTo: uuid(0x24) };

  beforeAll(async () => {
    await migrate(db, { migrationsFolder });
    await db.insert(schema.orders).values([
      {
        id: orderIds.atFrom,
        customerId: customer,
        fulfillmentType: "pickup",
        selectedStoreId: siteA,
        subtotal: "100000",
        createdAt: instant("2026-10-01T00:00:00.000000Z"),
      },
      {
        id: orderIds.inSiteA,
        customerId: customer,
        fulfillmentType: "delivery",
        selectedStoreId: siteA,
        subtotal: "200000",
        createdAt: instant("2026-10-15T12:00:00.000000Z"),
      },
      {
        id: orderIds.inSiteB,
        customerId: customer,
        fulfillmentType: "pickup",
        selectedStoreId: siteB,
        subtotal: "300000",
        createdAt: instant("2026-10-20T08:00:00.000000Z"),
      },
      {
        id: orderIds.atTo,
        customerId: customer,
        fulfillmentType: "pickup",
        selectedStoreId: siteA,
        subtotal: "400000",
        createdAt: instant("2026-11-01T00:00:00.000000Z"),
      },
      {
        id: orderIds.justBeforeFrom,
        customerId: customer,
        fulfillmentType: "pickup",
        selectedStoreId: siteA,
        subtotal: "500000",
        createdAt: instant("2026-09-30T23:59:59.999999Z"),
        paidAt: instant("2026-09-15T00:00:00.000000Z"),
      },
      {
        id: orderIds.newCustomer,
        customerId: returningCustomer,
        fulfillmentType: "pickup",
        selectedStoreId: siteA,
        subtotal: "600000",
        createdAt: instant("2026-10-25T08:00:00.000000Z"),
        paidAt: instant("2026-10-26T00:00:00.000000Z"),
      },
    ]);
    await db.insert(schema.prescriptions).values([
      {
        id: prescriptionIds.inSiteA,
        prescriptionNumber: "RX-A",
        siteId: siteA,
        storageLocationId: location,
        patientName: "Nguyễn Thị A",
        customerId: customer,
        createdBy: actor,
        createdAt: instant("2026-10-02T09:00:00.000000Z"),
      },
      {
        id: prescriptionIds.inSiteB,
        prescriptionNumber: "RX-B",
        siteId: siteB,
        storageLocationId: location,
        patientName: "Trần Văn B",
        createdBy: actor,
        createdAt: instant("2026-10-03T09:00:00.000000Z"),
      },
      {
        id: prescriptionIds.inSiteC,
        prescriptionNumber: "RX-C",
        siteId: siteC,
        storageLocationId: location,
        patientName: "Lê Thị C",
        createdBy: actor,
        createdAt: instant("2026-10-04T09:00:00.000000Z"),
      },
      {
        id: prescriptionIds.atTo,
        prescriptionNumber: "RX-D",
        siteId: siteA,
        storageLocationId: location,
        patientName: "Phạm Văn D",
        createdBy: actor,
        createdAt: instant("2026-11-01T00:00:00.000000Z"),
      },
    ]);
  });

  afterAll(async () => {
    await client.close();
  });

  const idsOf = async (siteIds?: string[]): Promise<string[]> =>
    (await repository.listSalesDocuments({ from, to, siteIds })).map((document) => document.id).sort();

  it("answers every order and counter prescription created in [from, to) when no site scope is given", async () => {
    await expect(idsOf()).resolves.toEqual(
      [
        orderIds.atFrom,
        orderIds.inSiteA,
        orderIds.inSiteB,
        orderIds.newCustomer,
        prescriptionIds.inSiteA,
        prescriptionIds.inSiteB,
        prescriptionIds.inSiteC,
      ].sort(),
    );
  });

  it("includes a document created exactly at from and excludes one created exactly at to", async () => {
    const ids = await idsOf();
    expect(ids).toContain(orderIds.atFrom);
    expect(ids).not.toContain(orderIds.atTo);
    expect(ids).not.toContain(orderIds.justBeforeFrom);
    expect(ids).not.toContain(prescriptionIds.atTo);
  });

  it("narrows both orders and prescriptions to the sites in the scope", async () => {
    await expect(idsOf([siteA])).resolves.toEqual(
      [orderIds.atFrom, orderIds.inSiteA, orderIds.newCustomer, prescriptionIds.inSiteA].sort(),
    );
    await expect(idsOf([siteB])).resolves.toEqual([orderIds.inSiteB, prescriptionIds.inSiteB].sort());
  });

  it("answers nothing for an empty site scope", async () => {
    await expect(idsOf([])).resolves.toEqual([]);
  });

  it("answers the first payment ever for each customer who bought in the period, ignoring the site of that payment", async () => {
    await expect(repository.listCustomerFirstPaid({ from, to })).resolves.toStrictEqual([
      { customerId: customer, firstPaidAt: "2026-09-15T00:00:00.000Z" },
      { customerId: returningCustomer, firstPaidAt: "2026-10-26T00:00:00.000Z" },
    ]);
    await expect(repository.listCustomerFirstPaid({ from, to, siteIds: [siteA] })).resolves.toStrictEqual([
      { customerId: customer, firstPaidAt: "2026-09-15T00:00:00.000Z" },
      { customerId: returningCustomer, firstPaidAt: "2026-10-26T00:00:00.000Z" },
    ]);
    await expect(repository.listCustomerFirstPaid({ from, to, siteIds: [] })).resolves.toStrictEqual([]);
  });

  it("labels an online order kind order with its selected store, and a counter sale kind prescription", async () => {
    const documents = await repository.listSalesDocuments({ from, to, siteIds: [siteA] });
    expect(documents.find((document) => document.id === orderIds.inSiteA)).toStrictEqual({
      id: orderIds.inSiteA,
      kind: "order",
      siteId: siteA,
      customerId: customer,
      createdAt: "2026-10-15T12:00:00.000Z",
    });
    expect(documents.find((document) => document.id === prescriptionIds.inSiteA)).toStrictEqual({
      id: prescriptionIds.inSiteA,
      kind: "prescription",
      siteId: siteA,
      customerId: customer,
      createdAt: "2026-10-02T09:00:00.000Z",
    });
    const all = await repository.listSalesDocuments({ from, to });
    expect(all.find((document) => document.id === prescriptionIds.inSiteB)?.customerId).toBeNull();
  });
});
