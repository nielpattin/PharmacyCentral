import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CatalogDatabase } from "../../../shared/infrastructure/database.ts";
import * as schema from "../../../shared/infrastructure/schema.ts";
import type { KeysetPage, KeysetPosition } from "../../../shared/pagination/page-cursor.ts";
import { DrizzleStoreRepository } from "./drizzle-store-repository.ts";

const migration = (file: string): URL => new URL(`../../../../drizzle/migrations/${file}`, import.meta.url);

/** Follows `page` from the first page to the last, passing the position of each page's last row to the next. */
const walk = async <T extends { id: string }>(
  page: (after: KeysetPosition | undefined) => Promise<KeysetPage<T>>,
  positionOf: (row: T) => KeysetPosition,
): Promise<string[]> => {
  const seen: string[] = [];
  let current = await page(undefined);
  seen.push(...current.rows.map((row) => row.id));
  while (current.hasMore) {
    const last = current.rows.at(-1);
    if (!last) break;
    current = await page(positionOf(last));
    seen.push(...current.rows.map((row) => row.id));
  }
  return seen;
};

/**
 * Keyset lists only work against a real Postgres engine: the row comparison, the date cast and the ordering of equal
 * sort keys are what the tests check. PostGIS from migration 0000 has no PGlite build, so its `sites.location` column
 * and GiST index are replaced as the site filter test does, and the index migration runs verbatim afterwards.
 */
