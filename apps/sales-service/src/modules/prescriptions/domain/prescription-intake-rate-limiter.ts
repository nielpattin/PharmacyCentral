/** One window of the per-actor intake limit: at most `limit` attempts in any span of `seconds`. */
export type PrescriptionIntakeRateLimitWindow = {
  /** Names the window in the store, e.g. `sales:prescription-intake:minute:<actorId>`. */
  name: string;
  seconds: number;
  limit: number;
};

/**
 * Anyone may register and every photo intake spends one metered Gemini request, so an actor is limited twice: a
 * burst limit and a daily allowance.
 *
 * The windows slide, so an attempt is counted for `seconds` from the moment it happens and `Retry-After` is the wait
 * until the oldest counted attempt leaves the window. Every window is checked together and a refused attempt records
 * nothing, so retrying while blocked neither spends another window's allowance nor extends the block.
 */
export const PRESCRIPTION_INTAKE_RATE_LIMIT_WINDOWS: readonly PrescriptionIntakeRateLimitWindow[] = [
  { name: "minute", seconds: 60, limit: 5 },
  { name: "day", seconds: 86_400, limit: 30 },
];

/** Counts photo intake per actor, so a paid reader call cannot be driven by an unlimited number of uploads. */
export interface PrescriptionIntakeRateLimiter {
  /**
   * Records one intake attempt for the actor and resolves the seconds the actor must wait, or `undefined` when the
   * attempt may go ahead.
   */
  consume(actorId: string): Promise<number | undefined>;
}

/**
 * The counter store could not be read or written. The meter guards a paid provider, so an unreadable meter refuses
 * the request instead of letting it through: a limited shopper is a small annoyance, an unmetered reader is a bill.
 */
export class PrescriptionIntakeRateLimiterError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PrescriptionIntakeRateLimiterError";
  }
}
