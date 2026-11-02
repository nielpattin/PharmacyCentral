import { Redis } from "ioredis";

import type { CacheStore } from "./cache-store.ts";

export type RedisCacheClientOptions = {
  /** Called for every connection error. The cache keeps working without Redis, so the caller only logs. */
  onError: (error: unknown) => void;
};

/**
 * A Redis client for read caching. Commands fail at once while the connection is down (no offline queue), so a request
 * never waits for a reconnect; the cache treats that failure as a miss.
 */
export const createRedisCacheClient = (url: string, options: RedisCacheClientOptions): Redis => {
  const client = new Redis(url, {
    commandTimeout: 250,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  });
  client.on("error", options.onError);
  return client;
};

/** Adapts an ioredis client to the cache store. */
export class RedisCacheStore implements CacheStore {
  public constructor(private readonly client: Redis) {}

  public get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  public async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.client.set(key, value, "EX", ttlSeconds);
  }

  public increment(key: string): Promise<number> {
    return this.client.incr(key);
  }
}
