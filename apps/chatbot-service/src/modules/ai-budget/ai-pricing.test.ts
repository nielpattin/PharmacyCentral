import { describe, expect, it } from "vitest";

import { AiPricingMissingError } from "./ai-budget-errors.ts";
import { microToUsd, microUsdCost, spendWindows, usdToMicro, type ModelPrice } from "./ai-pricing.ts";

const IDENTITY = { provider: "gemini", model: "example-model-1" };
// $1.25 per 1M input and $10 per 1M output, written in micro-USD per 1M tokens.
const PRICE: ModelPrice = {
  inputMicroUsdPerMillion: 1_250_000,
  outputMicroUsdPerMillion: 10_000_000,
  imageMicroUsdPerImage: null,
};

describe("microUsdCost", () => {
  it("prices one million input tokens at the input rate", () => {
    expect(
      microUsdCost({ inputTokens: 1_000_000, outputTokens: 0, thoughtTokens: 0, imageCount: 0 }, PRICE, IDENTITY),
    ).toBe(1_250_000);
  });

  it("bills output and thought tokens at the output rate", () => {
    expect(
      microUsdCost({ inputTokens: 0, outputTokens: 300_000, thoughtTokens: 700_000, imageCount: 0 }, PRICE, IDENTITY),
    ).toBe(10_000_000);
  });

  it("rounds a fraction of a micro-USD up", () => {
    // 1 token at $1.25 per 1M is 1.25 micro-USD, so the record is 2 micro-USD.
    expect(microUsdCost({ inputTokens: 1, outputTokens: 0, thoughtTokens: 0, imageCount: 0 }, PRICE, IDENTITY)).toBe(2);
  });

  it("costs nothing for no tokens", () => {
    expect(microUsdCost({ inputTokens: 0, outputTokens: 0, thoughtTokens: 0, imageCount: 0 }, PRICE, IDENTITY)).toBe(0);
  });

  it("prices images when the model has an image price", () => {
    const withImages = { ...PRICE, imageMicroUsdPerImage: 2_500 };
    expect(
      microUsdCost({ inputTokens: 0, outputTokens: 0, thoughtTokens: 0, imageCount: 4 }, withImages, IDENTITY),
    ).toBe(10_000);
  });

  it("refuses to price images when the model has no image price", () => {
    expect(() =>
      microUsdCost({ inputTokens: 0, outputTokens: 0, thoughtTokens: 0, imageCount: 1 }, PRICE, IDENTITY),
    ).toThrow(AiPricingMissingError);
  });
});

describe("USD and micro-USD conversion", () => {
  it("keeps six decimals exactly", () => {
    expect(usdToMicro(0.075)).toBe(75_000);
    expect(usdToMicro(12.5)).toBe(12_500_000);
    expect(microToUsd(75_000)).toBe(0.075);
  });
});

describe("spendWindows", () => {
  // Asia/Ho_Chi_Minh is UTC+7 with no daylight saving.
  it("starts the day at local midnight, which is 17:00 UTC the day before", () => {
    const windows = spendWindows(new Date("2026-11-14T18:00:00.000Z"));
    expect(windows.dayStart.toISOString()).toBe("2026-11-14T17:00:00.000Z");
  });

  it("keeps the same day for a time before local midnight", () => {
    const windows = spendWindows(new Date("2026-11-14T16:59:00.000Z"));
    expect(windows.dayStart.toISOString()).toBe("2026-11-13T17:00:00.000Z");
  });

  it("starts the month at local midnight on the first day", () => {
    const windows = spendWindows(new Date("2026-11-15T10:00:00.000Z"));
    expect(windows.monthStart.toISOString()).toBe("2026-10-31T17:00:00.000Z");
  });
});
