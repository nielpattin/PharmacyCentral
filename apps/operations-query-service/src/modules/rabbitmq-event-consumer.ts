import amqp from "amqplib";

import type { OperationsRepository, IntegrationEvent } from "./operations-repository.ts";

export class RabbitMqEventConsumer {
  private connection?: amqp.ChannelModel;
  private channel?: amqp.Channel;

  public constructor(
    private readonly repository: OperationsRepository,
    private readonly url = process.env.RABBITMQ_URL,
  ) {}

  public async start(): Promise<void> {
    if (!this.url) return;
    this.connection = await amqp.connect(this.url);
    this.channel = await this.connection.createChannel();
    await this.channel.assertExchange("pharmacy.events", "topic", { durable: true });
    const queue = await this.channel.assertQueue("operations-query.events.v1", { durable: true });
    await this.channel.bindQueue(queue.queue, "pharmacy.events", "#");
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
    const event = JSON.parse(message.content.toString()) as IntegrationEvent;
    if (event.eventId && event.eventType && event.occurredAt && event.payload) await this.repository.apply(event);
    this.channel?.ack(message);
  }
}
