import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { CatalogDatabase } from "../../../shared/infrastructure/database.ts";
import * as schema from "../../../shared/infrastructure/schema.ts";
import { NAME_SIMILARITY_FLOOR, type MatchItem } from "../../catalog/product-matching.ts";
import { DrizzleStoreRepository } from "./drizzle-store-repository.ts";

const migration = (file: string): URL => new URL(`../../../../drizzle/migrations/${file}`, import.meta.url);

/**
 * The candidate query only works when three things line up: the double precision floors accept a line that names no
 * product, the folding function strips Vietnamese diacritics, and the GIN trigram indexes answer the prefilter
 * operators. PGlite is a real Postgres engine, so the migration that creates the function and the indexes runs here
 * verbatim; PostGIS from migration 0000 has no PGlite build, so the products table is created with the columns the
 * repository selects instead of by replaying that migration.
 */
describe("DrizzleStoreRepository product matching", () => {
  const client = new PGlite({ extensions: { pg_trgm, unaccent } });
  const db = drizzle({ client, schema });
  const repository = new DrizzleStoreRepository({ db, pool: undefined } as unknown as CatalogDatabase);

  const fixtures = [
    {
      sku: "PARA-500",
      name: "PARACETAMOL 500MG QUANG BINH 10X10",
      genericName: "Paracetamol",
      activeIngredient: "Paracetamol 500mg",
      strength: "500mg",
      isActive: true,
    },
    {
      sku: "ORS-245",
      name: "ORESOL 245 DHG 20 GOI",
      genericName: "Oral rehydration salts",
      activeIngredient: "Natri clorid 520mg, Natri citrat 580mg, Glucose 2.7, Kali clorid 300mg",
      strength: null,
      isActive: true,
    },
    {
      sku: "AMOX-500",
      name: "AMOXICILLIN 500MG DOMESCO 10X10",
      genericName: "Amoxicillin",
      activeIngredient: "Amoxicillin 500mg",
      strength: "500mg",
      isActive: true,
    },
    {
      // Same name as PARA-500, so only the is_active filter keeps it out of a match on that name.
      sku: "PARA-500-RETIRED",
      name: "PARACETAMOL 500MG QUANG BINH 10X10",
      genericName: "Paracetamol",
      activeIngredient: "Paracetamol 500mg",
      strength: "500mg",
      isActive: false,
    },
  ];

  const skusFor = async (item: MatchItem, limit = 5): Promise<string[]> =>
    (await repository.matchProducts(item, limit)).map((candidate) => candidate.product.sku);

  beforeAll(async () => {
    await client.exec(`
      CREATE TABLE products (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        sku varchar(100) NOT NULL,
        barcode varchar(100),
        name varchar(300) NOT NULL,
        generic_name varchar(300),
        active_ingredient text,
        strength varchar(150),
        dosage_form varchar(150),
        package_description varchar(500),
        registration_number varchar(100),
        prescription_required boolean DEFAULT false NOT NULL,
        image_url text,
        category varchar(150),
        manufacturer varchar(300),
        status varchar(30) DEFAULT 'Active' NOT NULL,
        notes text,
        is_active boolean DEFAULT true NOT NULL,
        created_at timestamp with time zone DEFAULT now() NOT NULL,
        updated_at timestamp with time zone DEFAULT now() NOT NULL
      );
    `);
    for (const file of ["0005_text_search_extensions.sql", "0006_folded_trigram_indexes.sql"]) {
      await client.exec(await readFile(migration(file), "utf8"));
    }
  });

  beforeEach(async () => {
    await client.exec("DELETE FROM products");
    await db.insert(schema.products).values(fixtures);
  });

  afterAll(async () => {
    await client.close();
  });

  it("suggests a product for a line that only names it", async () => {
    await expect(skusFor({ name: "Paracetamol 500mg", activeIngredients: [], strength: null })).resolves.toEqual([
      "PARA-500",
    ]);
  });

  it("suggests a product for a line that names nothing and lists one ingredient", async () => {
    await expect(skusFor({ name: null, activeIngredients: ["Natri clorid"], strength: null })).resolves.toEqual([
      "ORS-245",
    ]);
  });

  it("treats an empty name like a missing one", async () => {
    const candidates = await repository.matchProducts(
      { name: "", activeIngredients: ["Natri clorid"], strength: null },
      5,
    );

    expect(candidates.map((candidate) => candidate.product.sku)).toEqual(["ORS-245"]);
    expect(candidates[0]?.nameScore).toBe(0);
  });

  it("folds Vietnamese diacritics so a written accent still matches the unaccented product", async () => {
    const candidates = await repository.matchProducts(
      { name: "Paracetamol Quảng Bình", activeIngredients: [], strength: null },
      5,
    );

    expect(candidates.map((candidate) => candidate.product.sku)).toEqual(["PARA-500"]);
    expect(candidates[0]?.nameScore).toBeGreaterThanOrEqual(NAME_SIMILARITY_FLOOR);
  });

  it("never suggests a product that is no longer active", async () => {
    const skus = await skusFor({ name: "Paracetamol 500mg", activeIngredients: [], strength: null });

    expect(skus).not.toContain("PARA-500-RETIRED");
  });

  it("returns no candidate for a line nothing resembles", async () => {
    await expect(skusFor({ name: "Zzzzqqq", activeIngredients: ["Unobtainium"], strength: null })).resolves.toEqual([]);
  });
});
