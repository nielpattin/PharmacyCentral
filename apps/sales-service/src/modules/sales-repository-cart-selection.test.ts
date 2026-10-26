import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { SalesDatabase } from "../shared/infrastructure/database.ts";
import * as schema from "../shared/infrastructure/schema.ts";
import { SalesRepository } from "./sales-repository.ts";

const migrationsFolder = fileURLToPath(new URL("../../drizzle/migrations", import.meta.url));

const shopper = "00000000-0000-4000-8000-00000000000a";
const otherShopper = "00000000-0000-4000-8000-00000000000b";
const paracetamol = {
  productId: "00000000-0000-4000-8000-0000000000a1",
  productUnitId: "00000000-0000-4000-8000-0000000000b1",
};
const ibuprofen = {
  productId: "00000000-0000-4000-8000-0000000000a2",
  productUnitId: "00000000-0000-4000-8000-0000000000b2",
};

/**
 * BR-CART-001, BR-CART-003 and BR-CART-004 are carried by SQL: the column default decides what a new line starts as,
 * and the `cart_id` scope decides whose lines a request may touch. Running the repository against a real Postgres
 * engine with the real migrations is what makes a changed default or a lost scope show up as a failing test.
 */
describe("SalesRepository cart selection", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const repository = new SalesRepository({ db, pool: undefined } as unknown as SalesDatabase);

  const addLine = (customerId: string, line: typeof paracetamol, quantity = 1) =>
    repository.addCartLine(customerId, { ...line, quantity });

  const ticks = async (customerId: string): Promise<Record<string, boolean>> => {
    const cart = await repository.getCart(customerId);
    return Object.fromEntries((cart?.lines ?? []).map((line) => [line.productId, line.selected]));
  };

  const lineOf = async (customerId: string, productId: string) => {
    const cart = await repository.getCart(customerId);
    const line = cart?.lines.find((candidate) => candidate.productId === productId);
    return line && { quantity: Number(line.quantity), selected: line.selected };
  };

  beforeAll(async () => {
    await migrate(db, { migrationsFolder });
  });

  beforeEach(async () => {
    await client.exec("DELETE FROM cart_lines; DELETE FROM carts");
  });

  afterAll(async () => {
    await client.close();
  });

  it("starts a new line unticked, and keeps its tick when more of it is added", async () => {
    await addLine(shopper, paracetamol);
    expect(await ticks(shopper)).toEqual({ [paracetamol.productId]: false });

    const cart = await repository.getCart(shopper);
    await repository.setCartSelection(shopper, true, [cart!.lines[0]!.id]);
    await addLine(shopper, paracetamol, 2);

    expect(await ticks(shopper)).toEqual({ [paracetamol.productId]: true });
  });

  it("ticks only the named lines, and every line when none are named", async () => {
    await addLine(shopper, paracetamol);
    await addLine(shopper, ibuprofen);
    const cart = await repository.getCart(shopper);
    const paracetamolLine = cart!.lines.find((line) => line.productId === paracetamol.productId)!;

    await repository.setCartSelection(shopper, true, [paracetamolLine.id]);
    expect(await ticks(shopper)).toEqual({ [paracetamol.productId]: true, [ibuprofen.productId]: false });

    await repository.setCartSelection(shopper, true);
    expect(await ticks(shopper)).toEqual({ [paracetamol.productId]: true, [ibuprofen.productId]: true });

    await repository.setCartSelection(shopper, false);
    expect(await ticks(shopper)).toEqual({ [paracetamol.productId]: false, [ibuprofen.productId]: false });
  });

  it("never lets one shopper tick or remove another shopper's line", async () => {
    await addLine(shopper, paracetamol);
    await addLine(otherShopper, paracetamol);
    const theirs = (await repository.getCart(otherShopper))!.lines[0]!;

    await repository.setCartSelection(shopper, true, [theirs.id]);
    await repository.clearCart(shopper, [theirs.id]);

    expect(await ticks(otherShopper)).toEqual({ [paracetamol.productId]: false });
  });

  it("removes only the ordered lines and leaves the rest unticked in the cart", async () => {
    await addLine(shopper, paracetamol);
    await addLine(shopper, ibuprofen);
    const cart = await repository.getCart(shopper);
    const ordered = cart!.lines.find((line) => line.productId === paracetamol.productId)!;
    await repository.setCartSelection(shopper, true, [ordered.id]);

    await repository.clearCart(shopper, [ordered.id]);

    expect(await ticks(shopper)).toEqual({ [ibuprofen.productId]: false });
  });

  it("creates the account cart on merge and adds each line with the tick it was sent with", async () => {
    await repository.mergeLocalCart(shopper, [
      { ...paracetamol, quantity: 1, selected: true },
      { ...ibuprofen, quantity: 2, selected: false },
    ]);

    expect(await lineOf(shopper, paracetamol.productId)).toEqual({ quantity: 1, selected: true });
    expect(await lineOf(shopper, ibuprofen.productId)).toEqual({ quantity: 2, selected: false });
  });

  it("sums a product and unit sent twice in one request, and keeps the first sent tick", async () => {
    await repository.mergeLocalCart(shopper, [
      { ...paracetamol, quantity: 1, selected: false },
      { ...paracetamol, quantity: 2, selected: true },
    ]);

    expect(await lineOf(shopper, paracetamol.productId)).toEqual({ quantity: 3, selected: false });
    expect((await repository.getCart(shopper))!.lines).toHaveLength(1);
  });

  it("adds to an account line already in the cart, and keeps the account's tick on it", async () => {
    await addLine(shopper, ibuprofen);
    const cart = await repository.getCart(shopper);
    await repository.setCartSelection(shopper, true, [cart!.lines[0]!.id]);

    await repository.mergeLocalCart(shopper, [{ ...ibuprofen, quantity: 2, selected: false }]);

    expect(await lineOf(shopper, ibuprofen.productId)).toEqual({ quantity: 3, selected: true });
  });

  it("changes only the caller's cart", async () => {
    await addLine(otherShopper, paracetamol, 5);

    await repository.mergeLocalCart(shopper, [{ ...paracetamol, quantity: 1, selected: true }]);

    expect(await lineOf(otherShopper, paracetamol.productId)).toEqual({ quantity: 5, selected: false });
    expect(await lineOf(shopper, paracetamol.productId)).toEqual({ quantity: 1, selected: true });
  });
  it("reads only the caller's ticked lines for an order, with numeric quantities", async () => {
    await addLine(shopper, paracetamol, 2);
    await addLine(shopper, ibuprofen);
    await addLine(otherShopper, paracetamol);
    const own = (await repository.getCart(shopper))!;
    const ticked = own.lines.find((line) => line.productId === paracetamol.productId)!;
    const theirs = (await repository.getCart(otherShopper))!.lines[0]!;
    await repository.setCartSelection(shopper, true, [ticked.id]);
    await repository.setCartSelection(otherShopper, true, [theirs.id]);

    expect(await repository.getSelectedCartLines(shopper)).toEqual([
      { id: ticked.id, productId: paracetamol.productId, productUnitId: paracetamol.productUnitId, quantity: 2 },
    ]);
    expect(await repository.getSelectedCartLines("00000000-0000-4000-8000-0000000000ff")).toEqual([]);
  });
});
