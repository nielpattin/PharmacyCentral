import type { CacheStore } from "./cache-store.ts";

export type ReadThroughCacheOptions = {
  /**
   * Prefix of every key, for example `pharmacy:catalog:v1`. Bump the version part when the cached shape changes, so
   * old entries are never read back as the new shape.
   */
  namespace: string;
  /** Longest wait for one Redis command before the cache gives up on it. Default 100 ms. */
  timeoutMs?: number | undefined;
  /** Receives every Redis failure. The request itself never sees it. */
  warn?: ((error: unknown, operation: CacheOperation) => void) | undefined;
};

export type CacheOperation = "generation" | "read" | "write" | "invalidate";

const FAILED = Symbol("cache command failed");

const withTimeout = <T>(promise: Promise<T>, timeoutMs: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`cache command exceeded ${timeoutMs} ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });

/**
 * Read-through cache for hot reads that other requests may change.
 *
 * Entries live under a group (for example `products`). Every write to that group calls `invalidate(group)`, which
 * increments the group's generation counter. Entries are keyed by generation, so after an invalidation no reader looks
 * at an entry written before it, even a read that was still in flight when the write committed. Old entries expire on
 * their own TTL.
 *
 * Redis is an optimisation only. When a command fails or runs past `timeoutMs`, the read goes to the loader (the
 * database), and a failed write or invalidation is reported through `warn` and never thrown. Entries that cannot be
 * read back (a corrupt value) are treated as misses.
 *
 * Callers must cache only data that is the same for every requester of the same key. Anything that depends on the
 * signed-in actor belongs outside this cache.
 */
export class ReadThroughCache {
  private readonly timeoutMs: number;

  public constructor(
    private readonly store: CacheStore,
    private readonly options: ReadThroughCacheOptions,
  ) {
    this.timeoutMs = options.timeoutMs ?? 100;
  }

  /**
   * Returns the cached value of `key` in `group`, or runs `loader` and keeps its answer for `ttlSeconds`. An `undefined`
   * answer (for example a 404) is returned and never stored.
   */
  public async load<T>(group: string, key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
    const generation = await this.attempt("generation", () => this.store.get(this.generationKey(group)));
    if (generation === FAILED) return loader();

    const entryKey = `${this.options.namespace}:${group}:${generation ?? "0"}:${key}`;
    const cached = await this.attempt("read", () => this.store.get(entryKey));
    if (typeof cached === "string") {
      const parsed = parseEntry<T>(cached);
      if (parsed !== FAILED) return parsed;
    }

    const value = await loader();
    if (value !== undefined) {
      const serialised = JSON.stringify(value);
      await this.attempt("write", () => this.store.set(entryKey, serialised, ttlSeconds));
    }
    return value;
  }

  /** Drops every entry of `group` for readers that start after this resolves. Never rejects. */
  public async invalidate(group: string): Promise<void> {
    await this.attempt("invalidate", () => this.store.increment(this.generationKey(group)));
  }

  private generationKey(group: string): string {
    return `${this.options.namespace}:generation:${group}`;
  }

  private async attempt<R>(operation: CacheOperation, command: () => Promise<R>): Promise<R | typeof FAILED> {
    try {
      return await withTimeout(command(), this.timeoutMs);
    } catch (error) {
      this.options.warn?.(error, operation);
      return FAILED;
    }
  }
}

const parseEntry = <T>(raw: string): T | typeof FAILED => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return FAILED;
  }
};
