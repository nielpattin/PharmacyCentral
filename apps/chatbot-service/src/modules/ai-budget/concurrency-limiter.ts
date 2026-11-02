import { AiCapacityError } from "./ai-budget-errors.ts";

/** At most this many provider calls run at once in one process, so a burst cannot exhaust the provider quota. */
export const AI_MAX_CONCURRENT_CALLS = 8;
/** How long a call waits for a free slot before it fails with AiCapacityError. */
export const AI_QUEUE_TIMEOUT_MS = 5_000;

export type ConcurrencySlot = { release(): void };

type Waiter = { grant(): void };

/**
 * A counting semaphore with a FIFO queue. A released slot goes straight to the oldest waiter, so a late caller cannot
 * jump the queue. A waiter that times out leaves the queue and never holds a slot.
 */
export class ConcurrencyLimiter {
  private active = 0;
  private readonly waiters: Waiter[] = [];

  public constructor(
    private readonly maxConcurrent: number,
    private readonly queueTimeoutMs: number,
  ) {}

  public acquire(): Promise<ConcurrencySlot> {
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return Promise.resolve(this.slot());
    }
    return new Promise<ConcurrencySlot>((resolve, reject) => {
      const waiter: Waiter = {
        grant: () => {
          clearTimeout(timer);
          resolve(this.slot());
        },
      };
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new AiCapacityError());
      }, this.queueTimeoutMs);
      this.waiters.push(waiter);
    });
  }

  public get inFlight(): number {
    return this.active;
  }

  private slot(): ConcurrencySlot {
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        const next = this.waiters.shift();
        if (next) {
          // The slot passes to the next waiter, so the active count stays the same.
          next.grant();
          return;
        }
        this.active -= 1;
      },
    };
  }
}
