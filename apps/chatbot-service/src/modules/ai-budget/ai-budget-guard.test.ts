import { describe, expect, it } from "vitest";

import { AiBudgetExceededError, AiPricingMissingError } from "./ai-budget-errors.ts";
import { AiBudgetGuard, type BudgetIdentity, type CallOutcome } from "./ai-budget-guard.ts";
import type { AiBudgetStore, ModelPriceRow, SpendLimits, UsageRecord } from "./ai-budget-store.ts";
import { ConcurrencyLimiter } from "./concurrency-limiter.ts";

const IDENTITY: BudgetIdentity = { purpose: "chatbot", provider: "gemini", model: "example-model-1" };
// The local day starts 2026-11-14T17:00Z and the local month starts 2026-10-31T17:00Z.
const NOW = new Date("2026-11-15T10:00:00.000Z");
const TODAY = new Date("2026-11-14T18:00:00.000Z");
const THIS_MONTH_EARLIER = new Date("2026-11-01T03:00:00.000Z");
const LAST_MONTH = new Date("2026-10-20T03:00:00.000Z");

const price = (): ModelPriceRow => ({
  provider: "gemini",
  model: "example-model-1",
  inputMicroUsdPerMillion: 1_000_000,
  outputMicroUsdPerMillion: 4_000_000,
  imageMicroUsdPerImage: null,
  updatedAt: NOW,
  updatedBy: "admin",
});

const recordAt = (createdAt: Date, costMicroUsd: number): UsageRecord => ({
  createdAt,
  purpose: "chatbot",
  provider: "gemini",
  model: "example-model-1",
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  thoughtTokens: 0,
  modelCalls: 1,
  usageSource: "provider",
  costMicroUsd,
});

/** Records every write, and reports spend from the ledger for the windows the test asks about. */
const memoryStore = (initial: { price?: ModelPriceRow; limits?: SpendLimits } = {}) => {
  const state = {
    price: initial.price,
    limits: initial.limits ?? { dailyMicroUsd: null, monthlyMicroUsd: null },
    ledger: [] as UsageRecord[],
  };
  const store: AiBudgetStore = {
    findPrice: async () => state.price,
    savePrice: async () => undefined,
    findLimits: async () => state.limits,
    saveLimits: async () => undefined,
    spendSince: async (since) =>
      state.ledger.filter((row) => row.createdAt >= since).reduce((total, row) => total + (row.costMicroUsd ?? 0), 0),
    recordUsage: async (record) => {
      state.ledger.push(record);
    },
  };
  return { store, state };
};

const guardWith = (store: AiBudgetStore, clock: Date = NOW) =>
  new AiBudgetGuard({ store, limiter: new ConcurrencyLimiter(4, 1_000), clock: () => clock });

// With the price above, this estimate costs 1,000 + 4,000 = 5,000 micro-USD.
const smallEstimate = { inputTokens: 1_000, outputTokens: 1_000 };
const providerOutcome = (inputTokens: number, outputTokens: number): CallOutcome<string> => ({
  value: "answer",
  usage: { inputTokens, cachedInputTokens: 0, outputTokens, thoughtTokens: 0, modelCalls: 1 },
});

