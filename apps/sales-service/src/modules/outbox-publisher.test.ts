import { PGlite } from "@electric-sql/pglite";
import { asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createLogger } from "../logger.ts";
import type { SalesDatabase } from "../shared/infrastructure/database.ts";
import * as schema from "../shared/infrastructure/schema.ts";
import { SalesOutboxPublisher } from "./outbox-publisher.ts";

const broker = vi.hoisted(() => ({
  /** Event ids the broker refuses to confirm, and how many more times it refuses each. */
  refusals: new Map<string, number>(),
  /** Every publish the broker saw, in order, with whether it confirmed it. */
  seen: [] as Array<{ eventId: string; confirmed: boolean }>,
}));

vi.mock("amqplib", () => {
  const channel = () => ({
    on: () => undefined,
    assertExchange: async () => undefined,
    publish: (_exchange: string, _key: string, content: Buffer, _options: unknown, done: (error?: Error) => void) => {
      const { eventId } = JSON.parse(content.toString()) as { eventId: string };
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
describe("SalesOutboxPublisher", () => {
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
          eventType: "sales.order.created.v1",
          aggregateId: crypto.randomUUID(),
          payload: JSON.stringify({ orderId: `order-${n}` }),
          occurredAt: new Date(2026, 0, 1, 0, 0, n),
        })),
      )
      .returning();
    if (!first || !second || !third) throw new Error("outbox rows were not created");
    broker.refusals.set(second.id, 1);
    const publisher = new SalesOutboxPublisher(
      { db, pool: undefined } as unknown as SalesDatabase,
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
