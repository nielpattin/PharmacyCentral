import { afterEach, describe, expect, it, vi } from "vitest";

import { AiCapacityError } from "./ai-budget-errors.ts";
import { ConcurrencyLimiter } from "./concurrency-limiter.ts";

describe("ConcurrencyLimiter", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("grants slots up to the cap at once", async () => {
    const limiter = new ConcurrencyLimiter(2, 1_000);
    const first = await limiter.acquire();
    const second = await limiter.acquire();

    expect(limiter.inFlight).toBe(2);
    first.release();
    second.release();
    expect(limiter.inFlight).toBe(0);
  });

  it("queues the next caller and hands it the slot when one is released", async () => {
    const limiter = new ConcurrencyLimiter(1, 1_000);
    const held = await limiter.acquire();
    let granted = false;
    const queued = limiter.acquire().then((slot) => {
      granted = true;
      return slot;
    });

    await Promise.resolve();
    expect(granted).toBe(false);
    held.release();
    const slot = await queued;
    expect(granted).toBe(true);
    expect(limiter.inFlight).toBe(1);
    slot.release();
    expect(limiter.inFlight).toBe(0);
  });

  it("grants waiters in arrival order", async () => {
    const limiter = new ConcurrencyLimiter(1, 1_000);
    const held = await limiter.acquire();
    const order: string[] = [];
    const a = limiter.acquire().then((slot) => {
      order.push("a");
      return slot;
    });
    const b = limiter.acquire().then((slot) => {
      order.push("b");
      return slot;
    });

    held.release();
    (await a).release();
    (await b).release();
    expect(order).toEqual(["a", "b"]);
  });

  it("fails a caller that waits past the queue timeout with AiCapacityError", async () => {
    vi.useFakeTimers();
    const limiter = new ConcurrencyLimiter(1, 500);
    await limiter.acquire();
    const waiting = limiter.acquire();
    const assertion = expect(waiting).rejects.toBeInstanceOf(AiCapacityError);

    await vi.advanceTimersByTimeAsync(500);
    await assertion;
  });

  it("never gives a slot to a caller that already timed out", async () => {
    vi.useFakeTimers();
    const limiter = new ConcurrencyLimiter(1, 500);
    const held = await limiter.acquire();
    const timedOut = limiter.acquire().catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(500);
    expect(await timedOut).toBeInstanceOf(AiCapacityError);
    held.release();
    expect(limiter.inFlight).toBe(0);
    const next = await limiter.acquire();
    expect(limiter.inFlight).toBe(1);
    next.release();
  });

  it("ignores a second release of the same slot", async () => {
    const limiter = new ConcurrencyLimiter(1, 1_000);
    const slot = await limiter.acquire();
    slot.release();
    slot.release();

    expect(limiter.inFlight).toBe(0);
    const again = await limiter.acquire();
    again.release();
    expect(limiter.inFlight).toBe(0);
  });
});