describe("AiBudgetGuard", () => {
  it("records provider usage and the cost computed from the price", async () => {
    const { store, state } = memoryStore({ price: price() });
    const guard = guardWith(store);

    const value = await guard.run(IDENTITY, smallEstimate, async () => providerOutcome(2_000_000, 500_000));

    expect(value).toBe("answer");
    expect(state.ledger).toEqual([
      expect.objectContaining({
        purpose: "chatbot",
        inputTokens: 2_000_000,
        outputTokens: 500_000,
        usageSource: "provider",
        // 2M input at $1 per 1M is $2; 0.5M output at $4 per 1M is $2. Total 4,000,000 micro-USD.
        costMicroUsd: 4_000_000,
      }),
    ]);
  });

  it("records the estimate as the usage when the provider returns no usage block", async () => {
    const { store, state } = memoryStore({ price: price() });
    const guard = guardWith(store);

    await guard.run(IDENTITY, smallEstimate, async () => ({ value: "answer", usage: undefined }));

    expect(state.ledger[0]).toMatchObject({ usageSource: "estimated", inputTokens: 1_000, outputTokens: 1_000 });
    expect(state.ledger[0]?.costMicroUsd).toBe(5_000);
  });

  it("records no cost when no price is set and no limit needs one", async () => {
    const { store, state } = memoryStore();
    const guard = guardWith(store);

    await guard.run(IDENTITY, smallEstimate, async () => providerOutcome(10, 10));

    expect(state.ledger[0]).toMatchObject({ costMicroUsd: null, usageSource: "provider" });
  });

  it("refuses a call before the provider runs when it would pass the daily limit", async () => {
    const { store, state } = memoryStore({
      price: price(),
      limits: { dailyMicroUsd: 1_000_000, monthlyMicroUsd: null },
    });
    state.ledger.push(recordAt(TODAY, 999_000));
    const guard = guardWith(store, NOW);
    let called = false;

    await expect(
      guard.run(IDENTITY, smallEstimate, async () => {
        called = true;
        return providerOutcome(1, 1);
      }),
    ).rejects.toMatchObject({ window: "day" });

    expect(called).toBe(false);
    expect(state.ledger).toHaveLength(1);
  });

  it("counts only spend since the start of the local day against the daily limit", async () => {
    // Yesterday's spend falls before the day window, so the call still fits under the limit.
    const { store, state } = memoryStore({ price: price(), limits: { dailyMicroUsd: 10_000, monthlyMicroUsd: null } });
    state.ledger.push(recordAt(new Date("2026-11-13T20:00:00.000Z"), 9_000));
    const guard = guardWith(store, NOW);

    await guard.run(IDENTITY, smallEstimate, async () => providerOutcome(1, 1));

    expect(state.ledger).toHaveLength(2);
  });

  it("refuses against the monthly limit even when the day is under it", async () => {
    const { store, state } = memoryStore({ price: price(), limits: { dailyMicroUsd: null, monthlyMicroUsd: 50_000 } });
    state.ledger.push(recordAt(LAST_MONTH, 30_000), recordAt(THIS_MONTH_EARLIER, 46_000));
    const guard = guardWith(store, NOW);

    await expect(guard.run(IDENTITY, smallEstimate, async () => providerOutcome(1, 1))).rejects.toMatchObject({
      window: "month",
    });
  });

  it("does not count last month's spend against this month", async () => {
    const { store, state } = memoryStore({ price: price(), limits: { dailyMicroUsd: null, monthlyMicroUsd: 50_000 } });
    state.ledger.push(recordAt(LAST_MONTH, 46_000));
    const guard = guardWith(store, NOW);

    await guard.run(IDENTITY, smallEstimate, async () => providerOutcome(1, 1));

    expect(state.ledger).toHaveLength(2);
  });

  it("reserves in-flight calls, so two calls that each fit alone are not both admitted", async () => {
    // Each estimate is 5,000 micro-USD, so one fits under a 7,000 limit and two do not.
    const { store } = memoryStore({ price: price(), limits: { dailyMicroUsd: 7_000, monthlyMicroUsd: null } });
    const guard = guardWith(store, NOW);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = guard.run(IDENTITY, smallEstimate, async () => {
      await gate;
      return providerOutcome(1, 1);
    });
    await expect(guard.run(IDENTITY, smallEstimate, async () => providerOutcome(1, 1))).rejects.toBeInstanceOf(
      AiBudgetExceededError,
    );
    release();
    await first;
  });

  it("refuses a limited call when the model has no price, because its cost cannot be checked", async () => {
    const { store } = memoryStore({ limits: { dailyMicroUsd: 1_000_000, monthlyMicroUsd: null } });
    const guard = guardWith(store);
    let called = false;

    await expect(
      guard.run(IDENTITY, smallEstimate, async () => {
        called = true;
        return providerOutcome(1, 1);
      }),
    ).rejects.toBeInstanceOf(AiPricingMissingError);
    expect(called).toBe(false);
  });

  it("releases the reservation and records nothing when the provider call fails", async () => {
    const { store, state } = memoryStore({ price: price(), limits: { dailyMicroUsd: 7_000, monthlyMicroUsd: null } });
    const guard = guardWith(store, NOW);

    await expect(
      guard.run(IDENTITY, smallEstimate, async () => {
        throw new Error("provider down");
      }),
    ).rejects.toThrow("provider down");
    expect(state.ledger).toHaveLength(0);

    // The failed call's reservation is gone, so the next call fits again.
    await expect(guard.run(IDENTITY, smallEstimate, async () => providerOutcome(1, 1))).resolves.toBe("answer");
  });
});
