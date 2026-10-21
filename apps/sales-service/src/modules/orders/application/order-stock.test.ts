import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createLogger } from "../../../logger.ts";
import type { SalesDatabase } from "../../../shared/infrastructure/database.ts";
import * as schema from "../../../shared/infrastructure/schema.ts";
import { SalesRepository } from "../../sales-repository.ts";
import {
  InsufficientStockError,
  InventoryRequestError,
  type InventoryReservations,
} from "../infrastructure/inventory-reservations.ts";
import { CASH_ORDER_TTL_MS, OrderStock, QR_ORDER_TTL_MS } from "./order-stock.ts";

const migrationsFolder = fileURLToPath(new URL("../../../../drizzle/migrations", import.meta.url));

/** Inventory as the order sees it: a hold is taken, given back or consumed once, and the service can be down. */
class FakeInventory {
  public readonly holds = new Map<string, "held" | "released" | "consumed">();
  public down = false;
  public shortage = false;

  public reserve(id: string): Promise<void> {
    if (this.down) return Promise.reject(new InventoryRequestError("inventory is down"));
    if (this.shortage) return Promise.reject(new InsufficientStockError());
    this.holds.set(id, "held");
    return Promise.resolve();
  }
  public release(id: string): Promise<void> {
    if (this.down) return Promise.reject(new InventoryRequestError("inventory is down"));
    if (this.holds.get(id) === "held") this.holds.set(id, "released");
    return Promise.resolve();
  }
  public consume(id: string): Promise<void> {
    if (this.down) return Promise.reject(new InventoryRequestError("inventory is down"));
    if (this.holds.get(id) === "held") this.holds.set(id, "consumed");
    return Promise.resolve();
  }
}

/**
 * An online order must never keep goods nobody set aside, and must never keep a hold nobody will use. The engine is
 * real PostgreSQL with the real migrations, because the expiry rules live in one conditional UPDATE.
 */
