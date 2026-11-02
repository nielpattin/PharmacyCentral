import { AiPricingMissingError } from "./ai-budget-errors.ts";

/**
 * Money is kept as integer micro-USD (1 USD = 1,000,000). A price per 1M tokens in micro-USD is therefore also the
 * micro-USD cost of one token times 1,000,000, so the arithmetic below stays in integers until the final ceiling.
 */
export const MICRO_USD_PER_USD = 1_000_000;
const TOKENS_PER_UNIT = 1_000_000;

export type ModelPrice = {
  /** Micro-USD for one million input tokens. */
  inputMicroUsdPerMillion: number;
  /** Micro-USD for one million output tokens. Thought tokens are billed at this rate. */
  outputMicroUsdPerMillion: number;
  /** Micro-USD for one image, or null when the model is not priced for images. */
  imageMicroUsdPerImage: number | null;
};

export type PricedUsage = {
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  imageCount: number;
};

/**
 * Cost in micro-USD, rounded up so a call is never recorded cheaper than it was billed. Input tokens are charged at the
 * input rate in full, including cached tokens: that over-counts a cache hit, which keeps the limit conservative.
 */
export const microUsdCost = (
  usage: PricedUsage,
  price: ModelPrice,
  identity: { provider: string; model: string },
): number => {
  if (usage.imageCount > 0 && price.imageMicroUsdPerImage === null) {
    throw new AiPricingMissingError(identity.provider, identity.model);
  }
  const tokenUnits =
    usage.inputTokens * price.inputMicroUsdPerMillion +
    (usage.outputTokens + usage.thoughtTokens) * price.outputMicroUsdPerMillion;
  const imageUnits = usage.imageCount * (price.imageMicroUsdPerImage ?? 0) * TOKENS_PER_UNIT;
  return Math.ceil((tokenUnits + imageUnits) / TOKENS_PER_UNIT);
};

/** Converts an admin-entered USD amount (up to six decimals) to integer micro-USD. */
export const usdToMicro = (usd: number): number => Math.round(usd * MICRO_USD_PER_USD);

export const microToUsd = (micro: number): number => micro / MICRO_USD_PER_USD;

/**
 * The spend windows use Asia/Ho_Chi_Minh, which is UTC+7 all year. A fixed offset avoids a timezone library and matches
 * the time the staff screens show.
 */
const VIETNAM_OFFSET_MS = 7 * 60 * 60_000;

export const spendWindows = (now: Date): { dayStart: Date; monthStart: Date } => {
  const local = new Date(now.getTime() + VIETNAM_OFFSET_MS);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  const day = local.getUTCDate();
  return {
    dayStart: new Date(Date.UTC(year, month, day) - VIETNAM_OFFSET_MS),
    monthStart: new Date(Date.UTC(year, month, 1) - VIETNAM_OFFSET_MS),
  };
};
