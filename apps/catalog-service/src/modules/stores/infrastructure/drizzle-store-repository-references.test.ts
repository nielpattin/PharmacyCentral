import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CatalogDatabase } from "../../../shared/infrastructure/database.ts";
import * as schema from "../../../shared/infrastructure/schema.ts";
import { REFUSALS } from "../../../shared/refusal.ts";
import { DrizzleStoreRepository } from "./drizzle-store-repository.ts";

const migration = (file: string): URL => new URL(`../../../../drizzle/migrations/${file}`, import.meta.url);

/**
 * The delete checks and the publish check are single statements over the catalog's own tables, so they need a real
 * Postgres engine. PostGIS has no PGlite build, so `sites.location` becomes a text column that nothing here touches,
 * exactly as in the site filter tests.
 */
describe("DrizzleStoreRepository references and publication", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const repository = new DrizzleStoreRepository({ db, pool: undefined } as unknown as CatalogDatabase);

  const siteInUse = "00000000-0000-4000-8000-0000000000a1";
  const siteFree = "00000000-0000-4000-8000-0000000000a2";
  const siteAvailable = "00000000-0000-4000-8000-0000000000a3";
  const locationAtInUseSite = "00000000-0000-4000-8000-0000000000b1";
  const productPriced = "00000000-0000-4000-8000-0000000000c1";
  const productUnitOnly = "00000000-0000-4000-8000-0000000000c2";
  const productFree = "00000000-0000-4000-8000-0000000000c3";
  const productAvailable = "00000000-0000-4000-8000-0000000000c4";
  const unitOfPriced = "00000000-0000-4000-8000-0000000000d1";
  const unitOfOnly = "00000000-0000-4000-8000-0000000000d2";
  const draftByMaker = "00000000-0000-4000-8000-0000000000e1";
  const draftWithoutMaker = "00000000-0000-4000-8000-0000000000e2";
  const maker = "00000000-0000-4000-8000-0000000000f1";
  const otherManager = "00000000-0000-4000-8000-0000000000f2";

  beforeAll(async () => {
    const base = (await readFile(migration("0000_jazzy_krista_starr.sql"), "utf8"))
      .replace("CREATE EXTENSION IF NOT EXISTS postgis;", "")
      .replace('"location" geometry(point)', '"location" text')
      .replace(/CREATE INDEX "sites_location_gist"[^;]*;/u, "");
    await client.exec(base);
    for (const file of [
      "0001_aromatic_venus.sql",
      "0002_global_product_pricing.sql",
      "0003_product_metadata.sql",
      "0007_product_indications.sql",
    ])
      await client.exec(await readFile(migration(file), "utf8"));

    await db.insert(schema.sites).values([
      { id: siteInUse, code: "SITE-USED", name: "Used", siteType: "RetailStore" },
      { id: siteFree, code: "SITE-FREE", name: "Free", siteType: "RetailStore" },
      { id: siteAvailable, code: "SITE-STOCK", name: "Stock", siteType: "RetailStore" },
    ]);
    await db.insert(schema.storageLocations).values({
      id: locationAtInUseSite,
      siteId: siteInUse,
      code: "LOC-1",
      name: "Shelf",
      locationType: "Warehouse",
    });
    await db.insert(schema.availabilityProjections).values({
      productId: productAvailable,
      siteId: siteAvailable,
      inStock: true,
    });
    await db.insert(schema.products).values([
      { id: productPriced, sku: "SKU-PRICED", name: "Priced" },
      { id: productUnitOnly, sku: "SKU-UNIT", name: "Unit only" },
      { id: productFree, sku: "SKU-FREE", name: "Free" },
      { id: productAvailable, sku: "SKU-STOCK", name: "Stocked" },
    ]);
    await db.insert(schema.productUnits).values([
      {
        id: unitOfPriced,
        productId: productPriced,
        unitName: "Box",
        conversionFactorToBaseUnit: "1",
        isBaseUnit: true,
      },
      {
        id: unitOfOnly,
        productId: productUnitOnly,
        unitName: "Box",
        conversionFactorToBaseUnit: "1",
        isBaseUnit: true,
      },
    ]);
    await db.insert(schema.productPrices).values([
      {
        id: draftByMaker,
        productId: productPriced,
        productUnitId: unitOfPriced,
        unitPrice: "12000",
        status: "Draft",
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-12-31",
        createdBy: maker,
      },
      {
        id: draftWithoutMaker,
        productId: productPriced,
        productUnitId: unitOfPriced,
        unitPrice: "13000",
        status: "Draft",
        effectiveFrom: "2027-01-01",
        createdBy: null,
      },
    ]);
  });

  afterAll(async () => {
    await client.close();
  });

  describe("deletes refused for reference data in use", () => {
    it("refuses a site that a storage location refers to, and keeps the row", async () => {
      await expect(repository.deleteSite(siteInUse)).resolves.toBe("in_use");
      await expect(repository.getSite(siteInUse)).resolves.toMatchObject({ code: "SITE-USED" });
    });

    it("refuses a site that an availability row refers to", async () => {
      await db.insert(schema.availabilityProjections).values({
        productId: productFree,
        siteId: siteFree,
        inStock: false,
      });
      await expect(repository.deleteSite(siteFree)).resolves.toBe("in_use");
      await db.delete(schema.availabilityProjections).where(eq(schema.availabilityProjections.siteId, siteFree));
    });

    it("deletes an unreferenced site and answers not_found for one that is gone", async () => {
      const unused = "00000000-0000-4000-8000-0000000000a9";
      await db.insert(schema.sites).values({ id: unused, code: "SITE-GONE", name: "Gone", siteType: "RetailStore" });

      await expect(repository.deleteSite(unused)).resolves.toBe("deleted");
      await expect(repository.deleteSite(unused)).resolves.toBe("not_found");
    });

    it("refuses a product that a price or a unit refers to, and keeps it", async () => {
      await expect(repository.deleteProduct(productPriced)).resolves.toBe("in_use");
      await expect(repository.deleteProduct(productUnitOnly)).resolves.toBe("in_use");
      await expect(repository.getProduct(productPriced)).resolves.toMatchObject({ sku: "SKU-PRICED" });
    });

    it("refuses a product that an availability row refers to", async () => {
      await expect(repository.deleteProduct(productAvailable)).resolves.toBe("in_use");
    });

    it("deletes an unreferenced product", async () => {
      await expect(repository.deleteProduct(productFree)).resolves.toBe("deleted");
      await expect(repository.getProduct(productFree)).resolves.toBeUndefined();
    });

    it("deletes a storage location, which the catalog holds no reference to", async () => {
      await expect(repository.deleteStorageLocation(locationAtInUseSite)).resolves.toBe("deleted");
      await expect(repository.deleteStorageLocation(locationAtInUseSite)).resolves.toBe("not_found");
    });
  });

  describe("publishing a draft", () => {
    it("refuses the creator of a draft, with 403 self_approval_forbidden, and leaves the draft unpublished", async () => {
      await expect(repository.transitionPrice(draftByMaker, "publish", maker)).rejects.toMatchObject({
        refusal: REFUSALS.priceSelfApproval,
      });
      await expect(repository.getProduct(productPriced)).resolves.toBeDefined();
      const rows = await db.select().from(schema.productPrices);
      expect(rows.find((row) => row.id === draftByMaker)?.status).toBe("Draft");
    });

    it("publishes a draft for another manager and records that manager as publisher", async () => {
      const published = await repository.transitionPrice(draftByMaker, "publish", otherManager);

      expect(published).toMatchObject({ status: "Published", publishedBy: otherManager });
    });

    it("publishes a draft that has no recorded creator", async () => {
      const published = await repository.transitionPrice(draftWithoutMaker, "publish", otherManager);

      expect(published).toMatchObject({ status: "Published" });
    });

    it("archives a draft by its creator, since archiving needs no second person", async () => {
      const draft = "00000000-0000-4000-8000-0000000000e3";
      await db.insert(schema.productPrices).values({
        id: draft,
        productId: productFree,
        productUnitId: unitOfOnly,
        unitPrice: "9000",
        status: "Draft",
        effectiveFrom: "2028-01-01",
        createdBy: maker,
      });

      const archived = await repository.transitionPrice(draft, "archive", maker);

      expect(archived).toMatchObject({ status: "Archived", archivedBy: maker });
    });
  });
});