describe("OrderStock", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const repository = new SalesRepository({ db, pool: undefined } as unknown as SalesDatabase);
  const inventory = new FakeInventory();
  const orderStock = new OrderStock(
    repository,
    inventory as unknown as InventoryReservations,
    createLogger({ level: "silent" }),
  );

  const customer = "00000000-0000-4000-8000-00000000000a";
  const store = "00000000-0000-4000-8000-00000000000b";
  const product = "00000000-0000-4000-8000-00000000000c";
  const unit = "00000000-0000-4000-8000-00000000000d";
  const now = new Date("2026-10-21T12:00:00.000Z");
  const minutesAgo = (minutes: number): Date => new Date(now.getTime() - minutes * 60_000);

  const place = async (paymentMethod?: string) => {
    const order = await repository.createOrder({
      customerId: customer,
      selectedStoreId: store,
      fulfillmentType: "pickup",
      subtotal: 90000,
      deliveryFee: 0,
      currency: "VND",
      paymentMethod,
      lines: [
        {
          productId: product,
          productUnitId: unit,
          productNameSnapshot: "Paracetamol",
          unitPriceSnapshot: 45000,
          quantity: 2,
        },
      ],
    });
    return order.id;
  };
  const row = async (id: string) => {
    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, id));
    return { status: order?.status, stockHold: order?.stockHold };
  };
  const age = (id: string, createdAt: Date) =>
    db.update(schema.orders).set({ createdAt }).where(eq(schema.orders.id, id));

  beforeAll(async () => {
    await migrate(db, { migrationsFolder });
  });

  beforeEach(async () => {
    await client.exec("TRUNCATE orders, order_lines, order_delivery_snapshots, outbox_messages CASCADE;");
    inventory.holds.clear();
    inventory.down = false;
    inventory.shortage = false;
  });

  afterAll(async () => {
    await client.close();
  });

  it("holds the stock of a placed order against its store", async () => {
    const id = await place();

    await orderStock.hold({ id, selectedStoreId: store }, [{ productId: product, quantity: 2 }]);

    expect(inventory.holds.get(id)).toBe("held");
    await expect(row(id)).resolves.toEqual({ status: "Pending", stockHold: "held" });
  });

  it("cancels the order, and tells the shopper why, when the store cannot cover it", async () => {
    const id = await place();
    inventory.shortage = true;

    await expect(
      orderStock.hold({ id, selectedStoreId: store }, [{ productId: product, quantity: 2 }]),
    ).rejects.toBeInstanceOf(InsufficientStockError);

    await expect(row(id)).resolves.toEqual({ status: "Cancelled", stockHold: "released" });
  });

  it("gives back a hold that inventory made but could not confirm, once inventory answers again", async () => {
    const id = await place();
    inventory.holds.set(id, "held");
    inventory.down = true;

    await expect(orderStock.hold({ id, selectedStoreId: store }, [])).rejects.toBeInstanceOf(InventoryRequestError);
    await expect(row(id)).resolves.toEqual({ status: "Cancelled", stockHold: "held" });

    inventory.down = false;
    await orderStock.sweep(now);

    await expect(row(id)).resolves.toEqual({ status: "Cancelled", stockHold: "released" });
    expect(inventory.holds.get(id)).toBe("released");
  });

  it("expires an unpaid QR order after the QR window and frees its stock", async () => {
    const stale = await place("sepay_qr");
    const unnamed = await place();
    const fresh = await place("sepay_qr");
    for (const id of [stale, unnamed, fresh]) inventory.holds.set(id, "held");
    await age(stale, minutesAgo(QR_ORDER_TTL_MS / 60_000 + 1));
    await age(unnamed, minutesAgo(QR_ORDER_TTL_MS / 60_000 + 1));
    await age(fresh, minutesAgo(QR_ORDER_TTL_MS / 60_000 - 1));

    await orderStock.sweep(now);

    await expect(row(stale)).resolves.toEqual({ status: "Cancelled", stockHold: "released" });
    await expect(row(unnamed)).resolves.toEqual({ status: "Cancelled", stockHold: "released" });
    await expect(row(fresh)).resolves.toEqual({ status: "Pending", stockHold: "held" });
    expect(inventory.holds.get(fresh)).toBe("held");
  });

  it("lets an order paid on delivery wait much longer than a QR order", async () => {
    const waiting = await place("cash_on_delivery");
    const abandoned = await place("cash_on_delivery");
    await age(waiting, minutesAgo((QR_ORDER_TTL_MS / 60_000) * 4));
    await age(abandoned, minutesAgo(CASH_ORDER_TTL_MS / 60_000 + 1));

    await orderStock.sweep(now);

    await expect(row(waiting)).resolves.toMatchObject({ status: "Pending" });
    await expect(row(abandoned)).resolves.toMatchObject({ status: "Cancelled" });
  });

  it("never expires an order that was paid, or one from before stock was held", async () => {
    const paid = await place("sepay_qr");
    const legacy = await place("sepay_qr");
    await db
      .update(schema.orders)
      .set({ paymentStatus: "Paid", status: "Confirmed" })
      .where(eq(schema.orders.id, paid));
    await db.update(schema.orders).set({ stockHold: "none" }).where(eq(schema.orders.id, legacy));
    await age(paid, minutesAgo(600));
    await age(legacy, minutesAgo(600));

    await orderStock.sweep(now);

    await expect(row(paid)).resolves.toEqual({ status: "Confirmed", stockHold: "held" });
    await expect(row(legacy)).resolves.toEqual({ status: "Pending", stockHold: "none" });
  });

  it("takes the goods off the shelf once, and leaves an order from before holds alone", async () => {
    const id = await place();
    const legacy = await place();
    await db.update(schema.orders).set({ stockHold: "none" }).where(eq(schema.orders.id, legacy));
    inventory.holds.set(id, "held");
    inventory.holds.set(legacy, "held");

    await orderStock.consume(id);
    await orderStock.consume(id);
    await orderStock.consume(legacy);

    expect(inventory.holds.get(id)).toBe("consumed");
    expect(inventory.holds.get(legacy)).toBe("held");
    await expect(row(id)).resolves.toMatchObject({ stockHold: "consumed" });
  });

  it("keeps the hold when inventory cannot hand the goods over, so the hand over can be retried", async () => {
    const id = await place();
    inventory.holds.set(id, "held");
    inventory.down = true;

    await expect(orderStock.consume(id)).rejects.toBeInstanceOf(InventoryRequestError);

    await expect(row(id)).resolves.toMatchObject({ stockHold: "held" });
  });

  it("cancels a refunded order that was not handed over and frees its stock", async () => {
    const id = await place();
    inventory.holds.set(id, "held");
    await db.update(schema.orders).set({ status: "Confirmed" }).where(eq(schema.orders.id, id));

    await orderStock.cancelRefunded({ id, status: "Confirmed" });

    await expect(row(id)).resolves.toEqual({ status: "Cancelled", stockHold: "released" });
  });

  it("leaves a refunded order that is already ready or out to the staff", async () => {
    const ready = await place();
    inventory.holds.set(ready, "held");
    await db.update(schema.orders).set({ status: "Ready" }).where(eq(schema.orders.id, ready));

    await orderStock.cancelRefunded({ id: ready, status: "Ready" });

    await expect(row(ready)).resolves.toEqual({ status: "Ready", stockHold: "held" });
    expect(inventory.holds.get(ready)).toBe("held");
  });
});
