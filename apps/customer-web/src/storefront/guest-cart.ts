import { z } from "zod";

import type { Cart } from "../customer-api.ts";
import { newUuid } from "./ids.ts";

/**
 * The cart of a shopper who is not signed in. It lives in this browser only, so no request reaches the sales service
 * until the shopper signs in, and then `getCart` hands the lines over once. Only ids, quantities and ticks are kept:
 * prices and stock stay the server's, so a copy here can never change what the shopper pays.
 */

/** The version is part of the key too, so a later shape starts from an empty cart instead of misreading old data. */
export const GUEST_CART_STORAGE_KEY = "pharmacy.guest-cart.v1";
/** The limit the merge route applies, so a stored cart can always be sent in one request. */
export const GUEST_CART_MAX_LINES = 200;

const storedLineSchema = z.object({
  id: z.uuid(),
  productId: z.uuid(),
  productUnitId: z.uuid(),
  quantity: z.number().positive(),
  selected: z.boolean(),
});
const storedCartSchema = z.object({
  version: z.literal(1),
  lines: z.array(storedLineSchema).max(GUEST_CART_MAX_LINES),
});

export type GuestLine = z.infer<typeof storedLineSchema>;
type GuestCart = z.infer<typeof storedCartSchema>;
type NewLine = { productId: string; productUnitId: string; quantity: number };

const emptyCart = (): GuestCart => ({ version: 1, lines: [] });

/** A line the shopper is looking at can disappear when another tab changes the cart; the caller then re-reads. */
const LINE_GONE_MESSAGE = "Sản phẩm này không còn trong giỏ. Hãy tải lại trang.";

// Pure transformations of the stored value. Every one returns a new value and leaves the input alone.

/** Adds to the line that already holds this product and unit, or opens a new line that is not ticked yet. */
const addLine = (cart: GuestCart, input: NewLine, id: string): GuestCart => {
  const existing = cart.lines.find(
    (line) => line.productId === input.productId && line.productUnitId === input.productUnitId,
  );
  if (existing) {
    return {
      ...cart,
      lines: cart.lines.map((line) =>
        line.id === existing.id ? { ...line, quantity: line.quantity + input.quantity } : line,
      ),
    };
  }
  if (cart.lines.length >= GUEST_CART_MAX_LINES) {
    throw new Error(`Giỏ thuốc chỉ chứa tối đa ${GUEST_CART_MAX_LINES} sản phẩm. Hãy đặt hoặc xoá bớt trước khi thêm.`);
  }
  return {
    ...cart,
    lines: [
      ...cart.lines,
      {
        id,
        productId: input.productId,
        productUnitId: input.productUnitId,
        quantity: input.quantity,
        selected: false,
      },
    ],
  };
};

/** A quantity of zero (or less) takes the line out, the same as the sales service does. */
const setQuantity = (cart: GuestCart, lineId: string, quantity: number): GuestCart => {
  if (!cart.lines.some((line) => line.id === lineId)) throw new Error(LINE_GONE_MESSAGE);
  if (quantity <= 0) return removeLines(cart, [lineId]);
  return {
    ...cart,
    lines: cart.lines.map((line) => (line.id === lineId ? { ...line, quantity } : line)),
  };
};

/** Unknown ids are ignored, so removing a line twice (two tabs, a retry) leaves the cart as it was. */
const removeLines = (cart: GuestCart, lineIds: readonly string[]): GuestCart => {
  const removed = new Set(lineIds);
  return { ...cart, lines: cart.lines.filter((line) => !removed.has(line.id)) };
};

/** Ticks or unticks the named lines, or every line when no ids are given. */
const setSelection = (cart: GuestCart, selected: boolean, lineIds?: readonly string[]): GuestCart => {
  const chosen = lineIds ? new Set(lineIds) : undefined;
  return {
    ...cart,
    lines: cart.lines.map((line) => (!chosen || chosen.has(line.id) ? { ...line, selected } : line)),
  };
};

/** The customer-web cart shape: the same fields as the server's, with the quantity as the server sends it. */
const toCart = (cart: GuestCart): Cart => ({
  id: "guest-local",
  lines: cart.lines.map((line) => ({
    id: line.id,
    productId: line.productId,
    productUnitId: line.productUnitId,
    quantity: String(line.quantity),
    selected: line.selected,
  })),
});

// Storage. Blocked storage, private browsing and a full quota all make localStorage throw; the cart then lives in
// memory for the life of this page. A reload loses it in that case, which is what a shopper with no storage expects.

let memoryRaw: string | null = null;
let storageUsable = true;

/** localStorage, or undefined once it has failed. A tab that has seen a failure never touches storage again. */
const usableStorage = (): Storage | undefined => {
  if (!storageUsable) return undefined;
  try {
    const storage: Storage | undefined = globalThis.localStorage;
    if (storage) return storage;
  } catch {
    // Reading the property itself throws when the browser blocks site storage.
  }
  storageUsable = false;
  return undefined;
};

const readRaw = (): string | null => {
  const storage = usableStorage();
  if (!storage) return memoryRaw;
  try {
    return storage.getItem(GUEST_CART_STORAGE_KEY);
  } catch {
    storageUsable = false;
    return memoryRaw;
  }
};

const writeRaw = (raw: string): void => {
  const storage = usableStorage();
  if (storage) {
    try {
      storage.setItem(GUEST_CART_STORAGE_KEY, raw);
      return;
    } catch {
      // A full quota or a private window refuses the write; this copy is kept for the page instead.
      storageUsable = false;
    }
  }
  memoryRaw = raw;
};

/** A value that is not JSON, not this version, or not a valid cart reads as empty. It is rewritten on the next change. */
const readCart = (): GuestCart => {
  const raw = readRaw();
  if (raw === null) return emptyCart();
  try {
    const parsed = storedCartSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : emptyCart();
  } catch {
    return emptyCart();
  }
};

const commit = (cart: GuestCart): Cart => {
  writeRaw(JSON.stringify(cart));
  return toCart(cart);
};

/** The lines the account cart has not received yet. They are sent once at sign-in and removed only after the server accepts them. */
export const storedGuestLines = (): GuestLine[] => readCart().lines;

export const readGuestCart = (): Cart => toCart(readCart());

export const addGuestCartLine = (productId: string, productUnitId: string, quantity: number): Cart =>
  commit(addLine(readCart(), { productId, productUnitId, quantity }, newUuid()));

export const updateGuestCartLine = (lineId: string, quantity: number): Cart =>
  commit(setQuantity(readCart(), lineId, quantity));

export const removeGuestCartLines = (lineIds: readonly string[]): Cart => commit(removeLines(readCart(), lineIds));

export const setGuestCartSelection = (selected: boolean, lineIds?: readonly string[]): Cart =>
  commit(setSelection(readCart(), selected, lineIds));