describe("DrizzleStoreRepository keyset and text lists", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const repository = new DrizzleStoreRepository({ db, pool: undefined } as unknown as CatalogDatabase);

  const products = {
    paracetamol: "00000000-0000-4000-8000-0000000000b1",
    amoxicillin: "00000000-0000-4000-8000-0000000000b2",
  };
  const prices = {
    a1: "00000000-0000-4000-8000-0000000000a1",
    a2: "00000000-0000-4000-8000-0000000000a2",
    a3: "00000000-0000-4000-8000-0000000000a3",
    a4: "00000000-0000-4000-8000-0000000000a4",
    a5: "00000000-0000-4000-8000-0000000000a5",
  };
  const sites = {
    central: "00000000-0000-4000-8000-0000000000d1",
    riverside: "00000000-0000-4000-8000-0000000000d2",
    warehouse: "00000000-0000-4000-8000-0000000000d3",
    closed: "00000000-0000-4000-8000-0000000000d4",
  };
  const locations = {
    shelfA: "00000000-0000-4000-8000-0000000000e1",
    coldA: "00000000-0000-4000-8000-0000000000e2",
    shelfB: "00000000-0000-4000-8000-0000000000e3",
  };
  const suppliers = {
    alpha: "00000000-0000-4000-8000-0000000000f1",
    beta: "00000000-0000-4000-8000-0000000000f2",
  };

  beforeAll(async () => {
    const base = (await readFile(migration("0000_jazzy_krista_starr.sql"), "utf8"))
      .replace("CREATE EXTENSION IF NOT EXISTS postgis;", "")
      .replace('"location" geometry(point)', '"location" text')
      .replace(/CREATE INDEX "sites_location_gist"[^;]*;/u, "");
    await client.exec(base);
    await client.exec(await readFile(migration("0001_aromatic_venus.sql"), "utf8"));
    await client.exec(await readFile(migration("0002_global_product_pricing.sql"), "utf8"));
    await client.exec(await readFile(migration("0003_product_metadata.sql"), "utf8"));
    await client.exec(await readFile(migration("0007_product_indications.sql"), "utf8"));
    await client.exec(await readFile(migration("0010_melodic_tyger_tiger.sql"), "utf8"));

    await db.insert(schema.products).values([
      { id: products.paracetamol, sku: "PARA-500", name: "Paracetamol 500mg" },
      { id: products.amoxicillin, sku: "AMOX-250", name: "Amoxicillin 250mg" },
    ]);
    // Three prices share the effective date 2026-03-01, so their order is decided by id alone.
    await db.insert(schema.productPrices).values([
      {
        id: prices.a1,
        productId: products.paracetamol,
        productUnitId: products.paracetamol,
        unitPrice: "1000",
        effectiveFrom: "2026-03-01",
        status: "Published",
      },
      {
        id: prices.a2,
        productId: products.paracetamol,
        productUnitId: products.paracetamol,
        unitPrice: "1100",
        effectiveFrom: "2026-03-01",
        status: "Published",
      },
      {
        id: prices.a3,
        productId: products.amoxicillin,
        productUnitId: products.amoxicillin,
        unitPrice: "2000",
        effectiveFrom: "2026-03-01",
        status: "Published",
      },
      {
        id: prices.a4,
        productId: products.amoxicillin,
        productUnitId: products.amoxicillin,
        unitPrice: "2100",
        effectiveFrom: "2026-02-01",
        status: "Draft",
      },
      {
        id: prices.a5,
        productId: products.paracetamol,
        productUnitId: products.paracetamol,
        unitPrice: "900",
        effectiveFrom: "2026-01-01",
        status: "Archived",
      },
    ]);

    await db.insert(schema.sites).values([
      { id: sites.central, code: "SITE-A", name: "Central Pharmacy", siteType: "Retail", isCustomerFacing: true },
      { id: sites.riverside, code: "SITE-B", name: "Riverside Pharmacy", siteType: "Retail", isCustomerFacing: true },
      { id: sites.warehouse, code: "WH-C", name: "Warehouse", siteType: "Warehouse", isCustomerFacing: false },
      {
        id: sites.closed,
        code: "SITE-D",
        name: "Closed Pharmacy",
        siteType: "Retail",
        isCustomerFacing: true,
        isActive: false,
      },
    ]);
    await db.insert(schema.storageLocations).values([
      { id: locations.shelfA, siteId: sites.central, code: "LOC-A1", name: "Shelf one", locationType: "Shelf" },
      { id: locations.coldA, siteId: sites.central, code: "LOC-A2", name: "Cold room", locationType: "Cold" },
      { id: locations.shelfB, siteId: sites.riverside, code: "LOC-B1", name: "Shelf one", locationType: "Shelf" },
    ]);
    await db.insert(schema.suppliers).values([
      { id: suppliers.alpha, code: "SUP-01", name: "Alpha Pharma" },
      { id: suppliers.beta, code: "SUP-02", name: "Beta Medical" },
    ]);
  });

  afterAll(async () => {
    await client.close();
  });

  const priceOrder = [prices.a3, prices.a2, prices.a1, prices.a4, prices.a5];

  it("walks the price list newest first in pages of two, neither repeating nor skipping a row with an equal date", async () => {
    const walked = await walk(
      (after) => repository.listPrices({ limit: 2, after }),
      (row) => ({ sortValue: row.effectiveFrom, id: row.id }),
    );

    expect(walked).toEqual(priceOrder);
  });

  it("answers the whole price list on one page when it fits, with no further page", async () => {
    const page = await repository.listPrices({ limit: 500 });

    expect(page.rows.map((row) => row.id)).toEqual(priceOrder);
    expect(page.hasMore).toBe(false);
  });

  it("reports a further page exactly when the rows exceed the limit", async () => {
    const page = await repository.listPrices({ limit: 2 });

    expect(page.rows.map((row) => row.id)).toEqual([prices.a3, prices.a2]);
    expect(page.hasMore).toBe(true);
  });

  it("matches q against the SKU or the name of the product, case-insensitively, and treats wildcards literally", async () => {
    const ids = async (q: string) => (await repository.listPrices({ q, limit: 500 })).rows.map((row) => row.id);

    await expect(ids("amox")).resolves.toEqual([prices.a3, prices.a4]);
    await expect(ids("250")).resolves.toEqual([prices.a3, prices.a4]);
    await expect(ids("PARA-5")).resolves.toEqual([prices.a2, prices.a1, prices.a5]);
    await expect(ids("%")).resolves.toEqual([]);
    await expect(ids("_")).resolves.toEqual([]);
    await expect(ids("zzz")).resolves.toEqual([]);
  });

  it("combines q with the status filter and with the cursor", async () => {
    const withStatus = await repository.listPrices({ q: "para", status: "Published", limit: 500 });
    const afterFirst = await repository.listPrices({
      q: "para",
      limit: 500,
      after: { sortValue: "2026-03-01", id: prices.a2 },
    });
    const walkedFiltered = await walk(
      (after) => repository.listPrices({ q: "para", limit: 1, after }),
      (row) => ({ sortValue: row.effectiveFrom, id: row.id }),
    );

    expect(withStatus.rows.map((row) => row.id)).toEqual([prices.a2, prices.a1]);
    expect(afterFirst.rows.map((row) => row.id)).toEqual([prices.a1, prices.a5]);
    expect(walkedFiltered).toEqual([prices.a2, prices.a1, prices.a5]);
  });

  it("lists the customer-facing active stores by code, walking them in pages and leaving other sites out", async () => {
    const walked = await walk(
      (after) => repository.listActiveStores(1, after),
      (row) => ({ sortValue: row.code, id: row.id }),
    );
    const whole = await repository.listActiveStores(50);

    expect(walked).toEqual([sites.central, sites.riverside]);
    expect(whole.rows.map((row) => row.code)).toEqual(["SITE-A", "SITE-B"]);
    expect(whole.hasMore).toBe(false);
  });

  it("filters sites by code or name with q, in code order", async () => {
    const codes = async (q?: string) => (await repository.listSites(q)).map((site) => site.code);

    await expect(codes("pharmacy")).resolves.toEqual(["SITE-A", "SITE-B", "SITE-D"]);
    await expect(codes("wh-")).resolves.toEqual(["WH-C"]);
    await expect(codes()).resolves.toEqual(["SITE-A", "SITE-B", "SITE-D", "WH-C"]);
    await expect(codes("%")).resolves.toEqual([]);
  });

  it("filters storage locations by code or name with q, within the sites in scope", async () => {
    const ids = async (siteIds: string[] | undefined, q?: string) =>
      (await repository.listStorageLocations(siteIds, q)).map((location) => location.code);

    await expect(ids([sites.central], "shelf")).resolves.toEqual(["LOC-A1"]);
    await expect(ids(undefined, "shelf")).resolves.toEqual(["LOC-A1", "LOC-B1"]);
    await expect(ids([sites.central])).resolves.toEqual(["LOC-A1", "LOC-A2"]);
    await expect(ids([sites.riverside], "loc-a")).resolves.toEqual([]);
  });

  it("filters suppliers by code or name with q", async () => {
    const codes = async (q?: string) => (await repository.listSuppliers(q)).map((supplier) => supplier.code);

    await expect(codes("beta")).resolves.toEqual(["SUP-02"]);
    await expect(codes("sup-0")).resolves.toEqual(["SUP-01", "SUP-02"]);
    await expect(codes()).resolves.toEqual(["SUP-01", "SUP-02"]);
    await expect(codes("%")).resolves.toEqual([]);
  });

  it("answers every product's name and grouping in SKU order, including a product that is no longer active", async () => {
    const retired = "00000000-0000-4000-8000-0000000000b3";
    await db.insert(schema.products).values({
      id: retired,
      sku: "ZINC-100",
      name: "Kẽm",
      category: "Vitamin and supplement",
      prescriptionRequired: false,
      isActive: false,
    });

    await expect(repository.listProductClassifications()).resolves.toEqual([
      {
        productId: products.amoxicillin,
        productName: "Amoxicillin 250mg",
        category: null,
        prescriptionRequired: false,
      },
      {
        productId: products.paracetamol,
        productName: "Paracetamol 500mg",
        category: null,
        prescriptionRequired: false,
      },
      {
        productId: retired,
        productName: "Kẽm",
        category: "Vitamin and supplement",
        prescriptionRequired: false,
      },
    ]);
  });
});
