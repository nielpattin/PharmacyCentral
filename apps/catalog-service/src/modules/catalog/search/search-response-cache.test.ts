import { describe, expect, it, vi } from "vitest";

import { createSearchResponseCache, type CachedSearchResponse } from "./search-response-cache.ts";

const answer = (body: string): CachedSearchResponse => ({ body, nextCursor: undefined });

describe("createSearchResponseCache", () => {
  it("serves a repeated key from memory until the answer expires", async () => {
    let clock = 0;
    const cache = createSearchResponseCache({ ttlMs: 1_000, now: () => clock });
    const loader = vi.fn(async () => answer("[1]"));

    await cache.load("ho", loader);
    clock = 999;
    await cache.load("ho", loader);
    expect(loader).toHaveBeenCalledTimes(1);

    clock = 1_000;
    await cache.load("ho", loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("lets concurrent requests for one key share a single load", async () => {
    const cache = createSearchResponseCache();
    const { promise, resolve } = Promise.withResolvers<CachedSearchResponse>();
    const loader = vi.fn(() => promise);

    const first = cache.load("ho", loader);
    const second = cache.load("ho", loader);
    resolve(answer("[1]"));

    expect(await first).toBe(await second);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("drops the least recently used key once it holds more than the limit", async () => {
    const cache = createSearchResponseCache({ maxEntries: 2 });
    const loader = vi.fn(async () => answer("[]"));

    await cache.load("a", loader);
    await cache.load("b", loader);
    await cache.load("a", loader); // a is now newer than b
    await cache.load("c", loader);
    loader.mockClear();

    await cache.load("a", loader);
    await cache.load("c", loader);
    expect(loader).not.toHaveBeenCalled();
    await cache.load("b", loader);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("does not keep a load that started before the cache was cleared", async () => {
    const cache = createSearchResponseCache();
    const { promise, resolve } = Promise.withResolvers<CachedSearchResponse>();
    const stale = cache.load("ho", () => promise);

    cache.clear();
    resolve(answer("old"));
    await stale;

    const fresh = vi.fn(async () => answer("new"));
    expect((await cache.load("ho", fresh)).body).toBe("new");
  });

  it("does not remember a failed load", async () => {
    const cache = createSearchResponseCache();

    await expect(cache.load("ho", async () => Promise.reject(new Error("down")))).rejects.toThrow("down");

    expect((await cache.load("ho", async () => answer("[]"))).body).toBe("[]");
  });
});
