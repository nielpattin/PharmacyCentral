/**
 * The three Redis commands the read-through cache needs. Keeping the surface this small lets tests run the cache
 * against an in-memory store and keeps the cache logic independent of the client library.
 */
export type CacheStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  increment(key: string): Promise<number>;
};
