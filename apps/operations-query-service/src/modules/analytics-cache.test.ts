import { describe, expect, it, vi } from "vitest";

import { AnalyticsCache } from "./analytics-cache.ts";

const options = (now: () => number) => ({ ttlMs: 30_000, maxEntries: 2, now });

describe("AnalyticsCache", () => {
  it("serves a loader result from the cache until the TTL expires", async () => {
    let now = 1_000;
    const cache = new AnalyticsCache(options(() => now));
    const load = vi.fn().mockResolvedValue({ value: 1 });

    expect(await cache.getOrLoad("k", load)).toEqual({ value: { value: 1 }, outcome: "miss" });
    expect(await cache.getOrLoad("k", load)).toEqual({ value: { value: 1 }, outcome: "hit" });
    expect(load).toHaveBeenCalledTimes(1);

    now += 30_000;
    await cache.getOrLoad("k", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent loads for the same key and keeps different keys apart", async () => {
    const cache = new AnalyticsCache(options(() => 1_000));
    const deferred = Promise.withResolvers<string>();
    const load = vi.fn(() => deferred.promise);

    const first = cache.getOrLoad("a", load);
    const second = cache.getOrLoad("a", load);
    deferred.resolve("one");

    expect(await first).toEqual({ value: "one", outcome: "miss" });
    expect(await second).toEqual({ value: "one", outcome: "coalesced" });
    expect(load).toHaveBeenCalledTimes(1);
    expect((await cache.getOrLoad("b", async () => "two")).outcome).toBe("miss");
  });

  it("evicts the least recently used entry when full", async () => {
    const cache = new AnalyticsCache(options(() => 1_000));
    await cache.getOrLoad("a", async () => "a");
    await cache.getOrLoad("b", async () => "b");
    await cache.getOrLoad("a", async () => "stale");
    await cache.getOrLoad("c", async () => "c");

    expect((await cache.getOrLoad("a", async () => "stale")).outcome).toBe("hit");
    expect((await cache.getOrLoad("b", async () => "again")).outcome).toBe("miss");
  });

  it("does not cache a failed load", async () => {
    const cache = new AnalyticsCache(options(() => 1_000));
    const load = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce("ok");

    await expect(cache.getOrLoad("k", load)).rejects.toThrow("boom");
    expect(await cache.getOrLoad("k", load)).toEqual({ value: "ok", outcome: "miss" });
  });
});
