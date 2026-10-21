import amqp from "amqplib";
import { setTimeout as sleep } from "node:timers/promises";
import type { Channel, ChannelModel, ConsumeMessage } from "amqplib";

import type { Logger } from "../logger.ts";
import type { OperationsRepository, IntegrationEvent } from "./operations-repository.ts";

const EXCHANGE = "pharmacy.events";
const DEAD_LETTER_EXCHANGE = "pharmacy.events.dead";
const QUEUE = "operations-query.events.v2";
/** The delivery a failing message is parked on `${QUEUE}.dead` at; each earlier failure waits longer. */
const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 1_000;
const RECONNECT_DELAY_MS = 5_000;

/**
 * Builds the read model from every event of the exchange. One message is handled at a time, so the events are
 * applied in the order they were published, and `repository.apply` skips an event it already saw. A failed handler
 * waits and returns the message to the queue; on its `MAX_ATTEMPTS`th failure, and at once for a message that is not
 * a well-formed event, the message is rejected and the broker dead-letters it to `${QUEUE}.dead` instead of
 * dropping it or looping on it forever. The attempts are counted by the app from `x-acquired-count`, because
 * RabbitMQ 4 does not apply `x-delivery-limit` to a requeueing `basic.nack`. The connection is rebuilt after it
 * drops.
 */
export class RabbitMqEventConsumer {
  private connection: ChannelModel | undefined;
  private channel: Channel | undefined;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private closing = false;

  public constructor(
    private readonly repository: OperationsRepository,
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
      connection.on("error", (error: unknown) => this.logger.warn({ error }, "event consumer connection error"));
      connection.on("close", () => {
        if (this.connection === connection) this.restart();
      });
      const channel = await connection.createChannel();
      channel.on("error", (error: unknown) => this.logger.warn({ error }, "event consumer channel error"));
      channel.on("close", () => {
        if (this.channel === channel) this.restart();
      });
      this.channel = channel;
      await this.declareTopology(channel);
      await channel.prefetch(1);
      await channel.consume(QUEUE, (message) => {
        // The broker cancelled the consumer, for instance because the queue was deleted.
        if (!message) return this.restart();
        void this.handle(channel, message).catch((error: unknown) =>
          this.logger.warn({ error }, "event could not be settled"),
        );
      });
    } catch (error) {
      this.logger.warn({ error }, "event consumer could not start, retrying");
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
    await channel.bindQueue(QUEUE, EXCHANGE, "#");
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
    let event: IntegrationEvent;
    try {
      event = JSON.parse(message.content.toString()) as IntegrationEvent;
    } catch {
      channel.nack(message, false, false);
      return;
    }
    if (!event.eventId || !event.eventType || !event.occurredAt || !event.payload) {
      channel.nack(message, false, false);
      return;
    }
    try {
      await this.repository.apply(event);
      channel.ack(message);
    } catch (error) {
      const attempt = Number(message.properties.headers?.["x-acquired-count"] ?? 0) + 1;
      if (attempt >= MAX_ATTEMPTS) {
        this.logger.error({ error, attempt }, "event failed for good, dead-lettering it");
        channel.nack(message, false, false);
        return;
      }
      this.logger.warn({ error, attempt }, "event failed, returning it to the queue");
      await sleep(RETRY_DELAY_MS * attempt);
      channel.nack(message, false, true);
    }
  }
}
