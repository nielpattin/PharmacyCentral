import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CatalogDatabase } from "../../../shared/infrastructure/database.ts";
import * as schema from "../../../shared/infrastructure/schema.ts";
import { DrizzleStoreRepository } from "./drizzle-store-repository.ts";

const migration = (file: string): URL => new URL(`../../../../drizzle/migrations/${file}`, import.meta.url);

/**
 * A site-scoped reader reaches the catalog through an `IN (...)` of their sites, and only a real Postgres engine with
 * the real migrations shows what that clause keeps: storage locations and availability rows of the reader's sites,
 * never a neighbour's, and nothing at all for an empty scope. PostGIS from migration 0000 has no PGlite build, so the
 * `sites.location` column and its GiST index are replaced with a text column that nothing in these queries touches.
 */
describe("DrizzleStoreRepository site filters", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const repository = new DrizzleStoreRepository({ db, pool: undefined } as unknown as CatalogDatabase);

  const siteA = "00000000-0000-4000-8000-00000000000a";
  const siteB = "00000000-0000-4000-8000-00000000000b";
  const siteC = "00000000-0000-4000-8000-00000000000c";
  const locationA = "00000000-0000-4000-8000-00000000001a";
  const locationB = "00000000-0000-4000-8000-00000000001b";
  const locationC = "00000000-0000-4000-8000-00000000001c";
  const product = "00000000-0000-4000-8000-00000000002a";

  beforeAll(async () => {
    const sites = (await readFile(migration("0000_jazzy_krista_starr.sql"), "utf8"))
      .replace("CREATE EXTENSION IF NOT EXISTS postgis;", "")
      .replace('"location" geometry(point)', '"location" text')
      .replace(/CREATE INDEX "sites_location_gist"[^;]*;/u, "");
    await client.exec(sites);
    await client.exec(await readFile(migration("0001_aromatic_venus.sql"), "utf8"));
    await db.insert(schema.storageLocations).values([
      { id: locationA, siteId: siteA, code: "LOC-A", name: "Quầy A", locationType: "Retail" },
      { id: locationB, siteId: siteB, code: "LOC-B", name: "Quầy B", locationType: "Retail" },
      { id: locationC, siteId: siteC, code: "LOC-C", name: "Quầy C", locationType: "Retail" },
    ]);
    await db.insert(schema.availabilityProjections).values([
      { productId: product, siteId: siteA, inStock: true },
      { productId: product, siteId: siteB, inStock: true },
      { productId: product, siteId: siteC, inStock: true },
    ]);
  });

  afterAll(async () => {
    await client.close();
  });

  it("unions the storage locations of the reader's sites and excludes every other site", async () => {
    const idsFor = async (siteIds: string[]): Promise<string[]> =>
      (await repository.listStorageLocations(siteIds)).map((location) => location.id).sort();

    await expect(idsFor([siteA, siteB])).resolves.toEqual([locationA, locationB].sort());
    await expect(idsFor([siteB])).resolves.toEqual([locationB]);
    await expect(idsFor([])).resolves.toEqual([]);
  });

  it("unions the availability of the reader's sites and excludes every other site", async () => {
    const sitesFor = async (siteIds: string[]): Promise<string[]> =>
      (await repository.listAvailability(product, siteIds)).map((row) => row.siteId).sort();

    await expect(sitesFor([siteA, siteB])).resolves.toEqual([siteA, siteB].sort());
    await expect(sitesFor([siteB])).resolves.toEqual([siteB]);
    await expect(sitesFor([])).resolves.toEqual([]);
  });
});
