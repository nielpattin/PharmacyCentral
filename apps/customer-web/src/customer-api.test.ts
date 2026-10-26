import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { forShopper, type Cart } from "./customer-api.ts";
import type * as CustomerApi from "./customer-api.ts";

describe("forShopper", () => {
  it("loads a shopper's own rows", async () => {
    const load = vi.fn(async () => [{ id: "order-1" }]);
    await expect(forShopper({ actorType: "customer" }, load)).resolves.toEqual([{ id: "order-1" }]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("never asks the sales service for a staff session, which would answer every shopper's rows", async () => {
    const load = vi.fn(async () => [{ id: "someone-elses-order" }]);
    await expect(forShopper({ actorType: "employee" }, load)).resolves.toEqual([]);
    await expect(forShopper({ actorType: "system" }, load)).resolves.toEqual([]);
    expect(load).not.toHaveBeenCalled();
  });

  it("answers an empty list while the account is still unknown", async () => {
    const load = vi.fn(async () => [{ id: "order-1" }]);
    await expect(forShopper(undefined, load)).resolves.toEqual([]);
    expect(load).not.toHaveBeenCalled();
  });
});

const STORAGE_KEY = "pharmacy.guest-cart.v1";
const PRODUCT = "6b1d2f3a-4c5e-4f60-8a71-92b3c4d5e6f7";
const OTHER_PRODUCT = "7c2e3f4a-5d6f-4a71-9b82-a3c4d5e6f708";
const UNIT = "8d3e4f5a-6e7f-4b82-8c93-b4d5e6f70819";
const OTHER_UNIT = "9e4f5a6b-7f80-4c93-9da4-c5e6f7081920";
const LINE_A = "0a1b2c3d-4e5f-4a60-8b71-c2d3e4f50617";
const LINE_B = "1b2c3d4e-5f60-4b71-8c82-d3e4f5061728";
const ACCOUNT_LINE = "2c3d4e5f-6071-4828-8e93-f40617283940";

const SEEDED_LINE_A = { id: LINE_A, productId: PRODUCT, productUnitId: UNIT, quantity: 2, selected: true };
const SEEDED_LINE_B = { id: LINE_B, productId: OTHER_PRODUCT, productUnitId: OTHER_UNIT, quantity: 1, selected: false };

const shopper = {
  id: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d",
  actorType: "customer",
  displayName: "Lan",
  email: "lan@example.com",
  phoneNumber: null,
};
const unauthenticated = { title: "Authentication required", status: 401, code: "unauthenticated" };
const accountCart: Cart = {
  id: "account-cart",
  lines: [{ id: ACCOUNT_LINE, productId: PRODUCT, productUnitId: UNIT, quantity: "2", selected: true }],
};

/** The browser's cart as it is stored before the shopper signs in. */
const storedCart = (lines: object[]): string => JSON.stringify({ version: 1, lines });

const onlyLine = (cart: Cart) => {
  const [line] = cart.lines;
  if (cart.lines.length !== 1 || !line) throw new Error(`expected one line, found ${cart.lines.length}`);
  return line;
};

type Recorded = { method: string; url: string; body: unknown };

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/**
 * Stands in for the identity and sales services as far as the cart calls can tell. It records every request, so a
 * test can assert what reached the server and what stayed in the browser. A cart request is refused until the session
 * probe has answered, so a cart call that does not wait for the session fails the test.
 */
const installFakeServer = (options: { signedIn: boolean; mergeStatus?: number; prescriptionOnly?: string[] }) => {
  let signedIn = options.signedIn;
  let probed = false;
  const requests: Recorded[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? "GET";
    const rawBody = init?.body;
    const body: unknown = typeof rawBody === "string" ? JSON.parse(rawBody) : undefined;
    requests.push({ method, url, body });

    if (url.startsWith("/api/carts") && !probed) {
      throw new Error(`Cart request sent before the session was known: ${method} ${url}`);
    }
    if (url === "/api/auth/csrf") return new Response(null, { status: 204 });
    if (url === "/api/auth/me") {
      probed = true;
      return signedIn ? jsonResponse(shopper) : jsonResponse(unauthenticated, 401);
    }
    if (url === "/api/auth/login") {
      signedIn = true;
      return jsonResponse(shopper);
    }
    if (url === "/api/auth/logout") {
      signedIn = false;
      return new Response(null, { status: 204 });
    }
    // The identity contexts are not what these tests measure, so the service refuses them and the cart calls go on.
    if (url === "/api/auth/context") return jsonResponse(unauthenticated, 401);
    if (url === "/api/carts/merge") {
      const status = options.mergeStatus ?? 200;
      return status === 200 ? jsonResponse(accountCart) : jsonResponse({ title: "Merge refused", status }, status);
    }
    if (url === "/api/carts" && method === "GET") return jsonResponse(accountCart);
    const productId = /^\/api\/products\/([^/]+)$/.exec(url)?.[1];
    if (productId && method === "GET")
      return jsonResponse({
        id: productId,
        prescriptionRequired: options.prescriptionOnly?.includes(productId) ?? false,
      });
    throw new Error(`Unexpected request: ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    requests,
    requestsTo: (url: string): Recorded[] => requests.filter((request) => request.url === url),
    cartRequests: (): Recorded[] => requests.filter((request) => request.url.startsWith("/api/carts")),
  };
};

describe("cart calls", () => {
  let api: typeof CustomerApi;
  let items: Map<string, string>;

  beforeEach(async () => {
    // Loaded per test on purpose: the session answer and the merge in flight are module state, and a static import
    // would carry one test's signed-in answer into the next.
    vi.resetModules();
    items = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string): string | null => items.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        items.set(key, value);
      },
    });
    api = await import("./customer-api.ts");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps a signed-out cart in the browser, with no /api/carts request", async () => {
    const server = installFakeServer({ signedIn: false });

    const line = onlyLine(await api.addCartLine(PRODUCT, UNIT, 1));
    await api.setCartSelection(true, [line.id]);
    await api.updateCartLine(line.id, 3);
    expect(await api.getCart()).toMatchObject({ lines: [{ id: line.id, quantity: "3", selected: true }] });
    expect(await api.updateCartLine(line.id, 0)).toMatchObject({ lines: [] });

    expect(server.cartRequests()).toEqual([]);
    expect(server.requestsTo("/api/auth/csrf")).toHaveLength(1);
  });

  it("waits for the session before choosing where the cart lives", async () => {
    const server = installFakeServer({ signedIn: true });
    items.set(STORAGE_KEY, storedCart([SEEDED_LINE_A]));

    // The read starts while the session probe is still in flight; the fake server refuses it if it reaches /api/carts
    // before the probe has answered.
    await expect(api.getCart()).resolves.toEqual(accountCart);
    expect(server.requestsTo("/api/carts/merge")).toHaveLength(1);
    expect(server.requestsTo("/api/auth/csrf")).toHaveLength(1);
  });

  it("sends the browser's lines once at sign-in and clears them after the server accepts them", async () => {
    items.set(STORAGE_KEY, storedCart([SEEDED_LINE_A, SEEDED_LINE_B]));
    const server = installFakeServer({ signedIn: true });

    await expect(api.getCart()).resolves.toEqual(accountCart);
    expect(server.requestsTo("/api/carts/merge").map((request) => request.body)).toEqual([
      {
        lines: [
          { productId: PRODUCT, productUnitId: UNIT, quantity: 2, selected: true },
          { productId: OTHER_PRODUCT, productUnitId: OTHER_UNIT, quantity: 1, selected: false },
        ],
      },
    ]);
    expect(JSON.parse(items.get(STORAGE_KEY) ?? "null")).toMatchObject({ lines: [] });

    await api.getCart();
    expect(server.requestsTo("/api/carts/merge")).toHaveLength(1);
  });

  it("sends the lines once when two reads start together", async () => {
    items.set(STORAGE_KEY, storedCart([SEEDED_LINE_A]));
    const server = installFakeServer({ signedIn: true });

    await expect(Promise.all([api.getCart(), api.getCart()])).resolves.toEqual([accountCart, accountCart]);
    expect(server.requestsTo("/api/carts/merge")).toHaveLength(1);
  });

  it("keeps the lines and still returns the account cart when the merge fails, then retries on the next read", async () => {
    items.set(STORAGE_KEY, storedCart([SEEDED_LINE_A, SEEDED_LINE_B]));
    const server = installFakeServer({ signedIn: true, mergeStatus: 500 });

    await expect(api.getCart()).resolves.toEqual(accountCart);
    expect(JSON.parse(items.get(STORAGE_KEY) ?? "null")).toMatchObject({
      lines: [{ productId: PRODUCT }, { productId: OTHER_PRODUCT }],
    });

    await api.getCart();
    expect(server.requestsTo("/api/carts/merge")).toHaveLength(2);
  });

  it("stops reaching /api/carts after sign-out, and keeps the cart in the browser", async () => {
    const server = installFakeServer({ signedIn: true });
    await api.getCart();
    await api.logoutCustomer();
    const cartRequestsBeforeSignedOut = server.cartRequests().length;

    await api.addCartLine(PRODUCT, UNIT, 1);
    const cart = await api.getCart();

    expect(server.cartRequests()).toHaveLength(cartRequestsBeforeSignedOut);
    expect(cart.lines).toMatchObject([{ productId: PRODUCT, productUnitId: UNIT, quantity: "1", selected: false }]);
  });

  it("sends what the browser kept while signed out once the shopper signs in", async () => {
    const server = installFakeServer({ signedIn: false });
    await api.addCartLine(PRODUCT, UNIT, 1);
    expect(server.cartRequests()).toEqual([]);

    await api.loginCustomer("lan@example.com", "passphrase-123");

    await expect(api.getCart()).resolves.toEqual(accountCart);
    expect(server.requestsTo("/api/carts/merge").map((request) => request.body)).toEqual([
      { lines: [{ productId: PRODUCT, productUnitId: UNIT, quantity: 1, selected: false }] },
    ]);
  });
  it("refuses a prescription-only product for a signed-out shopper and stores nothing", async () => {
    const server = installFakeServer({ signedIn: false, prescriptionOnly: [PRODUCT] });

    await expect(api.addCartLine(PRODUCT, UNIT, 1)).rejects.toMatchObject({
      status: 409,
      code: "prescription_required",
    });

    expect(server.cartRequests()).toEqual([]);
    expect(await api.getCart()).toMatchObject({ lines: [] });
  });
});
