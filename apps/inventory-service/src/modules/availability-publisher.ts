import amqp from "amqplib";
import { randomUUID } from "node:crypto";

export class AvailabilityPublisher {
  private connection?: amqp.ChannelModel;
  private channel?: amqp.Channel;

  public constructor(private readonly url = process.env.RABBITMQ_URL) {}

  public async start(): Promise<void> {
    if (!this.url) return;
    this.connection = await amqp.connect(this.url);
    this.channel = await this.connection.createChannel();
    await this.channel.assertExchange("pharmacy.events", "topic", { durable: true });
  }

  public async publish(input: { productId: string; siteId: string; inStock: boolean }): Promise<void> {
    if (!this.channel) return;
    this.channel.publish(
      "pharmacy.events",
      "inventory.availability.changed.v1",
      Buffer.from(
        JSON.stringify({
          eventId: randomUUID(),
          eventType: "inventory.availability.changed.v1",
          occurredAt: new Date().toISOString(),
          payload: input,
        }),
      ),
      { persistent: true, contentType: "application/json" },
    );
  }

  public async close(): Promise<void> {
    await this.channel?.close();
    await this.connection?.close();
  }
}
