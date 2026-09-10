import amqp from "amqplib";
import { asc, eq, isNull } from "drizzle-orm";
import type { Channel, ChannelModel } from "amqplib";

import type { PaymentDatabase } from "../shared/infrastructure/database.ts";
import { outboxMessages } from "./payments/infrastructure/schema.ts";

export class PaymentOutboxPublisher {
  private connection?: ChannelModel;
  private channel?: Channel;
  private timer?: NodeJS.Timeout;

  public constructor(
    private readonly database: PaymentDatabase,
    private readonly url = process.env.RABBITMQ_URL,
  ) {}

  public async start(): Promise<void> {
    if (!this.url) return;
    this.connection = await amqp.connect(this.url);
    this.channel = await this.connection.createChannel();
    await this.channel.assertExchange("pharmacy.events", "topic", { durable: true });
    this.timer = setInterval(() => {
      void this.publishPending();
    }, 1_000);
    await this.publishPending();
  }

  public async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.channel?.close();
    await this.connection?.close();
  }

  private async publishPending(): Promise<void> {
    if (!this.channel) return;
    const pending = await this.database.db
      .select()
      .from(outboxMessages)
      .where(isNull(outboxMessages.publishedAt))
      .orderBy(asc(outboxMessages.occurredAt))
      .limit(50);
    for (const message of pending) {
      const payload = JSON.parse(message.payload) as Record<string, unknown>;
      const delivered = this.channel.publish(
        "pharmacy.events",
        message.eventType,
        Buffer.from(
          JSON.stringify({
            eventId: message.id,
            eventType: message.eventType,
            occurredAt: message.occurredAt.toISOString(),
            payload,
          }),
        ),
        { persistent: true, contentType: "application/json" },
      );
      if (delivered)
        await this.database.db
          .update(outboxMessages)
          .set({ publishedAt: new Date(), attempts: String(Number(message.attempts) + 1) })
          .where(eq(outboxMessages.id, message.id));
    }
  }
}
