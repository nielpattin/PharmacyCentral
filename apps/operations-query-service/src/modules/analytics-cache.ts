/**
 * A small response cache with single-flight for the analytics routes. Analytics is read-only and derived from the
 * integration events, so a result a few seconds old is acceptable; the cache mainly stops a page refresh storm from
 * repeating the same fan-out to the other services. One instance keeps its own cache: a second ECS task computes once
 * on its own, which is still bounded by the TTL.
 */

type CacheEntry = { value: unknown; expiresAt: number };

export type CacheOutcome = "hit" | "miss" | "coalesced";

export type CacheResult<T> = { value: T; outcome: CacheOutcome };

export type AnalyticsCacheOptions = {
  ttlMs: number;
  maxEntries: number;
  now?: (() => number) | undefined;
};

export class AnalyticsCache {
  readonly #entries = new Map<string, CacheEntry>();
  readonly #inFlight = new Map<string, Promise<unknown>>();
  readonly #ttlMs: number;
  readonly #maxEntries: number;
  readonly #now: () => number;

  public constructor({ ttlMs, maxEntries, now = Date.now }: AnalyticsCacheOptions) {
    if (!(ttlMs > 0)) throw new Error("AnalyticsCache ttlMs must be positive");
    if (!(maxEntries > 0)) throw new Error("AnalyticsCache maxEntries must be positive");
    this.#ttlMs = ttlMs;
    this.#maxEntries = maxEntries;
    this.#now = now;
  }

  public async getOrLoad<T>(key: string, load: () => Promise<T>): Promise<CacheResult<T>> {
    const cached = this.#entries.get(key);
    if (cached && cached.expiresAt > this.#now()) {
      // Refresh insertion order so the least recently used entry is evicted first.
      this.#entries.delete(key);
      this.#entries.set(key, cached);
      return { value: cached.value as T, outcome: "hit" };
    }
    if (cached) this.#entries.delete(key);

    const pending = this.#inFlight.get(key);
    if (pending) return { value: (await pending) as T, outcome: "coalesced" };

    const promise = load()
      .then((value) => {
        this.#remember(key, value);
        return value;
      })
      .finally(() => {
        this.#inFlight.delete(key);
      });
    this.#inFlight.set(key, promise);
    return { value: await promise, outcome: "miss" };
  }

  public clear(): void {
    this.#entries.clear();
  }

  #remember(key: string, value: unknown): void {
    this.#entries.delete(key);
    this.#entries.set(key, { value, expiresAt: this.#now() + this.#ttlMs });
    while (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
  }
}
