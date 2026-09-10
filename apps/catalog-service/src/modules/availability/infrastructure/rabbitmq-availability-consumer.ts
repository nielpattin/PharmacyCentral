import amqp from "amqplib";

import type { AvailabilityProjection } from "../application/availability-projection.ts";

export class RabbitMqAvailabilityConsumer {
  private connection?: amqp.ChannelModel;
  private channel?: amqp.Channel;

  public constructor(
    private readonly projection: AvailabilityProjection,
    private readonly url = process.env.RABBITMQ_URL,
  ) {}

  public async start(): Promise<void> {
    if (!this.url) return;
    this.connection = await amqp.connect(this.url);
    this.channel = await this.connection.createChannel();
    await this.channel.assertExchange("pharmacy.events", "topic", { durable: true });
    const queue = await this.channel.assertQueue("catalog.availability.v1", { durable: true });
    await this.channel.bindQueue(queue.queue, "pharmacy.events", "inventory.availability.changed.v1");
    await this.channel.consume(queue.queue, (message) => {
      if (!message) return;
      void this.handle(message).catch(() => this.channel?.nack(message, false, true));
    });
  }

  public async close(): Promise<void> {
    await this.channel?.close();
    await this.connection?.close();
  }

  private async handle(message: amqp.ConsumeMessage): Promise<void> {
    const envelope = JSON.parse(message.content.toString()) as {
      eventId?: string;
      payload?: { productId?: string; siteId?: string; inStock?: boolean };
    };
    const payload = envelope.payload;
    if (!envelope.eventId || !payload?.productId || !payload.siteId || typeof payload.inStock !== "boolean") {
      this.channel?.ack(message);
      return;
    }
    await this.projection.apply({ productId: payload.productId, siteId: payload.siteId, inStock: payload.inStock });
    this.channel?.ack(message);
  }
}
