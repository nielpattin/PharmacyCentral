import { metrics } from "@opentelemetry/api";

const DEFAULT_MAX_ENTRIES = 5000;
const DEFAULT_TTL_MS = 30_000;

const lookups = metrics.getMeter("catalog-service").createCounter("pharmacy.search.cache", {
  unit: "{lookup}",
  description: "Product list lookups by outcome: hit (served from memory), shared (joined a load in flight), miss",
});

export type CachedSearchResponse = {
  /** The JSON array, already serialised: a hit costs no database query, no mapping and no stringify. */
  body: string;
  /** Cursor of the next page, absent on the last page. */
  nextCursor: string | undefined;
};

export type SearchResponseCache = {
  load(key: string, loader: () => Promise<CachedSearchResponse>): Promise<CachedSearchResponse>;
  clear(): void;
};

/**
 * Remembers whole product list answers (search, category and browse pages) for a few seconds. Shoppers repeat the same
 * few queries, so the most asked ones are served from memory and the least recently used drop out first. Concurrent
 * requests for one key share a single load. Answers are never kept past `ttlMs`, which bounds how long a change made
 * on another replica stays invisible; changes made through this replica clear the cache at once.
 */
export const createSearchResponseCache = (
  options: { maxEntries?: number; ttlMs?: number; now?: () => number } = {},
): SearchResponseCache => {
  const { maxEntries = DEFAULT_MAX_ENTRIES, ttlMs = DEFAULT_TTL_MS, now = Date.now } = options;
  const entries = new Map<string, { value: CachedSearchResponse; expiresAt: number }>();
  const loading = new Map<string, Promise<CachedSearchResponse>>();
  // A load that started before clear() read data that may be stale, so it must not be stored.
  let generation = 0;

  return {
    async load(key, loader) {
      const cached = entries.get(key);
      if (cached && cached.expiresAt > now()) {
        // Map keeps insertion order, so re-inserting marks the entry as the most recently used.
        entries.delete(key);
        entries.set(key, cached);
        lookups.add(1, { outcome: "hit" });
        return cached.value;
      }
      entries.delete(key);
      const shared = loading.get(key);
      if (shared) {
        lookups.add(1, { outcome: "shared" });
        return shared;
      }
      lookups.add(1, { outcome: "miss" });
      const startedIn = generation;
      const pending = loader()
        .then((value) => {
          if (startedIn === generation) {
            entries.set(key, { value, expiresAt: now() + ttlMs });
            const oldest = entries.keys().next().value;
            if (entries.size > maxEntries && oldest !== undefined) entries.delete(oldest);
          }
          return value;
        })
        .finally(() => {
          if (loading.get(key) === pending) loading.delete(key);
        });
      loading.set(key, pending);
      return pending;
    },
    clear() {
      generation += 1;
      entries.clear();
      loading.clear();
    },
  };
};
