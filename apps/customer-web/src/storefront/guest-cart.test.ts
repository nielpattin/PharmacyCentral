import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Cart } from "../customer-api.ts";
import type * as GuestCartModule from "./guest-cart.ts";
import { newUuid } from "./ids.ts";

const STORAGE_KEY = "pharmacy.guest-cart.v1";
const PRODUCT = "6b1d2f3a-4c5e-4f60-8a71-92b3c4d5e6f7";
const OTHER_PRODUCT = "7c2e3f4a-5d6f-4a71-9b82-a3c4d5e6f708";
const UNIT = "8d3e4f5a-6e7f-4b82-8c93-b4d5e6f70819";
const OTHER_UNIT = "9e4f5a6b-7f80-4c93-9da4-c5e6f7081920";
const LINE = "0a1b2c3d-4e5f-4a60-8b71-c2d3e4f50617";

const onlyLine = (cart: Cart) => {
  const [line] = cart.lines;
  if (cart.lines.length !== 1 || !line) throw new Error(`expected one line, found ${cart.lines.length}`);
  return line;
};

const lineFor = (cart: Cart, productId: string) => {
  const line = cart.lines.find((candidate) => candidate.productId === productId);
  if (!line) throw new Error(`no line for ${productId}`);
  return line;
};

describe("guest cart store", () => {
  let items: Map<string, string>;
  let store: typeof GuestCartModule;

  beforeEach(async () => {
    // Loaded per test on purpose: the memory fallback lives in module state, and a static import would share one
    // instance across every test, so a value left by an earlier test would leak into this one.
    vi.resetModules();
    items = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string): string | null => items.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        items.set(key, value);
      },
    });
    store = await import("./guest-cart.ts");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens a new line unticked, and adding the same product and unit sums the quantity", () => {
    const first = onlyLine(store.addGuestCartLine(PRODUCT, UNIT, 1));
    expect(first).toMatchObject({ productId: PRODUCT, productUnitId: UNIT, quantity: "1", selected: false });

    const summed = store.addGuestCartLine(PRODUCT, UNIT, 2);
    expect(summed.lines).toEqual([{ ...first, quantity: "3" }]);
  });

  it("keeps a different unit of the same product as its own line", () => {
    store.addGuestCartLine(PRODUCT, UNIT, 1);
    const cart = store.addGuestCartLine(PRODUCT, OTHER_UNIT, 1);
    expect(cart.lines.map((line) => line.productUnitId)).toEqual([UNIT, OTHER_UNIT]);
  });

  it("changes a quantity, and removes the line when the quantity is zero", () => {
    const line = onlyLine(store.addGuestCartLine(PRODUCT, UNIT, 1));
    expect(onlyLine(store.updateGuestCartLine(line.id, 4)).quantity).toBe("4");
    expect(store.updateGuestCartLine(line.id, 0).lines).toEqual([]);
  });

  it("ticks the named lines, or every line when no ids are given", () => {
    store.addGuestCartLine(PRODUCT, UNIT, 1);
    const cart = store.addGuestCartLine(OTHER_PRODUCT, UNIT, 1);
    const second = lineFor(cart, OTHER_PRODUCT);

    expect(store.setGuestCartSelection(true, [second.id]).lines.map((line) => line.selected)).toEqual([false, true]);
    expect(store.setGuestCartSelection(true).lines.every((line) => line.selected)).toBe(true);
    expect(store.setGuestCartSelection(false).lines.some((line) => line.selected)).toBe(false);
  });

  it("removes only the named lines and ignores ids it does not hold", () => {
    store.addGuestCartLine(PRODUCT, UNIT, 1);
    const cart = store.addGuestCartLine(OTHER_PRODUCT, UNIT, 1);
    const kept = lineFor(cart, OTHER_PRODUCT);

    expect(store.removeGuestCartLines([lineFor(cart, PRODUCT).id, "not-a-held-line"]).lines).toEqual([kept]);
  });

  it("keeps the cart and its ticks across a reload of the page", async () => {
    const line = onlyLine(store.addGuestCartLine(PRODUCT, UNIT, 2));
    store.setGuestCartSelection(true);

    // A reload loads the module again. A static import would return the instance this test already holds, so the
    // dynamic load is what makes this test prove that only the browser's storage carries the cart over.
    vi.resetModules();
    const reloaded = await import("./guest-cart.ts");
    expect(reloaded.readGuestCart().lines).toEqual([
      { id: line.id, productId: PRODUCT, productUnitId: UNIT, quantity: "2", selected: true },
    ]);
  });

  it("stores version 1 lines under the versioned key", () => {
    store.addGuestCartLine(PRODUCT, UNIT, 3);
    expect(JSON.parse(items.get(STORAGE_KEY) ?? "null")).toMatchObject({
      version: 1,
      lines: [{ productId: PRODUCT, productUnitId: UNIT, quantity: 3, selected: false }],
    });
  });

  it.each([
    ["not JSON", "{not json"],
    [
      "another version",
      JSON.stringify({
        version: 2,
        lines: [{ id: LINE, productId: PRODUCT, productUnitId: UNIT, quantity: 1, selected: true }],
      }),
    ],
    [
      "a line whose product is not an id",
      JSON.stringify({
        version: 1,
        lines: [{ id: LINE, productId: "not-an-id", productUnitId: UNIT, quantity: 1, selected: true }],
      }),
    ],
    [
      "more lines than the merge accepts",
      JSON.stringify({
        version: 1,
        lines: Array.from({ length: 201 }, () => ({
          id: LINE,
          productId: PRODUCT,
          productUnitId: UNIT,
          quantity: 1,
          selected: true,
        })),
      }),
    ],
  ])("reads a stored cart that is %s as empty, and rewrites it on the next change", (_label, raw) => {
    items.set(STORAGE_KEY, raw);
    expect(store.readGuestCart().lines).toEqual([]);
    expect(items.get(STORAGE_KEY)).toBe(raw);

    expect(store.addGuestCartLine(PRODUCT, UNIT, 1).lines).toHaveLength(1);
    expect(JSON.parse(items.get(STORAGE_KEY) ?? "null")).toMatchObject({
      version: 1,
      lines: [{ productId: PRODUCT }],
    });
  });

  it("refuses a line beyond the 200 the merge route accepts", () => {
    for (let index = 0; index < 200; index += 1) store.addGuestCartLine(newUuid(), UNIT, 1);

    expect(() => store.addGuestCartLine(newUuid(), UNIT, 1)).toThrow("tối đa 200");
    expect(store.readGuestCart().lines).toHaveLength(200);
  });

  it("keeps the cart in memory when localStorage refuses writes", () => {
    vi.stubGlobal("localStorage", {
      getItem: (): string | null => null,
      setItem: (): void => {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      },
    });

    const line = onlyLine(store.addGuestCartLine(PRODUCT, UNIT, 1));
    const ticked = store.setGuestCartSelection(true, [line.id]);
    expect(ticked.lines).toEqual([{ ...line, selected: true }]);
    expect(store.readGuestCart()).toEqual(ticked);
  });

  it("keeps the cart in memory when the browser has no localStorage at all", () => {
    vi.stubGlobal("localStorage", undefined);

    const line = onlyLine(store.addGuestCartLine(PRODUCT, UNIT, 1));
    expect(store.readGuestCart().lines).toEqual([line]);
  });
});
