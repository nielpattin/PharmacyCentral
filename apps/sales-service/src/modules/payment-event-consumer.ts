import amqp from "amqplib";
import type { Channel, ChannelModel } from "amqplib";

import type { SalesRepository } from "./sales-repository.ts";

export class SalesPaymentEventConsumer {
  private connection?: ChannelModel;
  private channel?: Channel;

  public constructor(
    private readonly repository: SalesRepository,
    private readonly url = process.env.RABBITMQ_URL,
  ) {}

  public async start(): Promise<void> {
    if (!this.url) return;
    this.connection = await amqp.connect(this.url);
    this.channel = await this.connection.createChannel();
    await this.channel.assertExchange("pharmacy.events", "topic", { durable: true });
    const queue = await this.channel.assertQueue("sales.payment-events.v1", { durable: true });
    await this.channel.bindQueue(queue.queue, "pharmacy.events", "payment.invoice.*.v1");
    await this.channel.consume(queue.queue, (message) => {
      if (message) void this.handle(message);
    });
  }

  public async close(): Promise<void> {
    await this.channel?.close();
    await this.connection?.close();
  }

  private async handle(message: amqp.ConsumeMessage): Promise<void> {
    try {
      const event = JSON.parse(message.content.toString()) as { eventType?: string; payload?: { orderId?: unknown } };
      const orderId = event.payload?.orderId;
      if (
        typeof orderId === "string" &&
        (event.eventType === "payment.invoice.paid.v1" || event.eventType === "payment.invoice.refunded.v1")
      ) {
        await this.repository.setOrderPaymentStatus(
          orderId,
          event.eventType.endsWith("refunded.v1") ? "Refunded" : "Paid",
        );
      }
      this.channel?.ack(message);
    } catch {
      this.channel?.nack(message, false, false);
    }
  }
}
