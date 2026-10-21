import amqp from "amqplib";
import { setTimeout as sleep } from "node:timers/promises";
import type { Channel, ChannelModel, ConsumeMessage } from "amqplib";

import type { Logger } from "../../../logger.ts";
import type { AvailabilityProjection } from "../application/availability-projection.ts";
import { initConsumerOutcomes, recordConsumerDelivery } from "./availability-consumer-metrics.ts";

const EXCHANGE = "pharmacy.events";
const DEAD_LETTER_EXCHANGE = "pharmacy.events.dead";
const QUEUE = "catalog.availability.v2";
/** The delivery a failing message is parked on `${QUEUE}.dead` at; each earlier failure waits longer. */
const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 1_000;
const RECONNECT_DELAY_MS = 5_000;

/**
 * Applies the in-stock flag of a product at a site from the inventory events. The flag is last write wins, so one
 * message is handled at a time and the events of a product are applied in the order they were published. A failed
 * handler waits and returns the message to the queue; on its `MAX_ATTEMPTS`th failure, and at once for a message
 * that is not a valid availability event, the message is rejected and the broker dead-letters it to
 * `${QUEUE}.dead` instead of dropping it or looping on it forever. The attempts are counted by the app from
 * `x-acquired-count`, because RabbitMQ 4 does not apply `x-delivery-limit` to a requeueing `basic.nack`. The
 * connection is rebuilt after it drops.
 */
export class RabbitMqAvailabilityConsumer {
  private connection: ChannelModel | undefined;
  private channel: Channel | undefined;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private closing = false;

  public constructor(
    private readonly projection: AvailabilityProjection,
    private readonly logger: Logger,
    private readonly url: string,
  ) {}

  public start(): void {
    void this.connect();
  }

  public async close(): Promise<void> {
    this.closing = true;
    clearTimeout(this.reconnectTimer);
    const connection = this.connection;
    this.connection = undefined;
    this.channel = undefined;
    await connection?.close().catch(() => undefined);
  }

  private async connect(): Promise<void> {
    this.reconnectTimer = undefined;
    if (this.closing) return;
    try {
      const connection = await amqp.connect(this.url);
      this.connection = connection;
      connection.on("error", (error: unknown) => this.logger.warn({ error }, "availability consumer connection error"));
      connection.on("close", () => {
        if (this.connection === connection) this.restart();
      });
      const channel = await connection.createChannel();
      channel.on("error", (error: unknown) => this.logger.warn({ error }, "availability consumer channel error"));
      channel.on("close", () => {
        if (this.channel === channel) this.restart();
      });
      this.channel = channel;
      await this.declareTopology(channel);
      await channel.prefetch(1);
      initConsumerOutcomes(QUEUE);
      await channel.consume(QUEUE, (message) => {
        // The broker cancelled the consumer, for instance because the queue was deleted.
        if (!message) return this.restart();
        void this.handle(channel, message).catch((error: unknown) =>
          this.logger.warn({ error }, "availability event could not be settled"),
        );
      });
    } catch (error) {
      this.logger.warn({ error }, "availability consumer could not start, retrying");
      this.restart();
    }
  }

  private async declareTopology(channel: Channel): Promise<void> {
    await channel.assertExchange(EXCHANGE, "topic", { durable: true });
    await channel.assertExchange(DEAD_LETTER_EXCHANGE, "direct", { durable: true });
    await channel.assertQueue(`${QUEUE}.dead`, { durable: true });
    await channel.bindQueue(`${QUEUE}.dead`, DEAD_LETTER_EXCHANGE, QUEUE);
    await channel.assertQueue(QUEUE, {
      durable: true,
      arguments: {
        "x-queue-type": "quorum",
        "x-dead-letter-exchange": DEAD_LETTER_EXCHANGE,
        "x-dead-letter-routing-key": QUEUE,
      },
    });
    await channel.bindQueue(QUEUE, EXCHANGE, "inventory.availability.changed.v1");
  }

  private restart(): void {
    const connection = this.connection;
    this.connection = undefined;
    this.channel = undefined;
    void connection?.close().catch(() => undefined);
    if (this.closing || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => void this.connect(), RECONNECT_DELAY_MS);
  }

  private async handle(channel: Channel, message: ConsumeMessage): Promise<void> {
    const startedAt = performance.now();
    let envelope: { eventId?: string; payload?: { productId?: string; siteId?: string; inStock?: boolean } };
    try {
      envelope = JSON.parse(message.content.toString()) as typeof envelope;
    } catch {
      channel.nack(message, false, false);
      recordConsumerDelivery(QUEUE, "dead_lettered", startedAt);
      return;
    }
    const payload = envelope.payload;
    if (!envelope.eventId || !payload?.productId || !payload.siteId || typeof payload.inStock !== "boolean") {
      channel.nack(message, false, false);
      recordConsumerDelivery(QUEUE, "dead_lettered", startedAt);
      return;
    }
    try {
      await this.projection.apply({ productId: payload.productId, siteId: payload.siteId, inStock: payload.inStock });
      channel.ack(message);
      recordConsumerDelivery(QUEUE, "processed", startedAt);
    } catch (error) {
      const attempt = Number(message.properties.headers?.["x-acquired-count"] ?? 0) + 1;
      if (attempt >= MAX_ATTEMPTS) {
        this.logger.error({ error, attempt }, "availability event failed for good, dead-lettering it");
        channel.nack(message, false, false);
        recordConsumerDelivery(QUEUE, "dead_lettered", startedAt);
        return;
      }
      this.logger.warn({ error, attempt }, "availability event failed, returning it to the queue");
      await sleep(RETRY_DELAY_MS * attempt);
      channel.nack(message, false, true);
      recordConsumerDelivery(QUEUE, "retried", startedAt);
    }
  }
}
