import amqp from "amqplib";
import { setTimeout as sleep } from "node:timers/promises";
import type { Channel, ChannelModel, ConsumeMessage } from "amqplib";

import type { Logger } from "../logger.ts";
import type { OrderStock } from "./orders/application/order-stock.ts";
import { type ConsumerOutcome, initConsumerOutcomes, recordConsumerDelivery } from "./payment-event-metrics.ts";
import type { SalesRepository } from "./sales-repository.ts";

const EXCHANGE = "pharmacy.events";
const DEAD_LETTER_EXCHANGE = "pharmacy.events.dead";
const QUEUE = "sales.payment-events.v2";
/** The delivery a failing message is parked on `${QUEUE}.dead` at; each earlier failure waits longer. */
const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 1_000;
const RECONNECT_DELAY_MS = 5_000;

/**
 * Moves an order to paid or refunded from the payment events. One message is handled at a time, so the events of an
 * order are applied in the order they were published. A failed handler waits and returns the message to the queue;
 * on its `MAX_ATTEMPTS`th failure, and at once for a payload that is not JSON, the message is rejected and the
 * broker dead-letters it to `${QUEUE}.dead` instead of dropping it or looping on it forever. The attempts are
 * counted by the app from `x-acquired-count`, because RabbitMQ 4 does not apply `x-delivery-limit` to a requeueing
 * `basic.nack`. The connection is rebuilt after it drops.
 */
export class SalesPaymentEventConsumer {
  private connection: ChannelModel | undefined;
  private channel: Channel | undefined;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private closing = false;

  public constructor(
    private readonly repository: SalesRepository,
    private readonly orderStock: OrderStock,
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
      connection.on("error", (error: unknown) => this.logger.warn({ error }, "payment consumer connection error"));
      connection.on("close", () => {
        if (this.connection === connection) this.restart();
      });
      const channel = await connection.createChannel();
      channel.on("error", (error: unknown) => this.logger.warn({ error }, "payment consumer channel error"));
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
          this.logger.warn({ error }, "payment event could not be settled"),
        );
      });
    } catch (error) {
      this.logger.warn({ error }, "payment consumer could not start, retrying");
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
    await channel.bindQueue(QUEUE, EXCHANGE, "payment.invoice.*.v1");
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
    const started = performance.now();
    let outcome: ConsumerOutcome = "processed";
    try {
      await this.settle(channel, message, (next) => {
        outcome = next;
      });
    } finally {
      recordConsumerDelivery(QUEUE, outcome, (performance.now() - started) / 1000);
    }
  }

  private async settle(
    channel: Channel,
    message: ConsumeMessage,
    setOutcome: (outcome: ConsumerOutcome) => void,
  ): Promise<void> {
    let event: {
      eventType?: string;
      payload?: { orderId?: unknown; prescriptionId?: unknown; fullyRefunded?: unknown };
    };
    try {
      event = JSON.parse(message.content.toString()) as typeof event;
    } catch {
      setOutcome("dead_lettered");
      channel.nack(message, false, false);
      return;
    }
    try {
      const orderId = event.payload?.orderId;
      const prescriptionId = event.payload?.prescriptionId;
      const paid = event.eventType === "payment.invoice.paid.v1";
      // A partial refund leaves the order as it was; only the last one (or an older event, which has no flag) pays it all back.
      const refunded = event.eventType === "payment.invoice.refunded.v1" && event.payload?.fullyRefunded !== false;
      if (typeof orderId === "string" && (paid || refunded)) {
        const order = await this.repository.applyPaymentStatus(orderId, refunded ? "Refunded" : "Paid");
        // An order that was not handed over will not happen once its money went back: cancel it and free its stock.
        if (order && refunded) await this.orderStock.cancelRefunded(order);
        // The order was cancelled before the transfer arrived. Nothing here can send the money back.
        if (order && !refunded && order.status === "Cancelled")
          this.logger.error({ orderId }, "a cancelled order was paid and needs a refund");
      }
      // A counter prescription has no payment status on its own; the first paid date is what the customer split reads.
      if (paid && typeof prescriptionId === "string") await this.repository.applyPrescriptionPaidAt(prescriptionId);
      channel.ack(message);
    } catch (error) {
      const attempt = Number(message.properties.headers?.["x-acquired-count"] ?? 0) + 1;
      if (attempt >= MAX_ATTEMPTS) {
        this.logger.error({ error, attempt }, "payment event failed for good, dead-lettering it");
        setOutcome("dead_lettered");
        channel.nack(message, false, false);
        return;
      }
      this.logger.warn({ error, attempt }, "payment event failed, returning it to the queue");
      setOutcome("retried");
      await sleep(RETRY_DELAY_MS * attempt);
      channel.nack(message, false, true);
    }
  }
}
