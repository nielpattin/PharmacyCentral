import { TimeUnit, type GlideClient } from "@valkey/valkey-glide";

import type { DeliveryCache, DeliveryCalculation } from "../domain/delivery-calculator.ts";

export class ValkeyDeliveryCache implements DeliveryCache {
  public constructor(
    private readonly client: GlideClient,
    private readonly namespace = "sales:delivery:v1",
  ) {}

  public async get(key: string): Promise<DeliveryCalculation | undefined> {
    const raw = await this.client.get(this.key(key));
    if (typeof raw !== "string") return undefined;
    try {
      return JSON.parse(raw) as DeliveryCalculation;
    } catch {
      return undefined;
    }
  }

  public async set(key: string, value: DeliveryCalculation, ttlSeconds: number): Promise<void> {
    await this.client.set(this.key(key), JSON.stringify(value), {
      expiry: { type: TimeUnit.Seconds, count: ttlSeconds },
    });
  }

  private key(key: string): string {
    return `${this.namespace}:${key}`;
  }
}
