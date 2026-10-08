import type { Logger } from "../logger.ts";
import type { InventoryRepository } from "./inventory-repository.ts";
import { today } from "./site-availability.ts";

/** How often a quiet site's expired stock is noticed; a fixed cadence, not a tuning knob. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Expiry is the one stock change nothing records: a batch crossing its expiry date leaves the sellable set on its
 * own, so the storefront keeps advertising a product until something else moves that shelf. The sweeper re-answers
 * availability for exactly the balances that just expired.
 *
 * It remembers the date of the last successful sweep and passes it on, so the first run after boot catches up on
 * everything missed while the service was down and later runs only look at what expired since. A failed sweep keeps
 * the old watermark, so the work is retried on the next tick instead of being skipped, and a tick that arrives while
 * a sweep is still running is dropped rather than piling a second sweep on the same rows.
 */
export class ExpiryAvailabilitySweeper {
  private timer: NodeJS.Timeout | undefined;
  private inFlight = false;
  private sweptThrough?: string;

  public constructor(
    private readonly repository: InventoryRepository,
    private readonly logger: Logger,
  ) {}

  public start(): void {
    void this.sweep();
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
  }

  public close(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private async sweep(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    // Read before sweeping: a batch expiring mid-sweep is late rather than early for the next lower bound.
    const sweptOn = today();
    try {
      const updated = await this.repository.refreshAvailabilityForExpiredStock(this.sweptThrough);
      this.sweptThrough = sweptOn;
      if (updated > 0) this.logger.info({ updated, sweptThrough: sweptOn }, "expired stock availability refreshed");
    } catch (error) {
      this.logger.error({ error }, "expiry availability sweep failed");
    } finally {
      this.inFlight = false;
    }
  }
}
