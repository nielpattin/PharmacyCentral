import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CatalogDatabase } from "../../../shared/infrastructure/database.ts";
import * as schema from "../../../shared/infrastructure/schema.ts";
import { DrizzleStoreRepository } from "./drizzle-store-repository.ts";

const migration = (file: string): URL => new URL(`../../../../drizzle/migrations/${file}`, import.meta.url);

/**
 * The counts run the same filters as the lists, and the base-unit prices are a join with a window function, so they are
 * checked against a real Postgres engine. A price counts only on a unit of its own product, only while Published,
 * site-less and inside its window; an inactive product gets no row at all.
 */
describe("DrizzleStoreRepository counts", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const repository = new DrizzleStoreRepository({ db, pool: undefined } as unknown as CatalogDatabase);

  const products = {
    paracetamol: "00000000-0000-4000-8000-0000000000b1",
    amoxicillin: "00000000-0000-4000-8000-0000000000b2",
    vitaminC: "00000000-0000-4000-8000-0000000000b3",
    retired: "00000000-0000-4000-8000-0000000000b4",
  };
  const units = {
    paracetamolTablet: "00000000-0000-4000-8000-0000000000c1",
    amoxicillinCapsule: "00000000-0000-4000-8000-0000000000c2",
    vitaminCTablet: "00000000-0000-4000-8000-0000000000c3",
    paracetamolBox: "00000000-0000-4000-8000-0000000000c4",
    retiredTablet: "00000000-0000-4000-8000-0000000000c5",
  };
  const prices = {
    paracetamolToday: "00000000-0000-4000-8000-0000000000a1",
    // Stored against amoxicillin but on paracetamol's tablet: it belongs to neither product's own units, so it prices nothing.
    amoxicillinOnForeignUnit: "00000000-0000-4000-8000-0000000000a2",
    vitaminCFuture: "00000000-0000-4000-8000-0000000000a3",
    retiredProductPrice: "00000000-0000-4000-8000-0000000000a4",
    paracetamolLastYear: "00000000-0000-4000-8000-0000000000a5",
    vitaminCArchived: "00000000-0000-4000-8000-0000000000a6",
    // A box of ten at 9000 is 900 per tablet, which the tablet's own 1000 must beat while both are in force.
    paracetamolBoxToday: "00000000-0000-4000-8000-0000000000a7",
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
      {
        id: products.paracetamol,
        sku: "PARA-500",
        name: "Paracetamol 500mg",
        category: "Medicine",
        prescriptionRequired: false,
      },
      {
        id: products.amoxicillin,
        sku: "AMOX-250",
        name: "Amoxicillin 250mg",
        category: "Medicine",
        prescriptionRequired: true,
      },
      { id: products.vitaminC, sku: "VIT-C", name: "Vitamin C", category: "Supplement" },
      { id: products.retired, sku: "OLD-1", name: "Retired item", isActive: false },
    ]);
    await db.insert(schema.productUnits).values([
      {
        id: units.paracetamolTablet,
        productId: products.paracetamol,
        unitName: "Viên",
        conversionFactorToBaseUnit: "1",
        isBaseUnit: true,
      },
      {
        id: units.amoxicillinCapsule,
        productId: products.amoxicillin,
        unitName: "Viên",
        conversionFactorToBaseUnit: "1",
        isBaseUnit: true,
      },
      {
        id: units.vitaminCTablet,
        productId: products.vitaminC,
        unitName: "Viên",
        conversionFactorToBaseUnit: "1",
        isBaseUnit: true,
      },
      {
        id: units.paracetamolBox,
        productId: products.paracetamol,
        unitName: "Hộp",
        conversionFactorToBaseUnit: "10",
      },
      {
        id: units.retiredTablet,
        productId: products.retired,
        unitName: "Viên",
        conversionFactorToBaseUnit: "1",
        isBaseUnit: true,
      },
    ]);
    await db.insert(schema.productPrices).values([
      {
        id: prices.paracetamolToday,
        productId: products.paracetamol,
        productUnitId: units.paracetamolTablet,
        unitPrice: "1000",
        effectiveFrom: "2026-01-01",
        status: "Published",
      },
      {
        id: prices.amoxicillinOnForeignUnit,
        productId: products.amoxicillin,
        productUnitId: units.paracetamolTablet,
        unitPrice: "2000",
        effectiveFrom: "2026-01-01",
        status: "Published",
      },
      {
        id: prices.vitaminCFuture,
        productId: products.vitaminC,
        productUnitId: units.vitaminCTablet,
        unitPrice: "3000",
        effectiveFrom: "2026-10-21",
        status: "Published",
      },
      {
        id: prices.retiredProductPrice,
        productId: products.retired,
        productUnitId: units.retiredTablet,
        unitPrice: "4000",
        effectiveFrom: "2026-01-01",
        status: "Published",
      },
      {
        id: prices.paracetamolLastYear,
        productId: products.paracetamol,
        productUnitId: units.paracetamolBox,
        unitPrice: "9000",
        effectiveFrom: "2025-01-01",
        effectiveTo: "2025-12-31",
        status: "Published",
      },
      {
        id: prices.vitaminCArchived,
        productId: products.vitaminC,
        productUnitId: units.vitaminCTablet,
        unitPrice: "3000",
        effectiveFrom: "2026-01-01",
        status: "Archived",
      },
      {
        id: prices.paracetamolBoxToday,
        productId: products.paracetamol,
        productUnitId: units.paracetamolBox,
        unitPrice: "9000",
        effectiveFrom: "2026-01-01",
        status: "Published",
      },
    ]);
  });

  afterAll(async () => {
    await client.close();
  });

  it("counts the active products the product list shows, under the same filters", async () => {
    await expect(repository.countProducts({})).resolves.toBe(3);
    await expect(repository.countProducts({ search: "amox" })).resolves.toBe(1);
    await expect(repository.countProducts({ search: "%" })).resolves.toBe(0);
    await expect(repository.countProducts({ category: "Medicine" })).resolves.toBe(2);
    await expect(repository.countProducts({ prescriptionRequired: true })).resolves.toBe(1);
    await expect(repository.countProducts({ search: "retired" })).resolves.toBe(0);
  });

  it("counts the prices under the same filters as the price list, paging aside", async () => {
    await expect(repository.countPrices({})).resolves.toBe(7);
    await expect(repository.countPrices({ status: "Published" })).resolves.toBe(6);
    await expect(repository.countPrices({ status: "Archived" })).resolves.toBe(1);
    await expect(repository.countPrices({ q: "amox" })).resolves.toBe(1);
    await expect(repository.countPrices({ productId: products.paracetamol, status: "Published" })).resolves.toBe(3);
  });

  it("answers one base-unit row per active product, ordered by SKU, with null where no price qualifies", async () => {
    const rows = await repository.listBasePricesOn("2024-06-01");

    expect(rows).toEqual([
      { productId: products.amoxicillin, productName: "Amoxicillin 250mg", unitPrice: null },
      { productId: products.paracetamol, productName: "Paracetamol 500mg", unitPrice: null },
      { productId: products.vitaminC, productName: "Vitamin C", unitPrice: null },
    ]);
  });

  it("prices a product on its base unit, and a price on a larger unit per base unit, when no base price qualifies", async () => {
    // Last year's price exists only on the box of ten: 9000 / 10 = 900 per tablet.
    const rows = await repository.listBasePricesOn("2025-06-01");

    expect(rows.map((row) => [row.productId, row.unitPrice])).toEqual([
      [products.amoxicillin, null],
      [products.paracetamol, 900],
      [products.vitaminC, null],
    ]);
  });

  it("lets the base unit's own price win over a larger unit's while both are in force", async () => {
    // Both paracetamol prices are in force: the tablet's 1000 beats the box's 900 per tablet.
    const rows = await repository.listBasePricesOn("2026-10-20");

    expect(rows.map((row) => [row.productId, row.unitPrice])).toEqual([
      [products.amoxicillin, null],
      [products.paracetamol, 1000],
      [products.vitaminC, null],
    ]);
  });

  it("prices a product whose base price starts on the day, and never prices it from a price that has not started", async () => {
    const rows = await repository.listBasePricesOn("2026-10-21");

    expect(rows.map((row) => [row.productId, row.unitPrice])).toEqual([
      [products.amoxicillin, null],
      [products.paracetamol, 1000],
      [products.vitaminC, 3000],
    ]);
    expect(
      (await repository.listBasePricesOn("2026-10-20")).find((row) => row.productId === products.vitaminC)?.unitPrice,
    ).toBeNull();
  });
});
