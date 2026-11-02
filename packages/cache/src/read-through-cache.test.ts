import { describe, expect, it, vi } from "vitest";

import type { CacheStore } from "./cache-store.ts";
import { RedisCacheStore } from "./redis-cache-store.ts";
import { ReadThroughCache, type CacheOperation } from "./read-through-cache.ts";

/** An in-memory store that records every write, so tests can check TTLs and key layout. */
const memoryStore = () => {
  const values = new Map<string, string>();
  const writes: Array<{ key: string; ttlSeconds: number }> = [];
  const get = vi.fn(async (key: string) => values.get(key) ?? null);
  const set = vi.fn(async (key: string, value: string, ttlSeconds: number) => {
    values.set(key, value);
    writes.push({ key, ttlSeconds });
  });
  const increment = vi.fn(async (key: string) => {
    const next = Number(values.get(key) ?? "0") + 1;
    values.set(key, String(next));
    return next;
  });
  const store: CacheStore = { get, set, increment };
  return { store, get, set, increment, values, writes };
};

const NAMESPACE = "pharmacy:test:v1";

describe("ReadThroughCache", () => {
  it("loads once, then serves the stored answer until the group is invalidated", async () => {
    const { store } = memoryStore();
    const cache = new ReadThroughCache(store, { namespace: NAMESPACE });
    const loader = vi.fn(async () => ({ name: "Paracetamol" }));

    expect(await cache.load("products", "p1", 30, loader)).toEqual({ name: "Paracetamol" });
    expect(await cache.load("products", "p1", 30, loader)).toEqual({ name: "Paracetamol" });
    expect(loader).toHaveBeenCalledTimes(1);

    await cache.invalidate("products");
    await cache.load("products", "p1", 30, loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("keeps groups apart: invalidating one group leaves the others warm", async () => {
    const { store } = memoryStore();
    const cache = new ReadThroughCache(store, { namespace: NAMESPACE });
    const prices = vi.fn(async () => ({ unitPrice: "1000" }));
    const products = vi.fn(async () => ({ id: "p1" }));

    await cache.load("prices", "k", 15, prices);
    await cache.load("products", "k", 30, products);
    await cache.invalidate("products");
    await cache.load("prices", "k", 15, prices);
    await cache.load("products", "k", 30, products);

    expect(prices).toHaveBeenCalledTimes(1);
    expect(products).toHaveBeenCalledTimes(2);
  });

  it("does not serve a value a slow read stored after an invalidation that happened while it was loading", async () => {
    const { store } = memoryStore();
    const cache = new ReadThroughCache(store, { namespace: NAMESPACE });
    let releaseSlowLoad: (value: { unitPrice: string }) => void = () => undefined;
    const slowLoad = new Promise<{ unitPrice: string }>((resolve) => {
      releaseSlowLoad = resolve;
    });

    // A reader captures generation 0 and reads the old price while a write commits and invalidates.
    const inFlight = cache.load("prices", "k", 15, () => slowLoad);
    await cache.invalidate("prices");
    releaseSlowLoad({ unitPrice: "old" });
    await inFlight;

    const fresh = vi.fn(async () => ({ unitPrice: "new" }));
    expect(await cache.load("prices", "k", 15, fresh)).toEqual({ unitPrice: "new" });
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  it("writes entries under the namespace, the group, the generation and the key, with the given TTL", async () => {
    const { store, writes } = memoryStore();
    const cache = new ReadThroughCache(store, { namespace: NAMESPACE });

    await cache.load("stores", "id:s1", 60, async () => ({ id: "s1" }));
    await cache.invalidate("stores");
    await cache.load("stores", "id:s1", 60, async () => ({ id: "s1" }));

    expect(writes).toEqual([
      { key: `${NAMESPACE}:stores:0:id:s1`, ttlSeconds: 60 },
      { key: `${NAMESPACE}:stores:1:id:s1`, ttlSeconds: 60 },
    ]);
  });

  it("does not store an undefined answer, so a later read loads again", async () => {
    const { store, writes } = memoryStore();
    const cache = new ReadThroughCache(store, { namespace: NAMESPACE });
    const loader = vi.fn(async (): Promise<{ id: string } | undefined> => undefined);

    expect(await cache.load("products", "missing", 30, loader)).toBeUndefined();
    expect(await cache.load("products", "missing", 30, loader)).toBeUndefined();

    expect(loader).toHaveBeenCalledTimes(2);
    expect(writes).toEqual([]);
  });

  it("answers from the database and reports the failure when Redis rejects a read", async () => {
    const { store, get } = memoryStore();
    get.mockRejectedValue(new Error("connection refused"));
    const warn = vi.fn<(error: unknown, operation: CacheOperation) => void>();
    const cache = new ReadThroughCache(store, { namespace: NAMESPACE, warn });
    const loader = vi.fn(async () => ({ id: "p1" }));

    await expect(cache.load("products", "p1", 30, loader)).resolves.toEqual({ id: "p1" });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.any(Error), "generation");
  });

  it("gives up on a Redis command that hangs, within the timeout", async () => {
    const { store, get } = memoryStore();
    get.mockImplementation(() => new Promise<string | null>(() => undefined));
    const cache = new ReadThroughCache(store, { namespace: NAMESPACE, timeoutMs: 10 });

    const started = Date.now();
    await expect(cache.load("products", "p1", 30, async () => ({ id: "p1" }))).resolves.toEqual({ id: "p1" });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("still returns the loaded answer when the write fails, and reports it", async () => {
    const { store, set } = memoryStore();
    set.mockRejectedValue(new Error("READONLY"));
    const warn = vi.fn();
    const cache = new ReadThroughCache(store, { namespace: NAMESPACE, warn });

    await expect(cache.load("availability", "a", 5, async () => [{ inStock: true }])).resolves.toEqual([
      { inStock: true },
    ]);
    expect(warn).toHaveBeenCalledWith(expect.any(Error), "write");
  });

  it("does not throw when an invalidation fails", async () => {
    const { store, increment } = memoryStore();
    increment.mockRejectedValue(new Error("connection refused"));
    const warn = vi.fn();
    const cache = new ReadThroughCache(store, { namespace: NAMESPACE, warn });

    await expect(cache.invalidate("products")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.any(Error), "invalidate");
  });

  it("treats a corrupt stored value as a miss and loads again", async () => {
    const { store, values } = memoryStore();
    values.set(`${NAMESPACE}:products:0:p1`, "{not json");
    const cache = new ReadThroughCache(store, { namespace: NAMESPACE });
    const loader = vi.fn(async () => ({ id: "p1" }));

    expect(await cache.load("products", "p1", 30, loader)).toEqual({ id: "p1" });
    expect(loader).toHaveBeenCalledTimes(1);
  });
});

describe("RedisCacheStore", () => {
  it("sets with an expiry in seconds and increments the counter", async () => {
    const client = {
      get: vi.fn(async () => "value"),
      set: vi.fn(async () => "OK"),
      incr: vi.fn(async () => 3),
    };
    const store = new RedisCacheStore(client as unknown as ConstructorParameters<typeof RedisCacheStore>[0]);

    expect(await store.get("k")).toBe("value");
    await store.set("k", "v", 30);
    expect(await store.increment("g")).toBe(3);
    expect(client.set).toHaveBeenCalledWith("k", "v", "EX", 30);
  });
});
