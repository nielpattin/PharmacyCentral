import amqp from "amqplib";
import { asc, eq, isNull, sql } from "drizzle-orm";
import type { ChannelModel, ConfirmChannel } from "amqplib";

import type { Logger } from "../logger.ts";
import type { InventoryDatabase } from "../shared/infrastructure/database.ts";
import { outboxMessages } from "../shared/infrastructure/schema.ts";
import { withTraceparent } from "../shared/infrastructure/trace-context.ts";
import { recordOutboxPublished, registerOutboxBacklogGauges } from "./outbox-metrics.ts";

const EXCHANGE = "pharmacy.events";
const TICK_MS = 1_000;
const BATCH_SIZE = 50;
/** One relay per database publishes at a time, so replicas never send the same row twice and the order holds. */
const RELAY_LOCK_NAME = "inventory.outbox";

/**
 * Relays the rows a stock transaction wrote to `outbox_messages` onto `pharmacy.events`. The row commits with the
 * stock change, so a broker that is down or a process that dies after the commit only delays the event: the row is
 * still unpublished and a later tick sends it.
 *
 * A row is marked published only after the broker confirmed the message, so delivery is at least once and the
 * consumers apply it idempotently. The broker connection is rebuilt on the next tick after it drops.
 */
export class InventoryOutboxPublisher {
  private connection: ChannelModel | undefined;
  private channel: ConfirmChannel | undefined;
  private timer: NodeJS.Timeout | undefined;
  private unregisterBacklogGauges: (() => void) | undefined;
  private inFlight = false;
  private degraded = false;

  public constructor(
    private readonly database: InventoryDatabase,
    private readonly logger: Logger,
    private readonly url: string,
  ) {}

  public start(): void {
    this.timer = setInterval(() => void this.publishPending(), TICK_MS);
    this.unregisterBacklogGauges = registerOutboxBacklogGauges(this.database);
    void this.publishPending();
  }

  public async close(): Promise<void> {
    clearInterval(this.timer);
    this.unregisterBacklogGauges?.();
    this.unregisterBacklogGauges = undefined;
    await this.disconnect();
  }

  private async publishPending(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      this.channel ??= await this.connect();
      await this.relayBatch(this.channel);
      if (this.degraded) this.logger.info("inventory outbox publisher recovered");
      this.degraded = false;
    } catch (error) {
      if (!this.degraded) this.logger.warn({ error }, "inventory outbox publisher cannot reach the broker");
      this.degraded = true;
      await this.disconnect();
    } finally {
      this.inFlight = false;
    }
  }

  /** Sends the oldest unpublished rows. A failed send ends the batch but keeps the rows already confirmed. */
  private async relayBatch(channel: ConfirmChannel): Promise<void> {
    let failure: unknown;
    await this.database.db.transaction(async (transaction) => {
      const locked = await transaction.execute(
        sql`select pg_try_advisory_xact_lock(hashtext(${RELAY_LOCK_NAME})) as locked`,
      );
      if (locked.rows[0]?.locked !== true) return;
      const pending = await transaction
        .select()
        .from(outboxMessages)
        .where(isNull(outboxMessages.publishedAt))
        .orderBy(asc(outboxMessages.occurredAt))
        .limit(BATCH_SIZE);
      for (const message of pending) {
        try {
          await this.publishConfirmed(channel, message);
        } catch (error) {
          failure = error;
          return;
        }
        recordOutboxPublished(message.occurredAt);
        await transaction
          .update(outboxMessages)
          .set({ publishedAt: new Date(), attempts: message.attempts + 1 })
          .where(eq(outboxMessages.id, message.id));
      }
    });
    if (failure) throw failure;
  }

  private publishConfirmed(channel: ConfirmChannel, message: typeof outboxMessages.$inferSelect): Promise<void> {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const envelope = {
      eventId: message.id,
      eventType: message.eventType,
      occurredAt: message.occurredAt.toISOString(),
      payload: JSON.parse(message.payload) as Record<string, unknown>,
    };
    // Parent the producer span on the request that wrote the row, not on the relay timer's context.
    withTraceparent(message.traceparent, () =>
      channel.publish(
        EXCHANGE,
        message.eventType,
        Buffer.from(JSON.stringify(envelope)),
        { persistent: true, contentType: "application/json" },
        (error) => (error ? reject(error) : resolve()),
      ),
    );
    return promise;
  }

  private async connect(): Promise<ConfirmChannel> {
    await this.disconnect();
    const connection = await amqp.connect(this.url);
    // Without a listener an emitted `error` would crash the process; the next tick rebuilds the connection.
    connection.on("error", () => undefined);
    try {
      const channel = await connection.createConfirmChannel();
      channel.on("error", () => undefined);
      channel.on("close", () => {
        if (this.channel === channel) this.channel = undefined;
      });
      await channel.assertExchange(EXCHANGE, "topic", { durable: true });
      this.connection = connection;
      return channel;
    } catch (error) {
      await connection.close().catch(() => undefined);
      throw error;
    }
  }

  private async disconnect(): Promise<void> {
    const connection = this.connection;
    this.connection = undefined;
    this.channel = undefined;
    await connection?.close().catch(() => undefined);
  }
}
