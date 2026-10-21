import { PGlite } from "@electric-sql/pglite";
import { context, trace, type SpanContext } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createLogger } from "../logger.ts";
import type { InventoryDatabase } from "../shared/infrastructure/database.ts";
import * as schema from "../shared/infrastructure/schema.ts";
import { InventoryOutboxPublisher } from "./outbox-publisher.ts";

const broker = vi.hoisted(() => ({
  /** Event ids the broker refuses to confirm, and how many more times it refuses each. */
  refusals: new Map<string, number>(),
  /** Every publish the broker saw, in order, with whether it confirmed it. */
  seen: [] as Array<{ eventId: string; confirmed: boolean }>,
  /** The span context that was active inside each publish call. */
  activeSpans: [] as Array<{ eventId: string; spanContext: SpanContext | undefined }>,
}));

vi.mock("amqplib", () => {
  const channel = () => ({
    on: () => undefined,
    assertExchange: async () => undefined,
    publish: (_exchange: string, _key: string, content: Buffer, _options: unknown, done: (error?: Error) => void) => {
      const { eventId } = JSON.parse(content.toString()) as { eventId: string };
      broker.activeSpans.push({ eventId, spanContext: trace.getSpanContext(context.active()) });
      const remaining = broker.refusals.get(eventId) ?? 0;
      broker.seen.push({ eventId, confirmed: remaining === 0 });
      if (remaining > 0) {
        broker.refusals.set(eventId, remaining - 1);
        done(new Error("nack"));
      } else done();
      return true;
    },
  });
  const connection = () => ({
    on: () => undefined,
    close: async () => undefined,
    createConfirmChannel: async () => channel(),
  });
  return { default: { connect: async () => connection() } };
});

const migrationsFolder = fileURLToPath(new URL("../../drizzle/migrations", import.meta.url));

/**
 * The outbox row is the only record that an event still has to go out, so it must stay unpublished until the broker
 * confirmed the message, and a refused message must not hold back the rows that were already confirmed.
 */
describe("InventoryOutboxPublisher", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });

  beforeAll(async () => {
    await migrate(db, { migrationsFolder });
  });

  afterAll(async () => {
    await client.close();
  });

  it("marks a row published only once the broker confirmed it, and sends a refused one again", async () => {
    const [first, second, third] = await db
      .insert(schema.outboxMessages)
      .values(
        [1, 2, 3].map((n) => ({
          eventType: "inventory.availability.changed.v1",
          schemaVersion: "1",
          payload: JSON.stringify({ productId: `p${n}`, siteId: "s", inStock: true }),
          occurredAt: new Date(2026, 0, 1, 0, 0, n),
        })),
      )
      .returning();
    if (!first || !second || !third) throw new Error("outbox rows were not created");
    broker.refusals.set(second.id, 1);
    const publisher = new InventoryOutboxPublisher(
      { db, pool: undefined } as unknown as InventoryDatabase,
      createLogger({ level: "silent" }),
      "amqp://broker.test",
    );

    publisher.start();
    await vi.waitFor(
      async () => {
        const rows = await db.select().from(schema.outboxMessages).orderBy(asc(schema.outboxMessages.occurredAt));
        expect(rows.map((row) => row.publishedAt !== null)).toEqual([true, true, true]);
      },
      { timeout: 5_000, interval: 100 },
    );
    await publisher.close();

    // The refusal ended the first batch after the first row, so the third row waited behind the second.
    expect(broker.seen).toEqual([
      { eventId: first.id, confirmed: true },
      { eventId: second.id, confirmed: false },
      { eventId: second.id, confirmed: true },
      { eventId: third.id, confirmed: true },
    ]);
  });
});

/**
 * A row carries the trace of the request that wrote it, so the publish happens inside that trace even though the relay
 * timer runs outside any request.
 */
describe("InventoryOutboxPublisher trace context", () => {
  const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
  const spanId = "00f067aa0ba902b7";
  const client = new PGlite();
  const db = drizzle({ client, schema });

  beforeAll(async () => {
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
    await migrate(db, { migrationsFolder });
  });

  afterAll(async () => {
    context.disable();
    await client.close();
  });

  it("publishes inside the trace of the request that wrote the row", async () => {
    const [traced] = await db
      .insert(schema.outboxMessages)
      .values({
        eventType: "inventory.availability.changed.v1",
        schemaVersion: "1",
        payload: JSON.stringify({ productId: "p", siteId: "s", inStock: true }),
        traceparent: `00-${traceId}-${spanId}-01`,
      })
      .returning();
    if (!traced) throw new Error("outbox row was not created");
    const publisher = new InventoryOutboxPublisher(
      { db, pool: undefined } as unknown as InventoryDatabase,
      createLogger({ level: "silent" }),
      "amqp://broker.test",
    );

    publisher.start();
    await vi.waitFor(
      async () => {
        const [row] = await db.select().from(schema.outboxMessages).where(eq(schema.outboxMessages.id, traced.id));
        expect(row?.publishedAt).not.toBeNull();
      },
      { timeout: 5_000, interval: 100 },
    );
    await publisher.close();

    const active = broker.activeSpans.find((entry) => entry.eventId === traced.id);
    expect(active?.spanContext).toMatchObject({ traceId, spanId, isRemote: true });
  });

  it("publishes without an active span when the row has no traceparent", async () => {
    const [untraced] = await db
      .insert(schema.outboxMessages)
      .values({
        eventType: "inventory.availability.changed.v1",
        schemaVersion: "1",
        payload: JSON.stringify({ productId: "p", siteId: "s", inStock: false }),
        traceparent: null,
      })
      .returning();
    if (!untraced) throw new Error("outbox row was not created");
    const publisher = new InventoryOutboxPublisher(
      { db, pool: undefined } as unknown as InventoryDatabase,
      createLogger({ level: "silent" }),
      "amqp://broker.test",
    );

    publisher.start();
    await vi.waitFor(
      async () => {
        const [row] = await db.select().from(schema.outboxMessages).where(eq(schema.outboxMessages.id, untraced.id));
        expect(row?.publishedAt).not.toBeNull();
      },
      { timeout: 5_000, interval: 100 },
    );
    await publisher.close();

    expect(broker.seen.filter((entry) => entry.eventId === untraced.id)).toEqual([
      { eventId: untraced.id, confirmed: true },
    ]);
    const active = broker.activeSpans.find((entry) => entry.eventId === untraced.id);
    expect(active?.spanContext).toBeUndefined();
  });
});
