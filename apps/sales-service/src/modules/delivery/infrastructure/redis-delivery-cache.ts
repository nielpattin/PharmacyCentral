import type { Redis } from "ioredis";

import type { DeliveryCache, DeliveryCalculation } from "../domain/delivery-calculator.ts";

export class RedisDeliveryCache implements DeliveryCache {
  public constructor(
    private readonly client: Redis,
    private readonly namespace = "sales:delivery:v1",
  ) {}

  public async get(key: string): Promise<DeliveryCalculation | undefined> {
    const raw = await this.client.get(`${this.namespace}:${key}`);
    if (typeof raw !== "string") return undefined;
    try {
      return JSON.parse(raw) as DeliveryCalculation;
    } catch {
      return undefined;
    }
  }

  public async set(key: string, value: DeliveryCalculation, ttlSeconds: number): Promise<void> {
    await this.client.set(`${this.namespace}:${key}`, JSON.stringify(value), "EX", ttlSeconds);
  }
}
