import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import express from "express";
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createLogger } from "../../../logger.ts";
import type { SalesDatabase } from "../../../shared/infrastructure/database.ts";
import * as schema from "../../../shared/infrastructure/schema.ts";
import { IdempotencyKeyInUseError, SalesRepository } from "../../sales-repository.ts";
import { createSalesRouter } from "../../sales-routes.ts";
import {
  InsufficientStockError,
  InventoryRequestError,
  type InventoryReservations,
} from "../infrastructure/inventory-reservations.ts";
import { IDEMPOTENCY_KEY_TTL_MS, OrderStock } from "./order-stock.ts";

const migrationsFolder = fileURLToPath(new URL("../../../../drizzle/migrations", import.meta.url));
const httpFetch = globalThis.fetch.bind(globalThis);

/**
 * A repeated POST /orders with the same Idempotency-Key places one order, holds its stock once and answers the same
 * order. The engine is real PostgreSQL with the real migrations, because the uniqueness of the key is the guarantee.
 */
describe("order placement with an Idempotency-Key", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const repository = new SalesRepository({ db, pool: undefined } as unknown as SalesDatabase);
  const inventory = {
    reserve: vi.fn<(...args: unknown[]) => Promise<void>>(),
    release: vi.fn<(...args: unknown[]) => Promise<void>>(),
    consume: vi.fn<(...args: unknown[]) => Promise<void>>(),
    reservationStatus: vi.fn<(...args: unknown[]) => Promise<string | undefined>>(),
  };
  const orderStock = new OrderStock(
    repository,
    inventory as unknown as InventoryReservations,
    createLogger({ level: "silent" }),
  );

  const customer = "00000000-0000-4000-8000-00000000000a";
  const otherCustomer = "00000000-0000-4000-8000-00000000000e";
  const store = "00000000-0000-4000-8000-00000000000b";
  const product = "00000000-0000-4000-8000-00000000000c";
  const unit = "00000000-0000-4000-8000-00000000000d";
  const key = "checkout-attempt-1";

  const body = (quantity = 2) => ({
    selectedStoreId: store,
    fulfillmentType: "pickup",
    paymentMethod: "sepay_qr",
    lines: [{ productId: product, productUnitId: unit, quantity }],
  });
  const catalogResponder = async (url: string): Promise<Response> => {
    const payload = String(url).includes("/pricing/active")
      ? { productId: product, productUnitId: unit, unitPrice: "45000", currency: "VND" }
      : { id: product, name: "Paracetamol" };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  };
  const catalog = vi.fn(catalogResponder);

  let server: Server | undefined;
  let url = "";

  const startServer = async () => {
    const app = express();
    app.use(express.json());
    app.use(
      createSalesRouter(repository, {
        catalogServiceUrl: "http://catalog.test",
        inventoryServiceUrl: "http://inventory.test",
        identityServiceUrl: "http://identity.test",
        orderStock,
      }),
    );
    const started = createServer(app);
    await new Promise<void>((resolve) => started.listen(0, "127.0.0.1", resolve));
    const address = started.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind to a port");
    server = started;
    url = `http://127.0.0.1:${address.port}`;
  };

  const post = (payload: unknown, headers: Record<string, string> = {}, shopper = customer) =>
    httpFetch(`${url}/orders`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Actor-Id": shopper, ...headers },
      body: JSON.stringify(payload),
    });
  const withKey = (value: string) => ({ "Idempotency-Key": value });

  const readOrder = async (response: Response) => (await response.json()) as { id: string };
  const countOrders = async () => (await db.select().from(schema.orders)).length;
  const countOrderCreatedEvents = async () =>
    (await db.select().from(schema.outboxMessages)).filter((message) => message.eventType === "sales.order.created.v1")
      .length;

  beforeAll(async () => {
    await migrate(db, { migrationsFolder });
  });

  beforeEach(async () => {
    vi.stubEnv("INTERNAL_SERVICE_SECRET", "test-internal-secret");
    await client.exec(
      "TRUNCATE orders, order_lines, order_delivery_snapshots, outbox_messages, order_idempotency_keys CASCADE;",
    );
    catalog.mockClear();
    vi.stubGlobal("fetch", catalog);
    inventory.reserve.mockReset().mockResolvedValue(undefined);
    inventory.release.mockReset().mockResolvedValue(undefined);
    inventory.consume.mockReset().mockResolvedValue(undefined);
    inventory.reservationStatus.mockReset().mockResolvedValue(undefined);
    await startServer();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await new Promise<void>((resolve, reject) => server?.close((error) => (error ? reject(error) : resolve())));
    server = undefined;
  });

  afterAll(async () => {
    await client.close();
  });

  it("answers a repeat of the same key and body with the original order, without a second order or hold", async () => {
    const first = await post(body(), withKey(key));
    const firstOrder = await readOrder(first);
    const catalogCallsAfterFirst = catalog.mock.calls.length;

    const repeat = await post(body(), withKey(key));
    const repeatOrder = await readOrder(repeat);

    expect(first.status).toBe(201);
    expect(repeat.status).toBe(first.status);
    expect(repeatOrder).toEqual(firstOrder);
    expect(catalog.mock.calls.length).toBe(catalogCallsAfterFirst);
    expect(inventory.reserve).toHaveBeenCalledTimes(1);
    expect(await countOrders()).toBe(1);
    expect(await countOrderCreatedEvents()).toBe(1);
  });

  it("refuses a key that is reused with a different body, and places nothing", async () => {
    const first = await post(body(2), withKey(key));
    const reused = await post(body(5), withKey(key));

    expect(first.status).toBe(201);
    expect(reused.status).toBe(422);
    expect(await reused.json()).toMatchObject({ code: "idempotency_key_reuse" });
    expect(inventory.reserve).toHaveBeenCalledTimes(1);
    expect(await countOrders()).toBe(1);
  });

  it("gives a repeat the same answer whatever order the body's fields were sent in", async () => {
    const first = await post(body(), withKey(key));
    const reordered = await post(
      {
        lines: [{ quantity: 2, productUnitId: unit, productId: product }],
        paymentMethod: "sepay_qr",
        fulfillmentType: "pickup",
        selectedStoreId: store,
      },
      withKey(key),
    );

    expect(reordered.status).toBe(201);
    expect((await readOrder(reordered)).id).toBe((await readOrder(first)).id);
    expect(await countOrders()).toBe(1);
  });

  it("places one order when concurrent duplicates race on the same key", async () => {
    const answers = await Promise.all(Array.from({ length: 5 }, () => post(body(), withKey(key))));
    const orders = await Promise.all(answers.map(readOrder));

    expect(answers.map((answer) => answer.status)).toEqual([201, 201, 201, 201, 201]);
    expect(new Set(orders.map((order) => order.id)).size).toBe(1);
    expect(inventory.reserve).toHaveBeenCalledTimes(1);
    expect(await countOrders()).toBe(1);
  });

  it("answers the order that owns the key when a duplicate reaches the insert after the winner wrote it", async () => {
    const winner = await readOrder(await post(body(), withKey(key)));
    // The duplicate read the key before the winner wrote it, so it gets past the early check and loses at the insert.
    vi.spyOn(repository, "getOrderIdempotencyKey").mockResolvedValueOnce(undefined);

    const loser = await post(body(), withKey(key));

    expect(loser.status).toBe(201);
    expect((await readOrder(loser)).id).toBe(winner.id);
    expect(inventory.reserve).toHaveBeenCalledTimes(1);
    expect(await countOrders()).toBe(1);
  });

  it("writes the key in the order's transaction, so a second insert under the same key rolls back", async () => {
    const input = {
      customerId: customer,
      selectedStoreId: store,
      fulfillmentType: "pickup" as const,
      subtotal: 90000,
      deliveryFee: 0,
      currency: "VND",
      lines: [
        {
          productId: product,
          productUnitId: unit,
          productNameSnapshot: "Paracetamol",
          unitPriceSnapshot: 45000,
          quantity: 2,
        },
      ],
      idempotency: { key: "transactional-key", requestHash: "a".repeat(64) },
    };
    const first = await repository.createOrder(input);

    await expect(repository.createOrder(input)).rejects.toBeInstanceOf(IdempotencyKeyInUseError);

    expect(await countOrders()).toBe(1);
    expect(await countOrderCreatedEvents()).toBe(1);
    await expect(repository.getOrderIdempotencyKey(customer, "transactional-key")).resolves.toEqual({
      requestHash: "a".repeat(64),
      orderId: first.id,
    });
  });

  it("frees the key of an order whose stock was refused, so a retry with the same key places a new order", async () => {
    inventory.reserve.mockRejectedValueOnce(new InsufficientStockError());

    const refused = await post(body(), withKey(key));
    const retry = await post(body(), withKey(key));

    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: "insufficient_stock" });
    expect(retry.status).toBe(201);
    expect(inventory.reserve).toHaveBeenCalledTimes(2);
    expect(await countOrders()).toBe(2);
  });

  it("frees the key when inventory cannot be reached either, so the cancelled order is never replayed as placed", async () => {
    inventory.reserve.mockRejectedValueOnce(new InventoryRequestError("down"));

    const failed = await post(body(), withKey(key));

    expect(failed.status).toBe(503);
    const [cancelled] = await db.select().from(schema.orders);
    expect(cancelled?.status).toBe("Cancelled");
    await expect(repository.getOrderIdempotencyKey(customer, key)).resolves.toBeUndefined();
  });

  it("scopes a key to the shopper who sent it", async () => {
    const mine = await readOrder(await post(body(), withKey(key)));

    const theirs = await post(body(), withKey(key), otherCustomer);

    expect(theirs.status).toBe(201);
    expect((await readOrder(theirs)).id).not.toBe(mine.id);
    expect(await countOrders()).toBe(2);
  });

  it("places a new order for every request without a key, as before", async () => {
    const first = await post(body());
    const second = await post(body());

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(await countOrders()).toBe(2);
  });

  it.each([["blank", "   "]])("refuses a %s Idempotency-Key", async (_label, value) => {
    const response = await post(body(), withKey(value));

    expect(response.status).toBe(400);
    expect(await countOrders()).toBe(0);
  });

  it("forgets keys older than 24 hours in the sweep, and keeps the newer ones", async () => {
    const old = await readOrder(await post(body(), withKey("old-key")));
    const recent = await readOrder(await post(body(), withKey("recent-key")));
    const dayAgo = new Date(Date.now() - IDEMPOTENCY_KEY_TTL_MS - 60_000);
    await db
      .update(schema.orderIdempotencyKeys)
      .set({ createdAt: dayAgo })
      .where(eq(schema.orderIdempotencyKeys.key, "old-key"));

    await orderStock.sweep();

    await expect(repository.getOrderIdempotencyKey(customer, "old-key")).resolves.toBeUndefined();
    await expect(repository.getOrderIdempotencyKey(customer, "recent-key")).resolves.toMatchObject({
      orderId: recent.id,
    });
    expect(old.id).not.toBe(recent.id);
  });
});
