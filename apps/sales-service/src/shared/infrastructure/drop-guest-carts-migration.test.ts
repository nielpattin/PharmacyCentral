import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrationsFolder = fileURLToPath(new URL("../../../drizzle/migrations", import.meta.url));
const dropGuestCartsTag = "0013_drop_guest_carts";

const customerCart = "00000000-0000-4000-8000-0000000000c1";
const guestCart = "00000000-0000-4000-8000-0000000000c2";
const product = {
  productId: "00000000-0000-4000-8000-0000000000a1",
  productUnitId: "00000000-0000-4000-8000-0000000000b1",
};

/**
 * Runs 0013 over a database that still holds guest carts. The migrator is given a copy of the folder whose journal
 * stops at 0012, so the guest rows exist before the migration deletes them.
 */
describe("migration 0013 drops guest carts", () => {
  const client = new PGlite();
  const db = drizzle({ client });
  const workspace = mkdtempSync(join(tmpdir(), "sales-0013-"));

  beforeAll(async () => {
    cpSync(migrationsFolder, workspace, { recursive: true });
    rmSync(join(workspace, `${dropGuestCartsTag}.sql`));
    const journalPath = join(workspace, "meta", "_journal.json");
    const journal: { entries: Array<{ idx: number }> } = JSON.parse(readFileSync(journalPath, "utf8"));
    journal.entries = journal.entries.filter((entry) => entry.idx < 13);
    writeFileSync(journalPath, JSON.stringify(journal));
    await migrate(db, { migrationsFolder: workspace });

    await client.query("INSERT INTO carts (id, customer_id, guest_token_digest) VALUES ($1, $2, NULL)", [
      customerCart,
      "00000000-0000-4000-8000-0000000000aa",
    ]);
    await client.query("INSERT INTO carts (id, customer_id, guest_token_digest) VALUES ($1, NULL, $2)", [
      guestCart,
      "digest-of-a-guest-token",
    ]);
    for (const cartId of [customerCart, guestCart]) {
      await client.query(
        "INSERT INTO cart_lines (cart_id, product_id, product_unit_id, quantity) VALUES ($1, $2, $3, 1)",
        [cartId, product.productId, product.productUnitId],
      );
    }

    const dropGuestCarts = readFileSync(join(migrationsFolder, `${dropGuestCartsTag}.sql`), "utf8");
    for (const statement of dropGuestCarts.split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  });

  afterAll(async () => {
    await client.close();
    rmSync(workspace, { recursive: true, force: true });
  });

  it("keeps only the account carts and their lines", async () => {
    const carts = await client.query<{ id: string }>("SELECT id FROM carts");
    const lines = await client.query<{ cart_id: string }>("SELECT cart_id FROM cart_lines");

    expect(carts.rows.map((row) => row.id)).toEqual([customerCart]);
    expect(lines.rows.map((row) => row.cart_id)).toEqual([customerCart]);
  });

  it("makes customer_id required and removes the guest token column", async () => {
    const nullability = await client.query<{ is_nullable: string }>(
      "SELECT is_nullable FROM information_schema.columns WHERE table_name = 'carts' AND column_name = 'customer_id'",
    );
    const guestColumn = await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'carts' AND column_name = 'guest_token_digest'",
    );

    expect(nullability.rows).toEqual([{ is_nullable: "NO" }]);
    expect(guestColumn.rows).toEqual([]);
  });
});
