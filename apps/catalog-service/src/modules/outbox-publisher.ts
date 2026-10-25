import amqp from "amqplib";
import { asc, inArray, isNull, lt, sql } from "drizzle-orm";
import type { ChannelModel, ConfirmChannel } from "amqplib";

import type { Logger } from "../logger.ts";
import type { CatalogDatabase } from "../shared/infrastructure/database.ts";
import { outboxMessages } from "../shared/infrastructure/schema.ts";
import { withTraceparent } from "../shared/infrastructure/trace-context.ts";
import { recordOutboxPublished, registerOutboxBacklogGauges } from "./outbox-metrics.ts";

const EXCHANGE = "pharmacy.events";
const TICK_MS = 1_000;
const BATCH_SIZE = 500;
const PUBLISHED_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const PURGE_INTERVAL_MS = 60 * 60 * 1_000;
/** One relay per database publishes at a time, so replicas never send the same row twice and the order holds. */
const RELAY_LOCK_NAME = "catalog.outbox";

/**
 * Relays the rows a stock transaction wrote to `outbox_messages` onto `pharmacy.events`. The row commits with the
 * stock change, so a broker that is down or a process that dies after the commit only delays the event: the row is
 * still unpublished and a later tick sends it.
 *
 * A row is marked published only after the broker confirmed the message, so delivery is at least once and the
 * consumers apply it idempotently. The broker connection is rebuilt on the next tick after it drops.
 */
export class CatalogOutboxPublisher {
  private connection: ChannelModel | undefined;
  private channel: ConfirmChannel | undefined;
  private timer: NodeJS.Timeout | undefined;
  private unregisterBacklogGauges: (() => void) | undefined;
  private inFlight = false;
  private degraded = false;
  private lastPurgeAt = 0;

  public constructor(
    private readonly database: CatalogDatabase,
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
      while ((await this.relayBatch(this.channel)) === BATCH_SIZE);
      if (this.degraded) this.logger.info("catalog outbox publisher recovered");
      this.degraded = false;
    } catch (error) {
      if (!this.degraded) this.logger.warn({ error }, "catalog outbox publisher cannot reach the broker");
      this.degraded = true;
      await this.disconnect();
    } finally {
      this.inFlight = false;
    }
    await this.purgePublished();
  }

  /**
   * Sends the oldest unpublished rows in one go and waits for the broker's confirms together, then marks the confirmed
   * rows published with one UPDATE. Rows are marked in order: the first refused row ends the confirmed prefix, so a
   * later row is never recorded before an earlier one, and a row sent after the refused one is simply sent again.
   * Returns how many rows it read, so a full batch means more rows are probably waiting.
   */
  private async relayBatch(channel: ConfirmChannel): Promise<number> {
    let failure: unknown;
    let read = 0;
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
      read = pending.length;
      const results = await Promise.allSettled(pending.map((message) => this.publishConfirmed(channel, message)));
      const refused = results.findIndex((result) => result.status === "rejected");
      const confirmed = refused === -1 ? pending : pending.slice(0, refused);
      if (refused !== -1) failure = (results[refused] as PromiseRejectedResult).reason;
      if (confirmed.length === 0) return;
      await transaction
        .update(outboxMessages)
        .set({ publishedAt: new Date(), attempts: sql`${outboxMessages.attempts} + 1` })
        .where(
          inArray(
            outboxMessages.id,
            confirmed.map((message) => message.id),
          ),
        );
      for (const message of confirmed) recordOutboxPublished(message.occurredAt);
    });
    if (failure) throw failure;
    return read;
  }

  /** Deletes rows that were published long ago, at most once an hour. A failure only delays the next attempt. */
  private async purgePublished(): Promise<void> {
    if (Date.now() - this.lastPurgeAt < PURGE_INTERVAL_MS) return;
    this.lastPurgeAt = Date.now();
    try {
      await this.database.db
        .delete(outboxMessages)
        .where(lt(outboxMessages.publishedAt, new Date(Date.now() - PUBLISHED_RETENTION_MS)));
    } catch (error) {
      this.logger.warn({ error }, "catalog outbox purge failed");
    }
  }

  private async publishConfirmed(channel: ConfirmChannel, message: typeof outboxMessages.$inferSelect): Promise<void> {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const payload = JSON.parse(message.payload) as Record<string, unknown>;
    const envelope = {
      eventId: message.id,
      eventType: message.eventType,
      occurredAt: message.occurredAt.toISOString(),
      // An audit entry names the person who made the write; the other events are the system's own.
      ...(typeof payload.actorId === "string" ? { actorId: payload.actorId } : {}),
      payload,
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
