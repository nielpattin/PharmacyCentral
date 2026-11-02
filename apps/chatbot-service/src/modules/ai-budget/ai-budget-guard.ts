import { AiBudgetExceededError, AiPricingMissingError } from "./ai-budget-errors.ts";
import { microUsdCost, spendWindows } from "./ai-pricing.ts";
import type { AiBudgetStore, SpendLimits } from "./ai-budget-store.ts";
import type { ConcurrencyLimiter } from "./concurrency-limiter.ts";

export type BudgetIdentity = { purpose: string; provider: string; model: string };

/** Upper bound on the tokens one call can use. It only reserves budget before the call. It is never billed. */
export type CallEstimate = { inputTokens: number; outputTokens: number };

/** Usage as the provider reported it for one call, summed over every model round of that call. */
export type BilledUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  modelCalls: number;
};

export type CallOutcome<T> = { value: T; usage: BilledUsage | undefined };

export type AiBudgetGuardOptions = {
  store: AiBudgetStore;
  limiter: ConcurrencyLimiter;
  clock: () => Date;
};

/**
 * Wraps every provider call. Order: take a concurrency slot, price the model, check the daily and monthly limits against
 * the ledger plus the reservations of calls in flight plus this call's estimate, then call the provider and record its
 * usage. A refused call never reaches the provider and records nothing.
 */
export class AiBudgetGuard {
  /** Estimated micro-USD of calls that passed the check and have not finished yet, in this process. */
  private reservedMicroUsd = 0;

  public constructor(private readonly options: AiBudgetGuardOptions) {}

  public async run<T>(
    identity: BudgetIdentity,
    estimate: CallEstimate,
    work: () => Promise<CallOutcome<T>>,
  ): Promise<T> {
    const slot = await this.options.limiter.acquire();
    try {
      const { store, clock } = this.options;
      const now = clock();
      const price = await store.findPrice(identity.provider, identity.model);
      const limits = await store.findLimits();
      const estimatedCost = price
        ? microUsdCost(
            { inputTokens: estimate.inputTokens, outputTokens: estimate.outputTokens, thoughtTokens: 0, imageCount: 0 },
            price,
            identity,
          )
        : null;

      const reserved = estimatedCost ?? 0;
      if (hasLimit(limits)) {
        if (!price) throw new AiPricingMissingError(identity.provider, identity.model);
        const spends = await this.readSpend(limits, now);
        // No await between the check and the reservation: a concurrent admission sees this call's reservation.
        assertWithinLimits(limits, spends, this.reservedMicroUsd + reserved);
      }
      this.reservedMicroUsd += reserved;
      try {
        const outcome = await work();
        const usage: BilledUsage = outcome.usage ?? {
          inputTokens: estimate.inputTokens,
          cachedInputTokens: 0,
          outputTokens: estimate.outputTokens,
          thoughtTokens: 0,
          modelCalls: 1,
        };
        await store.recordUsage({
          createdAt: clock(),
          purpose: identity.purpose,
          provider: identity.provider,
          model: identity.model,
          inputTokens: usage.inputTokens,
          cachedInputTokens: usage.cachedInputTokens,
          outputTokens: usage.outputTokens,
          thoughtTokens: usage.thoughtTokens,
          modelCalls: usage.modelCalls,
          usageSource: outcome.usage ? "provider" : "estimated",
          costMicroUsd: price
            ? microUsdCost(
                {
                  inputTokens: usage.inputTokens,
                  outputTokens: usage.outputTokens,
                  thoughtTokens: usage.thoughtTokens,
                  imageCount: 0,
                },
                price,
                identity,
              )
            : null,
        });
        return outcome.value;
      } finally {
        // Released only after the row is written, so the call is never missing from both the ledger and the reservations.
        this.reservedMicroUsd -= reserved;
      }
    } finally {
      slot.release();
    }
  }

  private async readSpend(limits: SpendLimits, now: Date): Promise<Spends> {
    const windows = spendWindows(now);
    const [day, month] = await Promise.all([
      limits.dailyMicroUsd === null ? undefined : this.options.store.spendSince(windows.dayStart),
      limits.monthlyMicroUsd === null ? undefined : this.options.store.spendSince(windows.monthStart),
    ]);
    return { day, month };
  }
}

/** Spend read for the windows that have a limit. `undefined` means that window has no limit. */
type Spends = { day: number | undefined; month: number | undefined };

const hasLimit = (limits: SpendLimits): boolean => limits.dailyMicroUsd !== null || limits.monthlyMicroUsd !== null;

/** `pending` is the reservations of calls in flight plus this call's estimate. */
const assertWithinLimits = (limits: SpendLimits, spends: Spends, pending: number): void => {
  if (limits.dailyMicroUsd !== null && (spends.day ?? 0) + pending > limits.dailyMicroUsd) {
    throw new AiBudgetExceededError("day");
  }
  if (limits.monthlyMicroUsd !== null && (spends.month ?? 0) + pending > limits.monthlyMicroUsd) {
    throw new AiBudgetExceededError("month");
  }
};
