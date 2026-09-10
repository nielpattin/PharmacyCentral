import type { DeliveryCache, DeliveryCalculation } from "../domain/delivery-calculator.ts";

type Entry = { value: DeliveryCalculation; expiresAt: number };

export class InMemoryDeliveryCache implements DeliveryCache {
  private readonly entries = new Map<string, Entry>();

  public async get(key: string): Promise<DeliveryCalculation | undefined> {
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  public async set(key: string, value: DeliveryCalculation, ttlSeconds: number): Promise<void> {
    this.entries.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }
}
